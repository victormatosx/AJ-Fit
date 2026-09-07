import { type Firestore, type Timestamp } from 'firebase-admin/firestore';

import {
  NOTIFICATION_DELIVERIES_SUBCOLLECTION,
  NOTIFICATION_DISPATCHES_COLLECTION,
  type DeliveryStatus,
  type DispatchStatus,
} from './schema';

export interface DeliveryAggregate {
  status: Exclude<DispatchStatus, 'CLAIMED' | 'NO_ELIGIBLE_DEVICE' | 'SUPPRESSED_BY_PREFERENCE'>;
  deviceCount: number;
  acceptedCount: number;
  confirmedCount: number;
  pendingReceiptCount: number;
  retryableCount: number;
  failedCount: number;
  invalidTokenCount: number;
  receiptExhaustedCount: number;
}

export function aggregateDeliveryStatuses(statuses: readonly DeliveryStatus[]): DeliveryAggregate {
  const count = (status: DeliveryStatus) => statuses.filter((value) => value === status).length;
  const confirmedCount = count('RECEIPT_CONFIRMED');
  const pendingReceiptCount = count('PENDING_RECEIPT');
  const retryableCount = count('FAILED_RETRYABLE');
  const invalidTokenCount = count('INVALID_TOKEN');
  const receiptExhaustedCount = count('RECEIPT_EXHAUSTED');
  const retryExhaustedCount = count('FAILED_RETRY_EXHAUSTED');
  const terminalCount = count('FAILED_TERMINAL');
  const acceptedCount = confirmedCount + pendingReceiptCount + receiptExhaustedCount;

  let status: DeliveryAggregate['status'];
  if (retryableCount > 0) status = 'RETRY_SCHEDULED';
  else if (pendingReceiptCount > 0) status = 'PENDING_RECEIPTS';
  else if (statuses.length > 0 && confirmedCount === statuses.length) status = 'CONFIRMED';
  else if (confirmedCount > 0) status = 'PARTIAL';
  else if (receiptExhaustedCount > 0) status = 'RECEIPT_EXHAUSTED';
  else if (retryExhaustedCount > 0) status = 'FAILED_RETRY_EXHAUSTED';
  else status = 'FAILED_TERMINAL';

  return {
    status,
    deviceCount: statuses.length,
    acceptedCount,
    confirmedCount,
    pendingReceiptCount,
    retryableCount,
    failedCount: terminalCount + retryExhaustedCount + invalidTokenCount,
    invalidTokenCount,
    receiptExhaustedCount,
  };
}

function aggregateErrorMetadata(status: DeliveryAggregate['status']): {
  lastErrorClass: string | null;
  terminalReason: string | null;
} {
  switch (status) {
    case 'RETRY_SCHEDULED':
      return { lastErrorClass: 'PROVIDER_RETRYABLE', terminalReason: null };
    case 'FAILED_TERMINAL':
      return { lastErrorClass: 'DELIVERY_TERMINAL', terminalReason: 'ALL_DELIVERIES_FAILED' };
    case 'FAILED_RETRY_EXHAUSTED':
      return {
        lastErrorClass: 'PROVIDER_RETRYABLE',
        terminalReason: 'DISPATCH_RETRY_EXHAUSTED',
      };
    case 'RECEIPT_EXHAUSTED':
      return { lastErrorClass: 'RECEIPT_UNCONFIRMED', terminalReason: 'RECEIPT_EXHAUSTED' };
    case 'PARTIAL':
      return { lastErrorClass: 'PARTIAL_DELIVERY_FAILURE', terminalReason: null };
    default:
      return { lastErrorClass: null, terminalReason: null };
  }
}

/**
 * Recomputes a parent only if no delivery mutation occurred after the read.
 * The revision check prevents a slower concurrent reconciler from replacing a
 * newer aggregate with an older snapshot.
 */
export async function recomputeDispatchAggregate(
  db: Firestore,
  dispatchId: string,
  now: Timestamp,
): Promise<boolean> {
  const dispatchRef = db.collection(NOTIFICATION_DISPATCHES_COLLECTION).doc(dispatchId);
  const before = await dispatchRef.get();
  const expectedRevision = before.data()?.deliveryRevision;
  if (!before.exists || typeof expectedRevision !== 'number') return false;

  const deliveries = await dispatchRef.collection(NOTIFICATION_DELIVERIES_SUBCOLLECTION).get();
  const statuses = deliveries.docs
    .map((document) => document.data().status)
    .filter((status): status is DeliveryStatus =>
      typeof status === 'string' && [
        'PENDING_RECEIPT',
        'RECEIPT_CONFIRMED',
        'FAILED_RETRYABLE',
        'FAILED_TERMINAL',
        'FAILED_RETRY_EXHAUSTED',
        'INVALID_TOKEN',
        'RECEIPT_EXHAUSTED',
      ].includes(status),
    );
  if (statuses.length === 0) return false;
  const aggregate = aggregateDeliveryStatuses(statuses);
  const errorMetadata = aggregateErrorMetadata(aggregate.status);

  return db.runTransaction(async (tx) => {
    const current = await tx.get(dispatchRef);
    const data = current.data();
    if (
      !data ||
      data.deliveryRevision !== expectedRevision ||
      data.status === 'CLAIMED'
    ) {
      return false;
    }
    tx.update(dispatchRef, {
      ...aggregate,
      ...errorMetadata,
      nextAttemptAt: aggregate.status === 'RETRY_SCHEDULED'
        ? data.nextAttemptAt ?? null
        : null,
      aggregateSourceRevision: expectedRevision,
      updatedAt: now,
    });
    return true;
  });
}
