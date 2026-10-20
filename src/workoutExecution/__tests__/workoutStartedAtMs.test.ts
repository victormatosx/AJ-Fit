import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { computeWorkoutElapsedSeconds } from '../../lib/workoutSessionTimer';

const HOOK = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');

/**
 * Regression: every successfully finalized workout reported "0 MIN".
 *
 * `finalize` flips `timestampAuthority` to `LOCAL_UI_PROJECTION` (correctly —
 * the status/completion/cardio fields it patches in memory ARE projections),
 * which routed `workoutStartedAtMs` to `pendingStartedAtMsRef`. That ref is
 * cleared the moment the start reconciles, so it is null by then, and
 * `computeWorkoutElapsedSeconds(end, end)` is exactly 0 — the summary header
 * and every share poster then showed a zero-minute session.
 *
 * Observed on device: an execution spanning 11:07:06Z -> 11:16:47Z (9m41s)
 * rendered as "0 MIN"; the only session that showed a real duration was one
 * whose finalization FAILED, leaving the authority untouched.
 */
describe('the session start instant survives finalization', () => {
  it('falls back to the execution\'s own startedAt when the pending ref is empty', () => {
    const start = HOOK.indexOf('const workoutStartedAtMs = execution');
    expect(start).toBeGreaterThan(-1);
    const expr = HOOK.slice(start, HOOK.indexOf(';', start));
    expect(expr).toContain('pendingStartedAtMsRef.current ?? execution.startedAt?.toMillis() ?? null');
  });

  it('still prefers the pending ref while a START is unreconciled', () => {
    // The ref is the trustworthy value in that window, so it must be read
    // FIRST — the execution's local `startedAt` is only the fallback.
    const start = HOOK.indexOf('const workoutStartedAtMs = execution');
    const expr = HOOK.slice(start, HOOK.indexOf(';', start));
    expect(expr.indexOf('pendingStartedAtMsRef.current ??'))
      .toBeLessThan(expr.indexOf('execution.startedAt?.toMillis()'));
  });

  it('leaves the SERVER-authority path exactly as it was', () => {
    const start = HOOK.indexOf('const workoutStartedAtMs = execution');
    const expr = HOOK.slice(start, HOOK.indexOf(';', start));
    expect(expr).toContain("execution.timestampAuthority === 'SERVER'\n      ? execution.startedAt.toMillis()");
  });

  it('finalization is still what downgrades the authority (the cause is unchanged)', () => {
    // The fix is deliberately in the derivation, not in `finalize`: those
    // fields really are local projections after the call.
    const start = HOOK.indexOf('logInfo(\'workout_execution\', \'execution_finalization_succeeded\'');
    const before = HOOK.slice(HOOK.lastIndexOf('setExecution((prev) => {', start), start);
    expect(before).toContain("timestampAuthority: 'LOCAL_UI_PROJECTION'");
  });
});

describe('the elapsed computation this feeds', () => {
  it('is exactly zero when the start instant is lost — the bug\'s signature', () => {
    const end = 1_792_494_000_000;
    expect(computeWorkoutElapsedSeconds(end, end)).toBe(0);
  });

  it('reports the real span once the start instant is kept', () => {
    const started = Date.parse('2026-10-20T11:07:06.509Z');
    const finished = Date.parse('2026-10-20T11:16:47.685Z');
    expect(computeWorkoutElapsedSeconds(started, finished)).toBe(581); // 9m41s
  });
});
