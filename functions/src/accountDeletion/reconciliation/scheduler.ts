/**
 * `cleanupPendingAccountDeletions` — Fase 14's scheduled Cloud Function.
 *
 * Second line of defense: finds every `AccountDeletionRecord` still in a
 * non-terminal status (`REQUESTED`/`PROCESSING`/`RETRY_SCHEDULED`) via
 * `recordAccess.ts`'s bounded, index-free candidate query, and advances each
 * one through `processRecord.ts`'s `processAccountDeletionRecord` — the
 * SAME per-record entry point a future retry-triggered invocation (or an
 * operator tool) would also call.
 *
 * FREQUENCY (Fase 14 §"scheduler frequency/justification"): every 15
 * minutes, fixed `Etc/UTC` timezone — never the deploying developer's local
 * timezone (Cloud Scheduler's default would otherwise be ambiguous across
 * environments). Justification:
 *   - UX pressure is low: the account is already inaccessible to its owner
 *     the moment `ACCOUNT_ACCESS_LOCK` succeeds (normally within the SAME
 *     `requestAccountDeletion` round trip's immediate follow-up), so the
 *     remaining hard-delete work being "eventual" within minutes, not
 *     seconds, has no user-facing cost.
 *   - Cost: a per-minute schedule would run 96x more often than 15-minute
 *     for a table that is normally near-empty (deletions are rare relative
 *     to almost every other workload in this app) — pure waste.
 *   - External retries: Apple's own token endpoints already have their own
 *     latency/rate characteristics; hammering them every minute would only
 *     increase the chance of `RESOURCE_EXHAUSTED`, not resolve anything
 *     faster. 15 minutes comfortably clears typical exponential backoff
 *     windows (`policy.ts`'s `initialDelayMs: 30_000` up to
 *     `maxDelayMs: 6h`) without either starving retries or hammering them.
 *
 * BATCH SIZE / CONCURRENCY (Fase 14 §"batch size" / §"concurrency"): 25
 * candidates per tick, processed with at most 5 in flight at once — bounded
 * explicitly, never `Promise.all` over the full candidate set. Sized to
 * comfortably fit `timeoutSeconds` below even if every candidate needs a
 * slow external (Apple) call, while remaining far below Firestore/Admin SDK
 * per-invocation rate limits. A deletion table with more than 25 concurrently
 * non-terminal records is not expected at this app's scale; if it ever grows
 * beyond one tick's capacity, the NEXT tick (15 minutes later) picks up
 * whatever remains — no record is ever lost, only delayed, and any single
 * record's own progress is never held hostage by another (see
 * `runReconciliationBatch`'s per-record `try/catch`).
 *
 * TIMEOUT/MEMORY: `timeoutSeconds: 300` is set explicitly (rather than
 * relying on the platform default) because this function's total duration
 * scales with the batch, unlike a typical single-request callable — 5
 * minutes comfortably covers 25 candidates at 5-way concurrency even under
 * Apple latency, without reaching for the platform's much larger ceiling
 * "just in case". `memory` is left unset (platform default) — nothing this
 * function does (Admin SDK calls, no large in-memory buffers) benefits from
 * more.
 */

import { randomUUID } from 'node:crypto';

import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler';

import { logFunctionError, logInfo } from '../../lib/logger';
import { REQUEST_ACCOUNT_DELETION_SECRETS } from '../requestAccountDeletion';
import {
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_STEPS_PER_INVOCATION,
  processAccountDeletionRecord,
} from './processRecord';
import { isRecordDueNow, queryReconciliationCandidates } from './recordAccess';

const SCOPE = 'accountDeletion.reconciliation.scheduler';

export const RECONCILIATION_BATCH_SIZE = 25;
export const RECONCILIATION_CONCURRENCY = 5;

export interface ReconciliationBatchResult {
  candidateCount: number;
  processed: number;
  skipped: number;
  errors: number;
}

/**
 * Runs one full reconciliation pass. Exported (not just the `onSchedule`
 * wrapper) so it can be invoked directly from tests and from a future
 * operator tool without going through Cloud Scheduler.
 */
export async function runReconciliationBatch(
  options: {
    batchSize?: number;
    concurrency?: number;
    runId?: string;
    now?: number;
  } = {},
): Promise<ReconciliationBatchResult> {
  const batchSize = options.batchSize ?? RECONCILIATION_BATCH_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? RECONCILIATION_CONCURRENCY);
  const now = options.now ?? Date.now();
  const runId = options.runId ?? randomUUID();

  const candidates = await queryReconciliationCandidates(batchSize);
  logInfo(SCOPE, 'account_deletion_reconciliation_started', {
    candidateCount: candidates.length,
    batchSize,
    concurrency,
  });

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let index = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= candidates.length) return;
      const record = candidates[currentIndex];

      if (!isRecordDueNow(record, now)) {
        skipped += 1;
        logInfo(SCOPE, 'account_deletion_reconciliation_skipped', {
          deletionId: record.deletionId,
          uid: record.uid,
          status: record.status,
          reason: 'NOT_DUE',
        });
        continue;
      }

      try {
        const outcome = await processAccountDeletionRecord(record.deletionId, {
          ownerId: runId,
          now,
          leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
          maxStepsPerInvocation: DEFAULT_MAX_STEPS_PER_INVOCATION,
        });
        if (outcome.kind === 'PROGRESSED' && outcome.stepsExecuted > 0) {
          processed += 1;
        } else {
          skipped += 1;
          logInfo(SCOPE, 'account_deletion_reconciliation_skipped', {
            deletionId: record.deletionId,
            uid: record.uid,
            reason: outcome.kind,
          });
        }
      } catch (error) {
        // One broken record must never abort the batch — isolated per
        // record, logged, the worker moves on to the next candidate.
        errors += 1;
        logFunctionError(SCOPE, error, { uid: record.uid });
      }
    }
  }

  const workerCount = Math.min(concurrency, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const result: ReconciliationBatchResult = { candidateCount: candidates.length, processed, skipped, errors };
  logInfo(SCOPE, 'account_deletion_reconciliation_completed', { ...result });
  return result;
}

export const cleanupPendingAccountDeletions = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 300,
    // Apple's identity client reads these same four secrets
    // (`providerRevocation/appleIdentityConfig.ts`) — bound here so the
    // Apple `PROVIDER_REVOCATION` sub-step can complete during
    // reconciliation exactly as it does during the original request flow.
    secrets: REQUEST_ACCOUNT_DELETION_SECRETS,
  },
  async (_event: ScheduledEvent) => {
    await runReconciliationBatch();
  },
);
