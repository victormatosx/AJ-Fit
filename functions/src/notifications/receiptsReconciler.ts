import { randomUUID } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { recomputeDispatchAggregate } from './dispatchAggregation';
import {
  classifyDeliveryError,
  deliveryStatusForClassification,
  retryDelayMs,
} from './errors';
import { createExpoPushClient, type ExpoPushClient, type ExpoReceiptResult } from './expoPushClient';
import {
  MAX_DISPATCH_ATTEMPTS,
  NOTIFICATION_DELIVERIES_SUBCOLLECTION,
  NOTIFICATION_DISPATCHES_COLLECTION,
  type DeliveryStatus,
} from './schema';
import {
  applyDeliveryTokenInvalidation,
  readDeliveryOwnershipState,
  type DeliveryOwnershipSnapshot,
} from './tokenInvalidation';

const SCOPE = 'notifications.receipts';
const RECEIPT_RECHECK_DELAY_MS = 30 * 60 * 1000;
const RECEIPT_CLAIM_MS = 10 * 60 * 1000;
export const RECEIPTS_BATCH_SIZE = 200;
export const MAX_RECEIPT_ATTEMPTS = 5;

interface ClaimedReceipt {
  ref: FirebaseFirestore.DocumentReference;
  dispatchId: string;
  ticketId: string;
  claimToken: string;
  receiptAttemptCount: number;
  ownership: DeliveryOwnershipSnapshot;
}

export interface ReceiptsReconcilerResult {
  candidateCount: number;
  claimedCount: number;
  confirmed: number;
  invalidToken: number;
  failedTerminal: number;
  retryScheduled: number;
  retryExhausted: number;
  stillPending: number;
  exhausted: number;
  fenced: number;
  processingErrors: number;
}

function candidateData(data: FirebaseFirestore.DocumentData): Omit<ClaimedReceipt, 'ref' | 'dispatchId' | 'claimToken' | 'receiptAttemptCount'> | null {
  if (
    typeof data.uid !== 'string' ||
    typeof data.installationId !== 'string' ||
    typeof data.tokenHash !== 'string' ||
    typeof data.ownershipVersion !== 'number' ||
    typeof data.ticketId !== 'string'
  ) {
    return null;
  }
  return {
    ticketId: data.ticketId,
    ownership: {
      uid: data.uid,
      installationId: data.installationId,
      tokenHash: data.tokenHash,
      ownershipVersion: data.ownershipVersion,
    },
  };
}

async function claimReceipt(
  db: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  now: Timestamp,
): Promise<ClaimedReceipt | null> {
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    const parsed = data ? candidateData(data) : null;
    if (!data || data.status !== 'PENDING_RECEIPT' || !parsed) return null;

    const claimUntil = data.receiptClaimUntil as Timestamp | null | undefined;
    if (claimUntil && claimUntil.toMillis() > now.toMillis()) return null;

    const receiptAttemptCount =
      (typeof data.receiptAttemptCount === 'number' ? data.receiptAttemptCount : 0) + 1;
    const claimToken = randomUUID();
    tx.update(ref, {
      receiptAttemptCount,
      receiptClaimToken: claimToken,
      receiptClaimUntil: Timestamp.fromMillis(now.toMillis() + RECEIPT_CLAIM_MS),
      receiptCheckedAt: now,
      updatedAt: now,
    });

    return {
      ref,
      dispatchId: ref.parent.parent!.id,
      ticketId: parsed.ticketId,
      ownership: parsed.ownership,
      claimToken,
      receiptAttemptCount,
    };
  });
}

function receiptResolution(
  receipt: ExpoReceiptResult,
  receiptAttempt: number,
  dispatchAttempt: number,
): { status: DeliveryStatus; errorCode: string | null; errorClass: string | null; terminalReason: string | null } {
  if (receipt.status === 'ok') {
    return { status: 'RECEIPT_CONFIRMED', errorCode: null, errorClass: null, terminalReason: null };
  }

  if (receipt.status === 'pending') {
    if (receiptAttempt >= MAX_RECEIPT_ATTEMPTS) {
      return {
        status: 'RECEIPT_EXHAUSTED',
        errorCode: receipt.errorCode ?? null,
        errorClass: receipt.errorCode ? classifyDeliveryError(receipt.errorCode) : null,
        terminalReason: 'RECEIPT_TIMEOUT',
      };
    }
    return {
      status: 'PENDING_RECEIPT',
      errorCode: receipt.errorCode ?? null,
      errorClass: receipt.errorCode ? classifyDeliveryError(receipt.errorCode) : null,
      terminalReason: null,
    };
  }

  const classification = classifyDeliveryError(receipt.errorCode);
  // A provider receipt is final. MessageRateExceeded therefore needs a new
  // send attempt; repeatedly fetching the same receipt can never turn it into
  // success. Request-level/network failures arrive as `pending` above and are
  // still rechecked without duplicating a notification.
  if (classification === 'RETRYABLE' && dispatchAttempt < MAX_DISPATCH_ATTEMPTS) {
    return {
      status: 'FAILED_RETRYABLE',
      errorCode: receipt.errorCode,
      errorClass: classification,
      terminalReason: null,
    };
  }
  if (classification === 'RETRYABLE') {
    return {
      status: 'FAILED_RETRY_EXHAUSTED',
      errorCode: receipt.errorCode,
      errorClass: classification,
      terminalReason: 'DISPATCH_RETRY_EXHAUSTED',
    };
  }
  return {
    status: deliveryStatusForClassification(classification),
    errorCode: receipt.errorCode,
    errorClass: classification,
    terminalReason: classification === 'INVALID_TOKEN' ? 'DEVICE_NOT_REGISTERED' : receipt.errorCode,
  };
}

async function finalizeReceipt(
  db: Firestore,
  claimed: ClaimedReceipt,
  receipt: ExpoReceiptResult,
  now: Timestamp,
  random: () => number,
): Promise<{ status: DeliveryStatus; invalidated: boolean | null } | null> {
  const parentRef = db.collection(NOTIFICATION_DISPATCHES_COLLECTION).doc(claimed.dispatchId);

  return db.runTransaction(async (tx) => {
    const [delivery, parent] = await Promise.all([
      tx.get(claimed.ref),
      tx.get(parentRef),
    ]);
    const data = delivery.data();
    if (
      !data ||
      data.status !== 'PENDING_RECEIPT' ||
      data.receiptClaimToken !== claimed.claimToken
    ) {
      return null;
    }

    const dispatchAttempt = typeof parent.data()?.attemptCount === 'number'
      ? parent.data()!.attemptCount
      : 1;
    const resolution = receiptResolution(
      receipt,
      claimed.receiptAttemptCount,
      dispatchAttempt,
    );
    const invalidationState = resolution.status === 'INVALID_TOKEN'
      ? await readDeliveryOwnershipState(db, tx, claimed.ownership)
      : null;
    const invalidated = invalidationState
      ? applyDeliveryTokenInvalidation(tx, invalidationState, claimed.ownership, now)
      : null;
    const retryAt = resolution.status === 'FAILED_RETRYABLE'
      ? Timestamp.fromMillis(now.toMillis() + retryDelayMs(dispatchAttempt, random))
      : null;

    tx.update(claimed.ref, {
      status: resolution.status,
      errorCode: resolution.errorCode,
      errorClass: resolution.errorClass,
      terminalReason: resolution.terminalReason,
      nextAttemptAt: retryAt,
      receiptNextCheckAt: resolution.status === 'PENDING_RECEIPT'
        ? Timestamp.fromMillis(now.toMillis() + RECEIPT_RECHECK_DELAY_MS)
        : null,
      receiptClaimToken: null,
      receiptClaimUntil: null,
      updatedAt: now,
    });
    if (parent.exists) {
      const revision = typeof parent.data()?.deliveryRevision === 'number'
        ? parent.data()!.deliveryRevision
        : 0;
      tx.update(parentRef, {
        deliveryRevision: revision + 1,
        updatedAt: now,
        ...(retryAt ? { nextAttemptAt: retryAt } : {}),
        ...(resolution.status === 'FAILED_RETRY_EXHAUSTED' ? { nextAttemptAt: null } : {}),
      });
    }
    return { status: resolution.status, invalidated };
  });
}

export async function runReceiptsReconciliation(
  dependencies: {
    db?: Firestore;
    expoClient?: ExpoPushClient;
    now?: () => Timestamp;
    batchSize?: number;
    random?: () => number;
  } = {},
): Promise<ReceiptsReconcilerResult> {
  const db = dependencies.db ?? defaultDb;
  const expoClient = dependencies.expoClient ?? createExpoPushClient();
  const now = (dependencies.now ?? Timestamp.now)();
  const batchSize = dependencies.batchSize ?? RECEIPTS_BATCH_SIZE;
  const random = dependencies.random ?? Math.random;

  const snapshot = await db.collectionGroup(NOTIFICATION_DELIVERIES_SUBCOLLECTION)
    .where('status', '==', 'PENDING_RECEIPT')
    .where('receiptNextCheckAt', '<=', now)
    .orderBy('receiptNextCheckAt')
    .limit(batchSize)
    .get();

  const result: ReceiptsReconcilerResult = {
    candidateCount: snapshot.size,
    claimedCount: 0,
    confirmed: 0,
    invalidToken: 0,
    failedTerminal: 0,
    retryScheduled: 0,
    retryExhausted: 0,
    stillPending: 0,
    exhausted: 0,
    fenced: 0,
    processingErrors: 0,
  };

  const claims = (await Promise.all(snapshot.docs.map((document) =>
    claimReceipt(db, document.ref, now),
  ))).filter((claim): claim is ClaimedReceipt => claim !== null);
  result.claimedCount = claims.length;
  if (claims.length === 0) return result;

  const receipts = await expoClient.getReceipts(claims.map((claim) => claim.ticketId));
  const affectedDispatches = new Set<string>();

  await Promise.all(claims.map(async (claim) => {
    try {
      const receipt = receipts.get(claim.ticketId) ?? { status: 'pending' as const };
      const resolution = await finalizeReceipt(db, claim, receipt, now, random);
      if (!resolution) {
        result.fenced += 1;
        logWarn(SCOPE, 'receipt_claim_fenced', { dispatchId: claim.dispatchId });
        return;
      }
      affectedDispatches.add(claim.dispatchId);

      if (resolution.status === 'RECEIPT_CONFIRMED') {
        result.confirmed += 1;
        logInfo(SCOPE, 'receipt_accepted', { dispatchId: claim.dispatchId });
      } else if (resolution.status === 'PENDING_RECEIPT') {
        result.stillPending += 1;
        logInfo(SCOPE, 'receipt_pending', {
          dispatchId: claim.dispatchId,
          attemptCount: claim.receiptAttemptCount,
        });
      } else if (resolution.status === 'RECEIPT_EXHAUSTED') {
        result.exhausted += 1;
        logWarn(SCOPE, 'receipt_exhausted', { dispatchId: claim.dispatchId });
      } else if (resolution.status === 'INVALID_TOKEN') {
        result.invalidToken += 1;
        logWarn(SCOPE, resolution.invalidated ? 'invalid_token_removed' : 'invalid_token_fenced', {
          dispatchId: claim.dispatchId,
          installationId: claim.ownership.installationId,
        });
      } else if (resolution.status === 'FAILED_RETRYABLE') {
        result.retryScheduled += 1;
        logWarn(SCOPE, 'receipt_retry_scheduled', { dispatchId: claim.dispatchId });
      } else if (resolution.status === 'FAILED_RETRY_EXHAUSTED') {
        result.retryExhausted += 1;
        logWarn(SCOPE, 'receipt_retry_exhausted', { dispatchId: claim.dispatchId });
      } else {
        result.failedTerminal += 1;
        logWarn(SCOPE, 'receipt_rejected', { dispatchId: claim.dispatchId });
      }
    } catch (error) {
      result.processingErrors += 1;
      logFunctionError(SCOPE, error, {
        operation: 'finalize_receipt',
        dispatchId: claim.dispatchId,
      });
    }
  }));

  await Promise.all([...affectedDispatches].map((dispatchId) =>
    recomputeDispatchAggregate(db, dispatchId, now),
  ));
  return result;
}

export const reconcileNotificationReceipts = onSchedule(
  { schedule: 'every 30 minutes', timeoutSeconds: 180 },
  async () => {
    try {
      const result = await runReceiptsReconciliation();
      logInfo(SCOPE, 'receipt_reconciliation_complete', {
        candidateCount: result.candidateCount,
        claimedCount: result.claimedCount,
        confirmed: result.confirmed,
        invalidToken: result.invalidToken,
        failedTerminal: result.failedTerminal,
        retryScheduled: result.retryScheduled,
        retryExhausted: result.retryExhausted,
        stillPending: result.stillPending,
        exhausted: result.exhausted,
        fenced: result.fenced,
        processingErrors: result.processingErrors,
      });
    } catch (error) {
      logFunctionError(SCOPE, error, { operation: 'reconcile' });
    }
  },
);
