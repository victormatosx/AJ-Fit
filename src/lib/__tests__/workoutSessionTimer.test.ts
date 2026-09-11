import { describe, expect, it } from 'vitest';
import {
  computeWorkoutElapsedSeconds,
  formatWorkoutSessionDuration,
  isLongWorkoutSession,
  LONG_WORKOUT_SESSION_THRESHOLD_SECONDS,
  safeStartedAtMs,
} from '../workoutSessionTimer';

const STARTED_AT = 1_000_000;
const HOUR = 3_600;

describe('computeWorkoutElapsedSeconds — wall-clock elapsed time, not a tick count', () => {
  it('foreground: 10 minutes of real time elapse', () => {
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 10 * 60_000)).toBe(600);
  });

  it('background gap: 20 minutes elapse with zero intermediate calls', () => {
    // No ticks happened during the gap — a single before/after read must
    // still land on the full wall-clock delta.
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 20 * 60_000)).toBe(1200);
  });

  it('locked-screen gap: 30 minutes elapse', () => {
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 30 * 60_000)).toBe(1800);
  });

  it('never returns negative seconds on clock skew (now before startedAt)', () => {
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT - 5_000)).toBe(0);
  });

  it('returns 0 for now === startedAt', () => {
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT)).toBe(0);
  });

  it('floors partial seconds', () => {
    expect(computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 1_999)).toBe(1);
  });

  it('is deterministic — same inputs always produce the same output', () => {
    const a = computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 12_345);
    const b = computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 12_345);
    expect(a).toBe(b);
  });

  it('remount/restore: recomputing from the same startedAt continues from the correct chronological point instead of resetting', () => {
    // Simulates a screen remount (or a cold-start resume of the same
    // IN_PROGRESS execution): startedAt is unchanged, only `now` moves.
    const afterFirstRender = computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 5 * 60_000);
    const afterRemount = computeWorkoutElapsedSeconds(STARTED_AT, STARTED_AT + 8 * 60_000);
    expect(afterFirstRender).toBe(300);
    expect(afterRemount).toBe(480);
    expect(afterRemount).toBeGreaterThan(afterFirstRender);
  });
});

describe('isLongWorkoutSession — Workout Recovery long-session threshold', () => {
  it('3h59 is NOT a long session', () => {
    expect(isLongWorkoutSession(4 * HOUR - 60)).toBe(false);
  });

  it('exactly 4h00 IS a long session (inclusive threshold)', () => {
    expect(isLongWorkoutSession(4 * HOUR)).toBe(true);
  });

  it('the default threshold is exactly 4 hours', () => {
    expect(LONG_WORKOUT_SESSION_THRESHOLD_SECONDS).toBe(4 * HOUR);
  });

  it('5h12 is a long session', () => {
    expect(isLongWorkoutSession(5 * HOUR + 12 * 60)).toBe(true);
  });

  it('a custom threshold can be passed explicitly', () => {
    expect(isLongWorkoutSession(HOUR, 2 * HOUR)).toBe(false);
    expect(isLongWorkoutSession(2 * HOUR, 2 * HOUR)).toBe(true);
  });
});

describe('formatWorkoutSessionDuration — Workout Recovery long-session copy', () => {
  it('4h00 (exact threshold)', () => {
    expect(formatWorkoutSessionDuration(4 * HOUR)).toBe('4h00');
  });

  it('4h37', () => {
    expect(formatWorkoutSessionDuration(4 * HOUR + 37 * 60)).toBe('4h37');
  });

  it('5h12', () => {
    expect(formatWorkoutSessionDuration(5 * HOUR + 12 * 60)).toBe('5h12');
  });

  it('12h05 — minutes always 2-digit', () => {
    expect(formatWorkoutSessionDuration(12 * HOUR + 5 * 60)).toBe('12h05');
  });

  it('exactly 24h formats as days/hours, never as 24h00', () => {
    expect(formatWorkoutSessionDuration(24 * HOUR)).toBe('1d 0h');
  });

  it('27h14 formats as 1d 3h — days/hours, no minutes at day scale', () => {
    expect(formatWorkoutSessionDuration(27 * HOUR + 14 * 60)).toBe('1d 3h');
  });

  it('multi-day durations', () => {
    expect(formatWorkoutSessionDuration(50 * HOUR)).toBe('2d 2h');
  });

  it('never shows seconds', () => {
    expect(formatWorkoutSessionDuration(4 * HOUR + 30)).toBe('4h00');
  });
});

describe('safeStartedAtMs — defensive read of a possibly-malformed startedAt', () => {
  it('reads a Firestore-Timestamp-shaped value via toMillis()', () => {
    expect(safeStartedAtMs({ toMillis: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it('accepts a plain finite number', () => {
    expect(safeStartedAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('returns null for null/undefined (missing startedAt)', () => {
    expect(safeStartedAtMs(null)).toBeNull();
    expect(safeStartedAtMs(undefined)).toBeNull();
  });

  it('returns null when toMillis() throws instead of propagating', () => {
    expect(safeStartedAtMs({ toMillis: () => { throw new Error('corrupt'); } })).toBeNull();
  });

  it('returns null when toMillis() returns a non-finite value', () => {
    expect(safeStartedAtMs({ toMillis: () => Number.NaN })).toBeNull();
  });

  it('returns null for a malformed object with no toMillis', () => {
    expect(safeStartedAtMs({ seconds: 123 })).toBeNull();
  });

  it('returns null for a non-finite number', () => {
    expect(safeStartedAtMs(Number.NaN)).toBeNull();
  });
});

describe('long-session pipeline end to end — clock skew must never alarm the user', () => {
  it('startedAt in the future (clock skew) clamps elapsed to 0 and is never flagged as a long session', () => {
    const nowMs = 1_000_000;
    const startedAtMs = nowMs + 60_000; // 1 minute in the future
    const elapsedSeconds = computeWorkoutElapsedSeconds(startedAtMs, nowMs);
    expect(elapsedSeconds).toBe(0);
    expect(isLongWorkoutSession(elapsedSeconds)).toBe(false);
  });
});
