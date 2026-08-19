import { describe, expect, it } from 'vitest';

import { computeRetryDecision, isRetryDue } from '../retry';
import type { RetryConfig } from '../types';

const RETRY: RetryConfig = {
  maxAttempts: 4,
  initialDelayMs: 1_000,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
};

describe('computeRetryDecision', () => {
  it('schedules exponential backoff for early attempts', () => {
    const now = 1_000_000;
    expect(computeRetryDecision({ attemptCount: 0, now, retry: RETRY })).toEqual({
      nextAttemptAt: now + 1_000,
      exhausted: false,
    });
    expect(computeRetryDecision({ attemptCount: 1, now, retry: RETRY })).toEqual({
      nextAttemptAt: now + 2_000,
      exhausted: false,
    });
    expect(computeRetryDecision({ attemptCount: 2, now, retry: RETRY })).toEqual({
      nextAttemptAt: now + 4_000,
      exhausted: false,
    });
  });

  it('caps the delay at maxDelayMs', () => {
    const now = 0;
    const result = computeRetryDecision({
      attemptCount: 10,
      now,
      retry: { ...RETRY, maxAttempts: 100 },
    });
    expect(result.nextAttemptAt).toBe(now + RETRY.maxDelayMs);
    expect(result.exhausted).toBe(false);
  });

  it('reports exhaustion once maxAttempts would be reached', () => {
    // maxAttempts = 4: attemptCount 3 means this failure is the 4th attempt.
    const result = computeRetryDecision({ attemptCount: 3, now: 0, retry: RETRY });
    expect(result.exhausted).toBe(true);
    expect(result.nextAttemptAt).toBe(0);
  });

  it('never reports exhaustion before the budget is actually spent', () => {
    expect(computeRetryDecision({ attemptCount: 2, now: 0, retry: RETRY }).exhausted).toBe(false);
  });
});

describe('isRetryDue', () => {
  it('is false for a null nextAttemptAt', () => {
    expect(isRetryDue(null, 1_000)).toBe(false);
  });

  it('is false before the scheduled time and true at/after it', () => {
    expect(isRetryDue(1_000, 999)).toBe(false);
    expect(isRetryDue(1_000, 1_000)).toBe(true);
    expect(isRetryDue(1_000, 1_001)).toBe(true);
  });
});
