import { describe, expect, it } from 'vitest';
import { computeWorkoutElapsedSeconds } from '../workoutSessionTimer';

const STARTED_AT = 1_000_000;

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
