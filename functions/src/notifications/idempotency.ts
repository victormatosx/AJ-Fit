import { createHash, randomUUID } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { assertValidDispatchRequest } from './contentPolicy';
import {
  MAX_DISPATCH_ATTEMPTS,
  NOTIFICATION_DISPATCHES_COLLECTION,
  NOTIFICATION_RETENTION_MS,
  type DispatchStatus,
  type NotificationDispatchRequest,
} from './schema';

export const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

export class NotificationIdempotencyConflictError extends Error {
  constructor(public readonly dispatchId: string) {
    super('notification_idempotency_contract_conflict');
    this.name = 'NotificationIdempotencyConflictError';
  }
}

export type DispatchClaimOutcome =
  | 'CLAIMED'
  | 'RETRY_ALLOWED'
  | 'DUPLICATE_IN_PROGRESS'
  | 'DUPLICATE_TERMINAL'
  | 'RETRY_EXHAUSTED';

export interface DispatchClaimResult {
  outcome: DispatchClaimOutcome;
  dispatchId: string;
  attemptCount: number;
  claimToken?: string;
}

export function dispatchIdFor(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
}

export function contractHashFor(request: NotificationDispatchRequest): string {
  const contract = JSON.stringify({
    uid: request.uid,
    type: request.type,
    category: request.category,
    sourceIdentity: request.sourceIdentity,
    notificationId: request.notificationId,
    title: request.title,
    body: request.body,
    intent: request.intent ?? null,
    data: request.data ?? null,
  });
  return createHash('sha256').update(contract, 'utf8').digest('hex');
}

function dispatchRef(db: Firestore, dispatchId: string) {
  return db.collection(NOTIFICATION_DISPATCHES_COLLECTION).doc(dispatchId);
}

const TERMINAL_STATUSES = new Set<DispatchStatus>([
  'PENDING_RECEIPTS',
  'CONFIRMED',
  'PARTIAL',
  'FAILED_TERMINAL',
  'FAILED_RETRY_EXHAUSTED',
  'RECEIPT_EXHAUSTED',
  'NO_ELIGIBLE_DEVICE',
  'SUPPRESSED_BY_PREFERENCE',
]);

export async function claimDispatch(
  db: Firestore,
  request: NotificationDispatchRequest,
  now: Timestamp = Timestamp.now(),
): Promise<DispatchClaimResult> {
  const dispatchId = dispatchIdFor(request.idempotencyKey);
  const ref = dispatchRef(db, dispatchId);
  const expectedContractHash = contractHashFor(request);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      const claimToken = randomUUID();
      tx.set(ref, {
        uid: request.uid,
        notificationId: request.notificationId,
        type: request.type,
        category: request.category,
        sourceIdentity: request.sourceIdentity,
        contractHash: expectedContractHash,
        idempotencyKeyHash: dispatchId,
        request: {
          uid: request.uid,
          notificationId: request.notificationId,
          type: request.type,
          category: request.category,
          sourceIdentity: request.sourceIdentity,
          title: request.title,
          body: request.body,
          intent: request.intent ?? null,
          data: request.data ?? {},
          idempotencyKey: request.idempotencyKey,
        },
        status: 'CLAIMED',
        claimToken,
        claimVersion: 1,
        attemptCount: 1,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastErrorClass: null,
        terminalReason: null,
        deviceCount: 0,
        acceptedCount: 0,
        deliveryRevision: 0,
        createdAt: now,
        updatedAt: now,
        expireAt: Timestamp.fromMillis(now.toMillis() + NOTIFICATION_RETENTION_MS),
      });
      return { outcome: 'CLAIMED', dispatchId, attemptCount: 1, claimToken };
    }

    const data = snapshot.data() ?? {};
    if (data.contractHash !== expectedContractHash) {
      throw new NotificationIdempotencyConflictError(dispatchId);
    }

    const status = data.status as DispatchStatus | undefined;
    const attemptCount = typeof data.attemptCount === 'number' ? data.attemptCount : 0;
    if (status && TERMINAL_STATUSES.has(status)) {
      return { outcome: 'DUPLICATE_TERMINAL', dispatchId, attemptCount };
    }

    if (status === 'CLAIMED') {
      const updatedAt = data.updatedAt as Timestamp | undefined;
      const stale = !updatedAt || now.toMillis() - updatedAt.toMillis() > CLAIM_STALE_AFTER_MS;
      if (!stale) {
        return { outcome: 'DUPLICATE_IN_PROGRESS', dispatchId, attemptCount };
      }
    } else if (status === 'RETRY_SCHEDULED') {
      const nextAttemptAt = data.nextAttemptAt as Timestamp | undefined;
      if (nextAttemptAt && nextAttemptAt.toMillis() > now.toMillis()) {
        return { outcome: 'DUPLICATE_IN_PROGRESS', dispatchId, attemptCount };
      }
    } else {
      return { outcome: 'DUPLICATE_TERMINAL', dispatchId, attemptCount };
    }

    if (attemptCount >= MAX_DISPATCH_ATTEMPTS) {
      tx.update(ref, {
        status: 'FAILED_RETRY_EXHAUSTED',
        claimToken: null,
        nextAttemptAt: null,
        terminalReason: 'DISPATCH_RETRY_EXHAUSTED',
        updatedAt: now,
      });
      return { outcome: 'RETRY_EXHAUSTED', dispatchId, attemptCount };
    }

    const claimToken = randomUUID();
    const nextAttempt = attemptCount + 1;
    tx.update(ref, {
      status: 'CLAIMED',
      claimToken,
      claimVersion: (typeof data.claimVersion === 'number' ? data.claimVersion : 0) + 1,
      attemptCount: nextAttempt,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastErrorClass: null,
      terminalReason: null,
      updatedAt: now,
    });
    return { outcome: 'RETRY_ALLOWED', dispatchId, attemptCount: nextAttempt, claimToken };
  });
}

export interface DispatchOutcomeUpdate {
  status: DispatchStatus;
  deviceCount?: number;
  acceptedCount?: number;
  nextAttemptAt?: Timestamp | null;
  lastErrorClass?: string | null;
  terminalReason?: string | null;
}

export async function markDispatchOutcome(
  db: Firestore,
  dispatchId: string,
  claimToken: string,
  update: DispatchOutcomeUpdate,
  now: Timestamp = Timestamp.now(),
): Promise<boolean> {
  const ref = dispatchRef(db, dispatchId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (!data || data.status !== 'CLAIMED' || data.claimToken !== claimToken) return false;

    tx.update(ref, {
      status: update.status,
      claimToken: null,
      deviceCount: update.deviceCount ?? data.deviceCount ?? 0,
      acceptedCount: update.acceptedCount ?? data.acceptedCount ?? 0,
      nextAttemptAt: update.nextAttemptAt ?? null,
      lastErrorClass: update.lastErrorClass ?? null,
      terminalReason: update.terminalReason ?? null,
      updatedAt: now,
    });
    return true;
  });
}

export function persistedDispatchRequest(
  value: FirebaseFirestore.DocumentData,
  expectedDispatchId: string,
): NotificationDispatchRequest | null {
  const request = value.request;
  if (typeof request !== 'object' || request === null) return null;
  const record = request as Record<string, unknown>;
  if (
    typeof record.uid !== 'string' ||
    typeof record.notificationId !== 'string' ||
    record.type !== 'QA_TEST' ||
    record.category !== 'OPERATIONAL' ||
    typeof record.sourceIdentity !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.body !== 'string' ||
    typeof record.idempotencyKey !== 'string'
  ) {
    return null;
  }
  const intent = typeof record.intent === 'string' ? record.intent : undefined;
  const data = typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, string | number | boolean>
    : undefined;
  const parsed: NotificationDispatchRequest = {
    uid: record.uid,
    notificationId: record.notificationId,
    type: record.type,
    category: record.category,
    sourceIdentity: record.sourceIdentity,
    title: record.title,
    body: record.body,
    ...(intent ? { intent } : {}),
    ...(data ? { data } : {}),
    idempotencyKey: record.idempotencyKey,
  };
  if (
    dispatchIdFor(parsed.idempotencyKey) !== expectedDispatchId ||
    value.idempotencyKeyHash !== expectedDispatchId ||
    value.contractHash !== contractHashFor(parsed)
  ) {
    return null;
  }
  try {
    assertValidDispatchRequest(parsed);
  } catch {
    return null;
  }
  return parsed;
}
