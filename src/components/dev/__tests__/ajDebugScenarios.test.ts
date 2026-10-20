import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AJ_DEBUG_RESOLVE_MS,
  AJ_DEBUG_SCENARIOS,
  fakeExecution,
} from '../ajDebugScenarios';
import {
  computeWorkoutElapsedSeconds,
  isLongWorkoutSession,
  safeStartedAtMs,
} from '../../../lib/workoutSessionTimer';
import type { WorkoutSessionRecoveryState } from '../../../workoutExecution/useWorkoutSessionRecovery';

/**
 * The AJ preview tool is only useful if it is both faithful (it drives the
 * REAL components through prop sets they could genuinely receive) and inert
 * (it can never resolve a decision or write anything). These lock both, plus
 * the one scenario whose correctness isn't obvious by inspection: the
 * long-session variant has to actually cross the 4h threshold, computed the
 * same way the modal computes it.
 */
const panel = readFileSync(new URL('../AjDebugPanel.tsx', import.meta.url), 'utf8');
const scenarios = readFileSync(new URL('../ajDebugScenarios.ts', import.meta.url), 'utf8');

/** Narrows a scenario by id, failing loudly if the table ever reshapes under these tests. */
function recoveryScenario(id: string) {
  const found = AJ_DEBUG_SCENARIOS.find((item) => item.id === id);
  if (found?.kind !== 'recovery') throw new Error(`scenario "${id}" is not a recovery scenario`);
  return found;
}

/** The same narrowing the real modal does to reach `state.execution`. */
function executionOf(state: WorkoutSessionRecoveryState) {
  return state.status === 'pending' || state.status === 'inconsistent' ? state.execution : null;
}

function elapsedMinutes(state: WorkoutSessionRecoveryState): number {
  const startedAtMs = safeStartedAtMs(executionOf(state)?.startedAt);
  if (startedAtMs === null) throw new Error('scenario has no readable startedAt');
  return computeWorkoutElapsedSeconds(startedAtMs, Date.now()) / 60;
}

describe('AJ debug scenarios', () => {
  it('covers every branch of all three moments plus the mascot lab', () => {
    const ids = AJ_DEBUG_SCENARIOS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'missed-success',
      'missed-failure',
      'missed-refreshing',
      'recovery-normal',
      'recovery-long',
      'recovery-mismatch',
      'recovery-terminal',
      'recovery-missing',
      'recovery-failure',
      'paused',
      'bot',
    ]));
    expect(AJ_DEBUG_SCENARIOS.every((item) => item.label.length > 0 && item.note.length > 0)).toBe(true);
  });

  it('reaches both outcomes for each decision surface, so the retryable-error path is previewable', () => {
    for (const kind of ['missed', 'recovery'] as const) {
      const outcomes = AJ_DEBUG_SCENARIOS
        .filter((item) => item.kind === kind)
        .map((item) => (item.kind === 'missed' || item.kind === 'recovery' ? item.outcome : null));
      expect(outcomes.length).toBeGreaterThan(1);
      expect(outcomes).toContain('success');
      expect(outcomes).toContain('failure');
    }
  });

  it('the long-session scenario really crosses the 4h threshold, measured exactly as the modal measures it', () => {
    const long = recoveryScenario('recovery-long');
    expect(executionOf(long.state)).not.toBeNull();
    expect(isLongWorkoutSession(elapsedMinutes(long.state) * 60)).toBe(true);
  });

  it('the normal scenario stays below the threshold, so it previews the plain copy', () => {
    const normal = recoveryScenario('recovery-normal');
    expect(isLongWorkoutSession(elapsedMinutes(normal.state) * 60)).toBe(false);
  });

  it('the orphan-pointer scenario carries no execution, which is what makes it an orphan', () => {
    const missing = recoveryScenario('recovery-missing');
    expect(missing.state.status).toBe('inconsistent');
    expect(executionOf(missing.state)).toBeNull();
    expect(missing.canResume).toBe(false);
    expect(missing.canFinalize).toBe(false);
  });

  it('fakeExecution produces a startedAt the real timer helpers can read', () => {
    const execution = fakeExecution(90);
    const ms = safeStartedAtMs(execution.startedAt);
    expect(ms).not.toBeNull();
    expect(Math.round(computeWorkoutElapsedSeconds(ms as number, Date.now()) / 60)).toBe(90);
    expect(execution.status).toBe('IN_PROGRESS');
  });

  it('simulates a latency long enough to actually see a spinner', () => {
    expect(AJ_DEBUG_RESOLVE_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('AJ debug panel — inert and dev-only', () => {
  it('never mounts outside a dev build', () => {
    expect(panel).toContain("if (typeof __DEV__ === 'undefined' || !__DEV__) return null;");
  });

  it('cannot open on top of a real overlay — it reuses AppShell\'s own gate', () => {
    const appShell = readFileSync(new URL('../../../screens/AppShell.tsx', import.meta.url), 'utf8');
    expect(appShell).toContain('<AjDebugPanel visible={ajMomentsAllowed} />');
    expect(panel).toContain('if (!visible) return null;');
  });

  it('writes nothing: no service, no callable, no persistence, no schedule resolution', () => {
    for (const source of [panel, scenarios]) {
      expect(source).not.toMatch(/resolveMiss|finalizeWorkoutSession|abandonWorkoutExecution|adoptExecution/);
      expect(source).not.toMatch(/setDoc|updateDoc|deleteDoc|runTransaction|httpsCallable|AsyncStorage|SecureStore/);
    }
    // The only firebase touch is building an in-memory Timestamp value.
    expect(scenarios).toContain("import { Timestamp } from 'firebase/firestore';");
    expect(scenarios).not.toMatch(/getFirestore|collection\(|doc\(/);
  });

  it('previews the real components rather than a second copy of their layout', () => {
    expect(panel).toContain("import { MissedSessionDecisionModal } from '../schedule/MissedSessionDecisionModal';");
    expect(panel).toContain("import { WorkoutSessionRecoveryModal } from '../workout/WorkoutSessionRecoveryModal';");
    expect(panel).toContain("import { AjCyclePausedMoment } from '../aj/AjCyclePausedMoment';");
    // No hand-rolled AjMoment call site that could drift from the real ones.
    expect(panel).not.toContain('<AjMoment');
  });

  it('routes every answer to a log, never to a real handler', () => {
    // The panel's entire prop surface is `visible` — it is handed no real
    // callback at all, so no answer can reach one. Everything the previewed
    // components call is a local arrow defined in this file.
    expect(panel).toContain('export function AjDebugPanel({\n  visible,\n}: {\n');
    const pausedBlock = panel.slice(
      panel.indexOf("if (scenario.kind === 'paused')"),
      panel.indexOf('return <AjBotLab'),
    );
    expect(pausedBlock).toContain('onStartWorkout={() => {');
    expect(pausedBlock).toContain('console.log');
  });

  it('clears its simulated-latency timer on unmount', () => {
    expect(panel).toContain('if (timerRef.current) clearTimeout(timerRef.current);');
    expect(panel).toContain('useEffect(() => () => {');
  });

  it('reads Reduce Motion from the OS instead of offering a fake switch for it', () => {
    expect(panel).toContain('const reduceMotion = useReducedMotionPreference();');
    expect(panel).not.toMatch(/setReduceMotion|value=\{reduceMotion\}\s+onValueChange/);
  });
});
