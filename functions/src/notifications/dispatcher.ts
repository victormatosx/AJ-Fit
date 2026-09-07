import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { assertValidDispatchRequest, NotificationContentPolicyError } from './contentPolicy';
import { aggregateDeliveryStatuses } from './dispatchAggregation';
import { loadEligibleDevices, type EligibleDevice } from './deviceEligibility';
import {
  classifyDeliveryError,
  deliveryStatusForClassification,
  retryDelayMs,
} from './errors';
import { createExpoPushClient, type ExpoPushClient, type ExpoTicketResult } from './expoPushClient';
import {
  claimDispatch,
  markDispatchOutcome,
  NotificationIdempotencyConflictError,
} from './idempotency';
import {
  MAX_DISPATCH_ATTEMPTS,
  NOTIFICATION_DELIVERIES_SUBCOLLECTION,
  NOTIFICATION_DISPATCHES_COLLECTION,
  NOTIFICATION_RETENTION_MS,
  type DeliveryStatus,
  type NotificationDispatchOutcome,
  type NotificationDispatchRequest,
} from './schema';
import {
  applyDeliveryTokenInvalidation,
  readDeliveryOwnershipState,
  type DeliveryOwnershipSnapshot,
} from './tokenInvalidation';

const SCOPE = 'notifications.dispatcher';
const RECEIPT_INITIAL_DELAY_MS = 15 * 60 * 1000;

export interface DispatcherDependencies {
  db: Firestore;
  expoClient: ExpoPushClient;
  now(): Timestamp;
  random?(): number;
}

export function defaultDependencies(): DispatcherDependencies {
  return {
    db: defaultDb,
    expoClient: createExpoPushClient(),
    now: Timestamp.now,
    random: Math.random,
  };
}

function dispatchRef(db: Firestore, dispatchId: string) {
  return db.collection(NOTIFICATION_DISPATCHES_COLLECTION).doc(dispatchId);
}

interface DeliveryUpdate {
  ownership: DeliveryOwnershipSnapshot;
  status: DeliveryStatus;
  ticketId: string | null;
  errorCode: string | null;
  errorClass: string | null;
  nextAttemptAt: Timestamp | null;
}

function updateForTicket(
  device: EligibleDevice,
  ticket: ExpoTicketResult | undefined,
  nextAttemptAt: Timestamp,
): DeliveryUpdate {
  const ownership: DeliveryOwnershipSnapshot = {
    uid: '',
    installationId: device.installationId,
    tokenHash: device.tokenHash,
    ownershipVersion: device.ownershipVersion,
  };
  if (ticket?.ok) {
    return {
      ownership,
      status: 'PENDING_RECEIPT',
      ticketId: ticket.ticketId,
      errorCode: null,
      errorClass: null,
      nextAttemptAt: null,
    };
  }
  const errorCode = ticket?.errorCode ?? 'INVALID_RESPONSE';
  const classification = classifyDeliveryError(errorCode);
  return {
    ownership,
    status: deliveryStatusForClassification(classification),
    ticketId: null,
    errorCode,
    errorClass: classification,
    nextAttemptAt: classification === 'RETRYABLE' ? nextAttemptAt : null,
  };
}

async function priorRetryableInstallationIds(
  db: Firestore,
  dispatchId: string,
): Promise<Set<string>> {
  const snapshot = await dispatchRef(db, dispatchId)
    .collection(NOTIFICATION_DELIVERIES_SUBCOLLECTION)
    .where('status', '==', 'FAILED_RETRYABLE')
    .get();
  return new Set(snapshot.docs.map((document) => document.id));
}

async function persistAttempt(
  dependencies: DispatcherDependencies,
  request: NotificationDispatchRequest,
  dispatchId: string,
  claimToken: string,
  attemptCount: number,
  targets: EligibleDevice[],
  tickets: ExpoTicketResult[],
  staleRetryableIds: readonly string[],
  now: Timestamp,
): Promise<{
  aggregate: ReturnType<typeof aggregateDeliveryStatuses>;
  invalid: { ownership: DeliveryOwnershipSnapshot; invalidated: boolean }[];
} | null> {
  const parentRef = dispatchRef(dependencies.db, dispatchId);
  const retryAt = Timestamp.fromMillis(
    now.toMillis() + retryDelayMs(attemptCount, dependencies.random ?? Math.random),
  );
  const updates = targets.map((device, index) => {
    const update = updateForTicket(device, tickets[index], retryAt);
    update.ownership.uid = request.uid;
    return update;
  });

  const result = await dependencies.db.runTransaction(async (tx) => {
    const parent = await tx.get(parentRef);
    const parentData = parent.data();
    if (!parentData || parentData.status !== 'CLAIMED' || parentData.claimToken !== claimToken) {
      return null;
    }

    const deliveryQuery = parentRef.collection(NOTIFICATION_DELIVERIES_SUBCOLLECTION);
    const currentSnapshot = await tx.get(deliveryQuery);
    const statuses = new Map<string, DeliveryStatus>();
    for (const document of currentSnapshot.docs) {
      statuses.set(document.id, document.data().status as DeliveryStatus);
    }

    const invalidUpdates = updates.filter((update) => update.status === 'INVALID_TOKEN');
    const invalidationStates = await Promise.all(invalidUpdates.map((update) =>
      readDeliveryOwnershipState(dependencies.db, tx, update.ownership),
    ));

    for (const installationId of staleRetryableIds) {
      if (statuses.get(installationId) !== 'FAILED_RETRYABLE') continue;
      statuses.set(installationId, 'FAILED_TERMINAL');
      tx.set(deliveryQuery.doc(installationId), {
        status: 'FAILED_TERMINAL',
        nextAttemptAt: null,
        lastAttemptAt: now,
        updatedAt: now,
        errorCode: 'DEVICE_NO_LONGER_ELIGIBLE',
        errorClass: 'TERMINAL',
        terminalReason: 'DEVICE_NO_LONGER_ELIGIBLE',
      }, { merge: true });
    }

    for (const update of updates) {
      statuses.set(update.ownership.installationId, update.status);
      tx.set(deliveryQuery.doc(update.ownership.installationId), {
        ...update.ownership,
        notificationId: request.notificationId,
        type: request.type,
        status: update.status,
        ticketId: update.ticketId,
        errorCode: update.errorCode,
        errorClass: update.errorClass,
        terminalReason: update.status === 'FAILED_TERMINAL' ? update.errorCode : null,
        attemptCount,
        lastAttemptAt: now,
        nextAttemptAt: update.nextAttemptAt,
        receiptAttemptCount: 0,
        receiptNextCheckAt: update.status === 'PENDING_RECEIPT'
          ? Timestamp.fromMillis(now.toMillis() + RECEIPT_INITIAL_DELAY_MS)
          : null,
        receiptCheckedAt: null,
        receiptClaimToken: null,
        receiptClaimUntil: null,
        sentAt: update.status === 'PENDING_RECEIPT' ? now : null,
        createdAt: now,
        updatedAt: now,
        expireAt: Timestamp.fromMillis(now.toMillis() + NOTIFICATION_RETENTION_MS),
      }, { merge: true });
    }

    if (attemptCount >= MAX_DISPATCH_ATTEMPTS) {
      for (const [installationId, status] of statuses) {
        if (status !== 'FAILED_RETRYABLE') continue;
        statuses.set(installationId, 'FAILED_RETRY_EXHAUSTED');
        tx.set(deliveryQuery.doc(installationId), {
          status: 'FAILED_RETRY_EXHAUSTED',
          nextAttemptAt: null,
          terminalReason: 'DISPATCH_RETRY_EXHAUSTED',
          updatedAt: now,
        }, { merge: true });
      }
    }

    const aggregate = aggregateDeliveryStatuses([...statuses.values()]);
    const deliveryRevision =
      (typeof parentData.deliveryRevision === 'number' ? parentData.deliveryRevision : 0) + 1;
    tx.update(parentRef, {
      ...aggregate,
      claimToken: null,
      deliveryRevision,
      aggregateSourceRevision: deliveryRevision,
      nextAttemptAt: aggregate.status === 'RETRY_SCHEDULED' ? retryAt : null,
      lastErrorClass: aggregate.status === 'RETRY_SCHEDULED' ? 'PROVIDER_RETRYABLE' : null,
      terminalReason:
        aggregate.status === 'FAILED_TERMINAL' ? 'PROVIDER_TERMINAL' :
        aggregate.status === 'FAILED_RETRY_EXHAUSTED' ? 'DISPATCH_RETRY_EXHAUSTED' :
        null,
      updatedAt: now,
    });
    return {
      aggregate,
      invalid: invalidUpdates.map((update, index) => ({
        ownership: update.ownership,
        invalidated: applyDeliveryTokenInvalidation(
          tx,
          invalidationStates[index]!,
          update.ownership,
          now,
        ),
      })),
    };
  });

  return result;
}

export async function dispatchNotification(
  request: NotificationDispatchRequest,
  dependencies: DispatcherDependencies = defaultDependencies(),
): Promise<NotificationDispatchOutcome> {
  try {
    assertValidDispatchRequest(request);
  } catch (error) {
    if (error instanceof NotificationContentPolicyError) {
      logFunctionError(SCOPE, error, { operation: 'validate', reason: error.reason });
    }
    throw error;
  }

  const now = dependencies.now();
  let claim;
  try {
    claim = await claimDispatch(dependencies.db, request, now);
  } catch (error) {
    if (error instanceof NotificationIdempotencyConflictError) {
      logWarn(SCOPE, 'dispatch_idempotency_contract_conflict', {
        dispatchId: error.dispatchId,
        type: request.type,
      });
    }
    throw error;
  }

  if (claim.outcome === 'DUPLICATE_IN_PROGRESS' || claim.outcome === 'DUPLICATE_TERMINAL') {
    logInfo(SCOPE, 'dispatch_deduplicated', {
      dispatchId: claim.dispatchId,
      type: request.type,
      outcome: claim.outcome,
    });
    return { status: 'DUPLICATE', dispatchId: claim.dispatchId };
  }
  if (claim.outcome === 'RETRY_EXHAUSTED' || !claim.claimToken) {
    logWarn(SCOPE, 'dispatch_retry_exhausted', { dispatchId: claim.dispatchId, type: request.type });
    return {
      status: 'FAILED_RETRY_EXHAUSTED',
      dispatchId: claim.dispatchId,
      deviceCount: 0,
      acceptedCount: 0,
    };
  }

  logInfo(SCOPE, 'dispatch_claimed', {
    dispatchId: claim.dispatchId,
    type: request.type,
    attemptCount: claim.attemptCount,
  });

  try {
    const selection = await loadEligibleDevices(request.uid, dependencies.db, now);
    if (selection.scanLimitReached) {
      logWarn(SCOPE, 'device_scan_limit_reached', {
        dispatchId: claim.dispatchId,
        scannedCount: selection.scannedCount,
      });
    }

    let targets = selection.eligible;
    let staleRetryableIds: string[] = [];
    if (claim.outcome === 'RETRY_ALLOWED') {
      const retryableIds = await priorRetryableInstallationIds(dependencies.db, claim.dispatchId);
      if (retryableIds.size > 0) {
        const eligibleIds = new Set(selection.eligible.map((device) => device.installationId));
        targets = selection.eligible.filter((device) => retryableIds.has(device.installationId));
        staleRetryableIds = [...retryableIds].filter((id) => !eligibleIds.has(id));
      }
    }

    if (targets.length === 0 && staleRetryableIds.length === 0) {
      const written = await markDispatchOutcome(
        dependencies.db,
        claim.dispatchId,
        claim.claimToken,
        { status: 'NO_ELIGIBLE_DEVICE', terminalReason: 'NO_ELIGIBLE_DEVICE' },
        now,
      );
      if (!written) return { status: 'DUPLICATE', dispatchId: claim.dispatchId };
      logInfo(SCOPE, 'dispatch_suppressed', {
        dispatchId: claim.dispatchId,
        reason: 'NO_ELIGIBLE_DEVICE',
      });
      return { status: 'NO_ELIGIBLE_DEVICE', dispatchId: claim.dispatchId };
    }

    logInfo(SCOPE, 'provider_request', {
      dispatchId: claim.dispatchId,
      deviceCount: targets.length,
      attemptCount: claim.attemptCount,
    });
    const tickets = targets.length > 0
      ? await dependencies.expoClient.send(targets.map((device) => ({
          to: device.expoPushToken,
          title: request.title,
          body: request.body,
          data: {
            type: request.type,
            notificationId: request.notificationId,
            ...(request.data ?? {}),
          },
        })))
      : [];

    const persisted = await persistAttempt(
      dependencies,
      request,
      claim.dispatchId,
      claim.claimToken,
      claim.attemptCount,
      targets,
      tickets,
      staleRetryableIds,
      now,
    );
    if (!persisted) {
      logWarn(SCOPE, 'dispatch_claim_fenced', { dispatchId: claim.dispatchId });
      return { status: 'DUPLICATE', dispatchId: claim.dispatchId };
    }

    for (const invalid of persisted.invalid) {
      logInfo(SCOPE, invalid.invalidated ? 'invalid_token_removed' : 'invalid_token_fenced', {
        dispatchId: claim.dispatchId,
        installationId: invalid.ownership.installationId,
      });
    }

    const { aggregate } = persisted;
    for (const ticket of tickets) {
      logInfo(SCOPE, ticket.ok ? 'provider_ticket_accepted' : 'provider_ticket_rejected', {
        dispatchId: claim.dispatchId,
        errorClass: ticket.ok ? null : classifyDeliveryError(ticket.errorCode),
        errorCode: ticket.ok ? null : ticket.errorCode,
      });
    }
    if (aggregate.status === 'RETRY_SCHEDULED') {
      logWarn(SCOPE, 'dispatch_retry_scheduled', {
        dispatchId: claim.dispatchId,
        attemptCount: claim.attemptCount,
      });
    }

    return {
      status: aggregate.status,
      dispatchId: claim.dispatchId,
      deviceCount: aggregate.deviceCount,
      acceptedCount: aggregate.acceptedCount,
    };
  } catch (error) {
    logFunctionError(SCOPE, error, { operation: 'dispatch', dispatchId: claim.dispatchId });
    const exhausted = claim.attemptCount >= MAX_DISPATCH_ATTEMPTS;
    await markDispatchOutcome(
      dependencies.db,
      claim.dispatchId,
      claim.claimToken,
      {
        status: exhausted ? 'FAILED_RETRY_EXHAUSTED' : 'RETRY_SCHEDULED',
        nextAttemptAt: exhausted
          ? null
          : Timestamp.fromMillis(
              now.toMillis() + retryDelayMs(claim.attemptCount, dependencies.random ?? Math.random),
            ),
        lastErrorClass: 'INTERNAL_TRANSIENT',
        terminalReason: exhausted ? 'DISPATCH_RETRY_EXHAUSTED' : null,
      },
      now,
    ).catch(() => false);
    throw error;
  }
}
