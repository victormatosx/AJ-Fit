import { describe, expect, it } from 'vitest';

import { currentPolicy } from '../policy';
import {
  ACCOUNT_DELETION_STEP_ORDER,
  InvalidStepTransitionError,
  POINT_OF_NO_RETURN_STEP,
  beginStepAttempt,
  canTransitionStep,
  completeStepAttempt,
  initialStepRecords,
  isEligibleForCompletion,
  isPastPointOfNoReturn,
  nextRunnableStep,
  stepOutcomeForRetentionActions,
} from '../steps';
import type { AccountDeletionStepRecord } from '../types';

const RETRY = { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 4000, backoffMultiplier: 2 };
const POLICY = currentPolicy();

function pending(): AccountDeletionStepRecord {
  return { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, lastErrorCode: null, completedAt: null };
}

describe('step transition graph', () => {
  it('allows PENDING -> RUNNING -> terminal, and FAILED_RETRYABLE -> RUNNING', () => {
    expect(canTransitionStep('PENDING', 'RUNNING')).toBe(true);
    expect(canTransitionStep('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionStep('RUNNING', 'SKIPPED_BY_POLICY')).toBe(true);
    expect(canTransitionStep('RUNNING', 'FAILED_RETRYABLE')).toBe(true);
    expect(canTransitionStep('RUNNING', 'FAILED_TERMINAL')).toBe(true);
    expect(canTransitionStep('FAILED_RETRYABLE', 'RUNNING')).toBe(true);
  });

  it('rejects any outgoing transition from a terminal step status (no regression)', () => {
    for (const terminal of ['SUCCEEDED', 'SKIPPED_BY_POLICY', 'FAILED_TERMINAL'] as const) {
      expect(canTransitionStep(terminal, 'RUNNING')).toBe(false);
      expect(canTransitionStep(terminal, 'PENDING')).toBe(false);
      expect(canTransitionStep(terminal, 'FAILED_RETRYABLE')).toBe(false);
    }
  });

  it('rejects PENDING -> any terminal status directly (must go through RUNNING)', () => {
    expect(canTransitionStep('PENDING', 'SUCCEEDED')).toBe(false);
    expect(canTransitionStep('PENDING', 'FAILED_TERMINAL')).toBe(false);
  });
});

describe('beginStepAttempt', () => {
  it('moves PENDING to RUNNING and increments attemptCount', () => {
    const started = beginStepAttempt('ACCOUNT_ACCESS_LOCK', pending(), 100);
    expect(started.status).toBe('RUNNING');
    expect(started.attemptCount).toBe(1);
    expect(started.lastAttemptAt).toBe(100);
    expect(started.nextAttemptAt).toBeNull();
  });

  it('throws on an illegal starting status (e.g. already SUCCEEDED)', () => {
    const succeeded: AccountDeletionStepRecord = { ...pending(), status: 'SUCCEEDED' };
    expect(() => beginStepAttempt('ACCOUNT_ACCESS_LOCK', succeeded, 100)).toThrow(
      InvalidStepTransitionError,
    );
  });
});

describe('completeStepAttempt — idempotency (duplicate step execution)', () => {
  it('treats a logical-success failure (e.g. avatar already absent) as SUCCEEDED, not fatal', () => {
    const running = beginStepAttempt('STORAGE_CLEANUP', pending(), 0);
    const result = completeStepAttempt(
      'STORAGE_CLEANUP',
      running,
      { kind: 'FAILED', code: 'ALREADY_ABSENT' },
      10,
      RETRY,
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.lastErrorCode).toBeNull();
    expect(result.completedAt).toBe(10);
  });

  it('running the same already-SUCCEEDED step again is rejected by the state machine, not silently re-run', () => {
    // A worker must check status before re-running a step; SUCCEEDED has no
    // outgoing transition, so a second beginStepAttempt call is a bug, not a
    // valid "run again" path — logical idempotency lives in the OUTCOME
    // (ALREADY_ABSENT etc.), not in reopening a terminal step.
    const running = beginStepAttempt('STORAGE_CLEANUP', pending(), 0);
    const succeeded = completeStepAttempt('STORAGE_CLEANUP', running, { kind: 'SUCCEEDED' }, 10, RETRY);
    expect(() => beginStepAttempt('STORAGE_CLEANUP', succeeded, 20)).toThrow(InvalidStepTransitionError);
  });
});

describe('completeStepAttempt — retry escalation', () => {
  it('schedules a retry on a retryable failure within budget', () => {
    const running = beginStepAttempt('REVENUECAT_PROCESSING', pending(), 0);
    const result = completeStepAttempt(
      'REVENUECAT_PROCESSING',
      running,
      { kind: 'FAILED', code: 'UNAVAILABLE' },
      5,
      RETRY,
    );
    expect(result.status).toBe('FAILED_RETRYABLE');
    expect(result.lastErrorCode).toBe('UNAVAILABLE');
    expect(result.nextAttemptAt).toBe(5 + RETRY.initialDelayMs);
    expect(result.completedAt).toBeNull();
  });

  it('a retryable failure whose budget is exhausted becomes FAILED_TERMINAL, not stuck retrying forever', () => {
    let step = pending();
    // maxAttempts = 3: drive three failed attempts.
    for (let i = 0; i < RETRY.maxAttempts; i++) {
      step = beginStepAttempt('REVENUECAT_PROCESSING', step, i * 1000);
      step = completeStepAttempt(
        'REVENUECAT_PROCESSING',
        step,
        { kind: 'FAILED', code: 'UNAVAILABLE' },
        i * 1000 + 10,
        RETRY,
      );
      if (i < RETRY.maxAttempts - 1) {
        expect(step.status).toBe('FAILED_RETRYABLE');
      }
    }
    expect(step.status).toBe('FAILED_TERMINAL');
    expect(step.lastErrorCode).toBe('RETRY_BUDGET_EXHAUSTED');
    expect(step.nextAttemptAt).toBeNull();
  });

  it('a terminal failure code fails the step immediately, without consuming retry budget semantics', () => {
    const running = beginStepAttempt('FIRESTORE_CLEANUP', pending(), 0);
    const result = completeStepAttempt(
      'FIRESTORE_CLEANUP',
      running,
      { kind: 'FAILED', code: 'INVALID_CONTRACT' },
      10,
      RETRY,
    );
    expect(result.status).toBe('FAILED_TERMINAL');
    expect(result.lastErrorCode).toBe('INVALID_CONTRACT');
  });

  it('resumes RUNNING -> terminal after a scheduled retry succeeds', () => {
    let step = beginStepAttempt('REVENUECAT_PROCESSING', pending(), 0);
    step = completeStepAttempt('REVENUECAT_PROCESSING', step, { kind: 'FAILED', code: 'TIMEOUT' }, 10, RETRY);
    expect(step.status).toBe('FAILED_RETRYABLE');

    step = beginStepAttempt('REVENUECAT_PROCESSING', step, 2000);
    expect(step.status).toBe('RUNNING');
    expect(step.attemptCount).toBe(2);

    step = completeStepAttempt('REVENUECAT_PROCESSING', step, { kind: 'SUCCEEDED' }, 2010, RETRY);
    expect(step.status).toBe('SUCCEEDED');
  });
});

describe('ordering and dependency (nextRunnableStep)', () => {
  it('returns the first step in canonical order for a fresh workflow', () => {
    expect(nextRunnableStep(POLICY, initialStepRecords())).toBe(ACCOUNT_DELETION_STEP_ORDER[0]);
  });

  it('never returns a later step while an earlier required one is unfinished', () => {
    const steps = { ...initialStepRecords() };
    // Mark everything EXCEPT the first step as SUCCEEDED — the first step is
    // still PENDING, so it must still be the one returned.
    for (const name of ACCOUNT_DELETION_STEP_ORDER.slice(1)) {
      (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: 1 };
    }
    expect(nextRunnableStep(POLICY, steps)).toBe(ACCOUNT_DELETION_STEP_ORDER[0]);
  });

  it('returns null once every required step is terminal-acceptable', () => {
    const steps = { ...initialStepRecords() };
    for (const name of POLICY.requiredSteps) {
      (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: 1 };
    }
    expect(nextRunnableStep(POLICY, steps)).toBeNull();
    expect(isEligibleForCompletion(POLICY, steps)).toBe(true);
  });

  it('partial completion (some SUCCEEDED, one still PENDING) is not eligible for completion', () => {
    const steps = { ...initialStepRecords() };
    for (const name of POLICY.requiredSteps.slice(0, -1)) {
      (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: 1 };
    }
    expect(isEligibleForCompletion(POLICY, steps)).toBe(false);
  });

  it('a required step in FAILED_TERMINAL never counts as eligible for completion', () => {
    const steps = { ...initialStepRecords() };
    for (const name of POLICY.requiredSteps) {
      (steps as any)[name] = { ...steps[name], status: 'SUCCEEDED', completedAt: 1 };
    }
    (steps as any)['AUTH_DELETION'] = { ...steps['AUTH_DELETION'], status: 'FAILED_TERMINAL', completedAt: 1 };
    expect(isEligibleForCompletion(POLICY, steps)).toBe(false);
  });
});

describe('point of no return', () => {
  it('is not past it while VAULT_KEY_DESTRUCTION has not succeeded', () => {
    expect(isPastPointOfNoReturn(initialStepRecords())).toBe(false);
  });

  it('is past it exactly when VAULT_KEY_DESTRUCTION is SUCCEEDED', () => {
    const steps = { ...initialStepRecords() };
    (steps as any)[POINT_OF_NO_RETURN_STEP] = {
      ...steps[POINT_OF_NO_RETURN_STEP],
      status: 'SUCCEEDED',
      completedAt: 1,
    };
    expect(isPastPointOfNoReturn(steps)).toBe(true);
  });

  it('SKIPPED_BY_POLICY on the vault step does not count as past the point of no return', () => {
    // VAULT_KEY_DESTRUCTION is never policy-skippable in practice (validatePolicy
    // enforces it stays required), but the predicate itself is defined strictly
    // as SUCCEEDED — defense in depth if that were ever attempted.
    const steps = { ...initialStepRecords() };
    (steps as any)[POINT_OF_NO_RETURN_STEP] = {
      ...steps[POINT_OF_NO_RETURN_STEP],
      status: 'SKIPPED_BY_POLICY',
      completedAt: 1,
    };
    expect(isPastPointOfNoReturn(steps)).toBe(false);
  });
});

describe('stepOutcomeForRetentionActions', () => {
  it('resolves to SKIPPED_BY_POLICY when every action is RETAIN/SKIP', () => {
    expect(stepOutcomeForRetentionActions(['RETAIN', 'SKIP'])).toBe('SKIPPED_BY_POLICY');
  });

  it('resolves to MUST_EXECUTE when any action is DELETE or ANONYMIZE', () => {
    expect(stepOutcomeForRetentionActions(['RETAIN', 'DELETE'])).toBe('MUST_EXECUTE');
    expect(stepOutcomeForRetentionActions(['ANONYMIZE'])).toBe('MUST_EXECUTE');
  });
});
