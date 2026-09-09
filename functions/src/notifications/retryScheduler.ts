import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { defaultDependencies, dispatchNotification, type DispatcherDependencies } from './dispatcher';
import { persistedDispatchRequest } from './idempotency';
import { NOTIFICATION_DISPATCHES_COLLECTION } from './schema';

const SCOPE = 'notifications.retryScheduler';
export const DISPATCH_RETRY_BATCH_SIZE = 50;

export interface DispatchRetryResult {
  candidateCount: number;
  processed: number;
  malformed: number;
  failed: number;
}

async function markMalformed(
  db: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  now: Timestamp,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.data()?.status !== 'RETRY_SCHEDULED') return;
    tx.update(ref, {
      status: 'FAILED_TERMINAL',
      nextAttemptAt: null,
      terminalReason: 'INVALID_PERSISTED_REQUEST',
      lastErrorClass: 'CONTRACT_ERROR',
      updatedAt: now,
    });
  });
}

export async function runDispatchRetries(
  dependencies: DispatcherDependencies = defaultDependencies(),
  batchSize = DISPATCH_RETRY_BATCH_SIZE,
): Promise<DispatchRetryResult> {
  const now = dependencies.now();
  const snapshot = await dependencies.db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
    .where('status', '==', 'RETRY_SCHEDULED')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt')
    .limit(batchSize)
    .get();

  const result: DispatchRetryResult = {
    candidateCount: snapshot.size,
    processed: 0,
    malformed: 0,
    failed: 0,
  };

  for (const document of snapshot.docs) {
    const persisted = persistedDispatchRequest(document.data(), document.id);
    if (!persisted) {
      result.malformed += 1;
      await markMalformed(dependencies.db, document.ref, now);
      logWarn(SCOPE, 'retry_contract_rejected', { dispatchId: document.id });
      continue;
    }
    try {
      await dispatchNotification(persisted.request, dependencies, persisted.dispatchMode);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      logFunctionError(SCOPE, error, { operation: 'retry', dispatchId: document.id });
    }
  }

  return result;
}

export const retryNotificationDispatches = onSchedule(
  { schedule: 'every 5 minutes', timeoutSeconds: 180 },
  async () => {
    const result = await runDispatchRetries();
    logInfo(SCOPE, 'retry_batch_complete', {
      candidateCount: result.candidateCount,
      processed: result.processed,
      malformed: result.malformed,
      failed: result.failed,
    });
  },
);
