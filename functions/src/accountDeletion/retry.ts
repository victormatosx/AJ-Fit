/**
 * Retry backoff — pure arithmetic only, no scheduler. A future worker (Fase
 * 2+) is responsible for actually waking up at `nextAttemptAt`; this module
 * only computes what that value (and whether the retry budget is exhausted)
 * should be, given a policy's `RetryConfig` and how many attempts a step has
 * already made.
 */

import type { RetryConfig } from './types';

export interface RetryDecision {
  /** Epoch millis a worker may attempt this step again. Equal to `now` when `exhausted`. */
  nextAttemptAt: number;
  /** `true` once this failed attempt would exceed `retry.maxAttempts` — the step must become `FAILED_TERMINAL`, not retry again. */
  exhausted: boolean;
}

/**
 * `attemptCount` is the number of attempts recorded BEFORE the one that just
 * failed (i.e. `AccountDeletionStepRecord.attemptCount` prior to this
 * failure being persisted). Exponential backoff, capped at `maxDelayMs`.
 */
export function computeRetryDecision(params: {
  attemptCount: number;
  now: number;
  retry: RetryConfig;
}): RetryDecision {
  const { attemptCount, now, retry } = params;
  const attemptsIncludingThisFailure = attemptCount + 1;

  if (attemptsIncludingThisFailure >= retry.maxAttempts) {
    return { nextAttemptAt: now, exhausted: true };
  }

  const delayMs = Math.min(
    retry.maxDelayMs,
    retry.initialDelayMs * Math.pow(retry.backoffMultiplier, attemptCount),
  );

  return { nextAttemptAt: now + delayMs, exhausted: false };
}

/** Whether a step's `nextAttemptAt` has arrived and a worker may attempt it again. */
export function isRetryDue(nextAttemptAt: number | null, now: number): boolean {
  return nextAttemptAt !== null && now >= nextAttemptAt;
}
