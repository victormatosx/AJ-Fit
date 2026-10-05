import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `WorkoutScreen.tsx` cannot be rendered in this project's test suite (no
 * React Native test renderer — `vitest.config.mts` only collects `.test.ts`
 * in a Node environment, see `workoutScreenFinishStructure.test.ts`). This
 * locks the session-duration fix textually: `elapsed` must be derived from
 * `workoutStartedAtMs` (wall clock), never from a `setElapsed(e => e + 1)`
 * tick counter — that pattern is exactly what silently dropped all
 * background/locked-screen time before this fix.
 */
const source = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const useWorkoutExecution = readFileSync(
  new URL('../../workoutExecution/useWorkoutExecution.ts', import.meta.url),
  'utf8',
);

describe('workout session duration — wall-clock, not a tick counter', () => {
  it('never reintroduces an incrementing elapsed-seconds counter', () => {
    expect(source).not.toContain('setElapsed(');
    expect(source).not.toMatch(/setElapsed\s*\(\s*\(?e\)?\s*=>\s*e\s*\+\s*1/);
  });

  it('derives elapsed from the authoritative finish time for terminal recovered executions', () => {
    expect(source).toContain("import { computeWorkoutElapsedSeconds } from '../lib/workoutSessionTimer';");
    expect(source).toContain('const sessionEndMs = finished && execution?.finishedAt');
    expect(source).toContain('execution.finishedAt.toMillis()');
    expect(source).toContain(
      'const elapsed = computeWorkoutElapsedSeconds(workoutStartedAtMs ?? sessionEndMs, sessionEndMs);',
    );
  });

  it('the per-second interval only forces a re-render (setSessionNow), it never increments a counter', () => {
    const effectStart = source.indexOf('useEffect(() => {\n    if (finished) return;\n    const t = setInterval');
    expect(effectStart).toBeGreaterThan(-1);
    const effectBody = source.slice(effectStart, source.indexOf('}, [finished]);', effectStart));
    expect(effectBody).toContain('setSessionNow(Date.now())');
    expect(effectBody).not.toContain('e + 1');
  });

  it('stops updating once the session is finished, freezing the displayed duration', () => {
    const tickEffectStart = source.indexOf('const t = setInterval(() => setSessionNow(Date.now()), 1000);');
    expect(tickEffectStart).toBeGreaterThan(-1);
    const guardedBlockStart = source.lastIndexOf('useEffect(() => {', tickEffectStart);
    const guardedBlock = source.slice(guardedBlockStart, tickEffectStart);
    expect(guardedBlock).toContain('if (finished) return;');
  });

  it('reconciles immediately on AppState foreground transitions instead of waiting for the next tick', () => {
    expect(source).toContain("AppState.addEventListener('change'");
    const listenerStart = source.indexOf("AppState.addEventListener('change'");
    const listenerBlock = source.slice(listenerStart, listenerStart + 200);
    expect(listenerBlock).toContain("next === 'active'");
    expect(listenerBlock).toContain('setSessionNow(Date.now())');
  });

  it('accepts workoutStartedAtMs as a prop instead of owning its own start instant', () => {
    expect(source).toMatch(/workoutStartedAtMs\?\s*:\s*number\s*\|\s*null/);
    expect(source).toContain('sessionIndex = 0, execution, workoutStartedAtMs,');
  });
});

describe('workoutStartedAtMs wiring — AppShell to WorkoutScreen', () => {
  it('AppShell passes the execution controller value straight through, no local Date.now() at mount', () => {
    expect(appShell).toContain('workoutStartedAtMs={execution.workoutStartedAtMs}');
  });
});

describe('useWorkoutExecution — canonical startedAt source', () => {
  it('uses persisted startedAt only when server-authoritative and keeps the local UI instant during reconciliation', () => {
    expect(useWorkoutExecution).toContain("execution.timestampAuthority === 'SERVER'");
    expect(useWorkoutExecution).toContain('? execution.startedAt.toMillis()');
    expect(useWorkoutExecution).toContain(': pendingStartedAtMsRef.current');
  });

  it('captures the local fallback synchronously inside startWithDates(), before any await — both start() and startAdvanced() funnel through it', () => {
    const startFnStart = useWorkoutExecution.indexOf('const startWithDates = useCallback((input:');
    const firstAwait = useWorkoutExecution.indexOf('await', startFnStart);
    const fallbackAssignment = useWorkoutExecution.indexOf('pendingStartedAtMsRef.current = Date.now();', startFnStart);
    expect(startFnStart).toBeGreaterThan(-1);
    expect(fallbackAssignment).toBeGreaterThan(startFnStart);
    expect(fallbackAssignment).toBeLessThan(firstAwait);
  });
});
