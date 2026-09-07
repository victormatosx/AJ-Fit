import { randomUUID } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { recomputeDispatchAggregate } from './dispatchAggregation';
import { classifyDeliveryError, deliveryStatusForClassification } from './errors';
import { createExpoPushClient, type ExpoPushClient, type ExpoReceiptResult } from './expoPushClient';
import {
  NOTIFICATION_DELIVERIES_SUBCOLLECTION,
  NOTIFICATION_DISPATCHES_COLLECTION,
  type DeliveryStatus,
} from './schema';
import { invalidateDeliveryToken, type DeliveryOwnershipSnapshot } from './tokenInvalidation';

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
  stillPending: number;
  exhausted: number;
  fenced: number;
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
  attempt: number,
): { status: DeliveryStatus; errorCode: string | null; errorClass: string | null; terminalReason: string | null } {
  if (receipt.status === 'ok') {
    return { status: 'RECEIPT_CONFIRMED', errorCode: null, errorClass: null, terminalReason: null };
  }

  if (receipt.status === 'pending') {
    if (attempt >= MAX_RECEIPT_ATTEMPTS) {
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
  if (classification === 'RETRYABLE' && attempt < MAX_RECEIPT_ATTEMPTS) {
    return {
      status: 'PENDING_RECEIPT',
      errorCode: receipt.errorCode,
      errorClass: classification,
      terminalReason: null,
    };
  }
  if (classification === 'RETRYABLE') {
    return {
      status: 'RECEIPT_EXHAUSTED',
      errorCode: receipt.errorCode,
      errorClass: classification,
      terminalReason: 'RECEIPT_RETRY_EXHAUSTED',
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
): Promise<DeliveryStatus | null> {
  const resolution = receiptResolution(receipt, claimed.receiptAttemptCount);
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

    tx.update(claimed.ref, {
      status: resolution.status,
      errorCode: resolution.errorCode,
      errorClass: resolution.errorClass,
      terminalReason: resolution.terminalReason,
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
      tx.update(parentRef, { deliveryRevision: revision + 1, updatedAt: now });
    }
    return resolution.status;
  });
}

export async function runReceiptsReconciliation(
  dependencies: {
    db?: Firestore;
    expoClient?: ExpoPushClient;
    now?: () => Timestamp;
    batchSize?: number;
  } = {},
): Promise<ReceiptsReconcilerResult> {
  const db = dependencies.db ?? defaultDb;
  const expoClient = dependencies.expoClient ?? createExpoPushClient();
  const now = (dependencies.now ?? Timestamp.now)();
  const batchSize = dependencies.batchSize ?? RECEIPTS_BATCH_SIZE;

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
    stillPending: 0,
    exhausted: 0,
    fenced: 0,
  };

  const claims = (await Promise.all(snapshot.docs.map((document) =>
    claimReceipt(db, document.ref, now),
  ))).filter((claim): claim is ClaimedReceipt => claim !== null);
  result.claimedCount = claims.length;
  if (claims.length === 0) return result;

  const receipts = await expoClient.getReceipts(claims.map((claim) => claim.ticketId));
  const affectedDispatches = new Set<string>();

  await Promise.all(claims.map(async (claim) => {
    const receipt = receipts.get(claim.ticketId) ?? { status: 'pending' as const };
    const status = await finalizeReceipt(db, claim, receipt, now);
    if (!status) {
      result.fenced += 1;
      logWarn(SCOPE, 'receipt_claim_fenced', { dispatchId: claim.dispatchId });
      return;
    }
    affectedDispatches.add(claim.dispatchId);

    if (status === 'RECEIPT_CONFIRMED') {
      result.confirmed += 1;
      logInfo(SCOPE, 'receipt_accepted', { dispatchId: claim.dispatchId });
    } else if (status === 'PENDING_RECEIPT') {
      result.stillPending += 1;
      logInfo(SCOPE, 'receipt_pending', {
        dispatchId: claim.dispatchId,
        attemptCount: claim.receiptAttemptCount,
      });
    } else if (status === 'RECEIPT_EXHAUSTED') {
      result.exhausted += 1;
      logWarn(SCOPE, 'receipt_exhausted', { dispatchId: claim.dispatchId });
    } else if (status === 'INVALID_TOKEN') {
      result.invalidToken += 1;
      const invalidated = await invalidateDeliveryToken(db, claim.ownership, now);
      logWarn(SCOPE, invalidated ? 'invalid_token_removed' : 'invalid_token_fenced', {
        dispatchId: claim.dispatchId,
        installationId: claim.ownership.installationId,
      });
    } else {
      result.failedTerminal += 1;
      logWarn(SCOPE, 'receipt_rejected', { dispatchId: claim.dispatchId });
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
        stillPending: result.stillPending,
        exhausted: result.exhausted,
        fenced: result.fenced,
      });
    } catch (error) {
      logFunctionError(SCOPE, error, { operation: 'reconcile' });
    }
  },
);
