import { randomUUID } from 'node:crypto';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { dailyLocalClock, nextDailyEvaluationInstant, nextDailyWindowAfter } from './dailyTime';
import {
  DAILY_NOTIFICATION_USERS_COLLECTION,
} from './dailyRegistration';
import {
  evaluateDailyWorkoutNotification,
  type DailyWorkoutEvaluation,
} from './dailyWorkoutNotifications';

const SCOPE = 'notifications.dailyScheduler';
export const DAILY_SCHEDULER_BATCH_SIZE = 100;
export const DAILY_SCHEDULER_MAX_USERS_PER_RUN = 2_000;
export const DAILY_SCHEDULER_CONCURRENCY = 10;
const EVALUATION_LEASE_MS = 15 * 60 * 1000;
const RETRY_DELAY_MS = 45 * 60 * 1000;

interface ClaimedRegistration {
  uid: string;
  timezone: string | null;
  claimToken: string;
  ref: FirebaseFirestore.DocumentReference;
}

export interface DailySchedulerDependencies {
  db: Firestore;
  now(): Timestamp;
  evaluate(uid: string): Promise<DailyWorkoutEvaluation>;
  randomUUID(): string;
}

export interface DailySchedulerResult {
  candidates: number;
  claimed: number;
  processed: number;
  eligible: number;
  suppressed: number;
  failed: number;
  expired: number;
  capacityExhausted: boolean;
}

function defaultDependencies(): DailySchedulerDependencies {
  return {
    db: defaultDb,
    now: Timestamp.now,
    evaluate: evaluateDailyWorkoutNotification,
    randomUUID,
  };
}

async function claimRegistration(
  dependencies: DailySchedulerDependencies,
  ref: FirebaseFirestore.DocumentReference,
  now: Timestamp,
): Promise<ClaimedRegistration | 'EXPIRED' | null> {
  return dependencies.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!data) return null;
    if (data.expireAt instanceof Timestamp && data.expireAt.toMillis() <= now.toMillis()) {
      transaction.delete(ref);
      return 'EXPIRED' as const;
    }
    if (!(data.nextEvaluationAt instanceof Timestamp) || data.nextEvaluationAt.toMillis() > now.toMillis()) {
      return null;
    }
    const claimToken = dependencies.randomUUID();
    transaction.update(ref, {
      evaluationClaimToken: claimToken,
      evaluationClaimVersion:
        typeof data.evaluationClaimVersion === 'number' ? data.evaluationClaimVersion + 1 : 1,
      evaluationClaimedAt: now,
      // Moving the due cursor is the lease. Concurrent queries immediately
      // stop seeing this registration; a crashed worker becomes due again.
      nextEvaluationAt: Timestamp.fromMillis(now.toMillis() + EVALUATION_LEASE_MS),
      updatedAt: now,
    });
    return {
      uid: snapshot.id,
      timezone: typeof data.timezone === 'string' ? data.timezone : null,
      claimToken,
      ref,
    };
  });
}

function nextEvaluation(
  result: DailyWorkoutEvaluation,
  claimedTimezone: string | null,
  now: Timestamp,
): Timestamp {
  const timezone = result.timezone ?? claimedTimezone;
  if (result.status === 'FAILED') {
    return Timestamp.fromMillis(now.toMillis() + RETRY_DELAY_MS);
  }
  if (timezone) {
    const clock = dailyLocalClock(now.toDate(), timezone);
    if (clock) {
      const next = result.status === 'SUPPRESSED' && result.reason === 'OUTSIDE_LOCAL_WINDOW'
        ? nextDailyEvaluationInstant(now.toDate(), timezone)
        : nextDailyWindowAfter(result.localDate ?? clock.localDate, timezone);
      if (next) return Timestamp.fromDate(next);
    }
  }
  // Invalid/missing timezone never falls back to UTC for product semantics.
  // This is only a safe re-check deadline; a later device sync repairs it.
  return Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
}

async function finishRegistration(
  dependencies: DailySchedulerDependencies,
  claim: ClaimedRegistration,
  result: DailyWorkoutEvaluation,
  now: Timestamp,
): Promise<void> {
  await dependencies.db.runTransaction(async (transaction) => {
    const current = await transaction.get(claim.ref);
    const data: DocumentData | undefined = current.data();
    if (data?.evaluationClaimToken !== claim.claimToken) return;
    if (
      result.status === 'SUPPRESSED'
      && (result.reason === 'USER_NOT_FOUND' || result.reason === 'ACCOUNT_INACTIVE')
    ) {
      transaction.delete(claim.ref);
      return;
    }
    transaction.update(claim.ref, {
      ...(result.timezone ? { timezone: result.timezone } : {}),
      nextEvaluationAt: nextEvaluation(result, claim.timezone, now),
      evaluationClaimToken: null,
      lastEvaluationStatus: result.status,
      lastEvaluationReason: result.status === 'SUPPRESSED' ? result.reason : null,
      lastEvaluatedLocalDate: result.localDate ?? null,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
  });
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      await visit(values[index]);
    }
  });
  await Promise.all(workers);
}

export async function runDailyWorkoutNotificationScheduler(
  dependencies: DailySchedulerDependencies = defaultDependencies(),
): Promise<DailySchedulerResult> {
  const now = dependencies.now();
  const summary: DailySchedulerResult = {
    candidates: 0,
    claimed: 0,
    processed: 0,
    eligible: 0,
    suppressed: 0,
    failed: 0,
    expired: 0,
    capacityExhausted: false,
  };
  logInfo(SCOPE, 'scheduler_run_started', { atMs: now.toMillis() });

  while (summary.candidates < DAILY_SCHEDULER_MAX_USERS_PER_RUN) {
    const remaining = DAILY_SCHEDULER_MAX_USERS_PER_RUN - summary.candidates;
    const snapshot = await dependencies.db.collection(DAILY_NOTIFICATION_USERS_COLLECTION)
      .where('nextEvaluationAt', '<=', now)
      .orderBy('nextEvaluationAt')
      .limit(Math.min(DAILY_SCHEDULER_BATCH_SIZE, remaining))
      .get();
    if (snapshot.empty) break;
    summary.candidates += snapshot.size;

    const claims: ClaimedRegistration[] = [];
    for (const document of snapshot.docs) {
      const claim = await claimRegistration(dependencies, document.ref, now);
      if (claim === 'EXPIRED') summary.expired += 1;
      else if (claim) claims.push(claim);
    }
    summary.claimed += claims.length;

    await mapConcurrent(claims, DAILY_SCHEDULER_CONCURRENCY, async (claim) => {
      let result: DailyWorkoutEvaluation;
      try {
        result = await dependencies.evaluate(claim.uid);
      } catch (error) {
        result = { status: 'FAILED', timezone: claim.timezone ?? undefined };
        logFunctionError(SCOPE, error, { uid: claim.uid, operation: 'evaluate' });
      }
      if (result.status === 'FAILED') summary.failed += 1;
      else {
        summary.processed += 1;
        if (result.status === 'DISPATCHED') summary.eligible += 1;
        else summary.suppressed += 1;
      }
      await finishRegistration(dependencies, claim, result, now);
    });
  }

  const overflow = await dependencies.db.collection(DAILY_NOTIFICATION_USERS_COLLECTION)
    .where('nextEvaluationAt', '<=', now)
    .limit(1)
    .get();
  summary.capacityExhausted = !overflow.empty;
  if (summary.capacityExhausted) {
    logWarn(SCOPE, 'scheduler_capacity_exhausted', {
      maxUsersPerRun: DAILY_SCHEDULER_MAX_USERS_PER_RUN,
    });
  }
  logInfo(SCOPE, 'scheduler_run_completed', {
    usersScanned: summary.candidates,
    registrationsClaimed: summary.claimed,
    evaluationsCompleted: summary.processed,
    usersEligible: summary.eligible,
    usersSuppressed: summary.suppressed,
    failed: summary.failed,
    expired: summary.expired,
    capacityExhausted: summary.capacityExhausted,
  });
  return summary;
}

/**
 * Hourly is the minimum cadence that covers every IANA offset (including
 * :30/:45 zones) inside the two-hour 08:00–10:00 local product window.
 */
export const evaluateDailyWorkoutNotifications = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Etc/UTC', timeoutSeconds: 540 },
  async () => {
    await runDailyWorkoutNotificationScheduler();
  },
);
