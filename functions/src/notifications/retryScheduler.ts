import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
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
  const cursorRef = dependencies.db.collection('notificationSchedulerState').doc('retryCursor');
  const cursor = await cursorRef.get();
  let lastAt = cursor.get('nextAttemptAt') as Timestamp | null;
  let lastId = cursor.get('id') as string | null;
  let wrapped = false;

  const result: DispatchRetryResult = {
    candidateCount: 0,
    processed: 0,
    malformed: 0,
    failed: 0,
  };

  // A paused campaign must not monopolize the first retry page. The durable
  // cursor gives later due dispatches a turn and wraps after the final page.
  for (let page = 0; page < 20 && result.processed + result.failed + result.malformed < batchSize; page++) {
    const base = dependencies.db.collection(NOTIFICATION_DISPATCHES_COLLECTION)
      .where('status', '==', 'RETRY_SCHEDULED').where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt').orderBy(FieldPath.documentId());
    const snapshot = lastAt && lastId
      ? await base.startAfter(lastAt, lastId).limit(batchSize).get()
      : await base.limit(batchSize).get();
    if (snapshot.empty) {
      await cursorRef.set({ nextAttemptAt: null, id: null });
      if (lastAt && lastId && !wrapped) {
        lastAt = null;
        lastId = null;
        wrapped = true;
        continue;
      }
      break;
    }
    result.candidateCount += snapshot.size;
    for (const document of snapshot.docs) {
      lastAt = document.get('nextAttemptAt');
      lastId = document.id;
    const persisted = persistedDispatchRequest(document.data(), document.id);
    if (!persisted) {
      result.malformed += 1;
      await markMalformed(dependencies.db, document.ref, now);
      logWarn(SCOPE, 'retry_contract_rejected', { dispatchId: document.id });
      continue;
    }
    if (persisted.request.type === 'CAMPAIGN' && persisted.dispatchMode === 'PRODUCT') {
      const campaignId = persisted.request.data?.campaignId;
      if (typeof campaignId === 'string') {
        const campaign = await dependencies.db.collection('notificationCampaigns').doc(campaignId).get();
        if (campaign.get('status') === 'paused') continue;
      }
    }
    try {
      await dispatchNotification(persisted.request, dependencies, persisted.dispatchMode);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      logFunctionError(SCOPE, error, { operation: 'retry', dispatchId: document.id });
    }
    }
    await cursorRef.set({ nextAttemptAt: lastAt, id: lastId });
    if (snapshot.size < batchSize && wrapped) break;
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
