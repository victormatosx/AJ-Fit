import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const executionHook = readFileSync(
  new URL('../../workoutExecution/useWorkoutExecution.ts', import.meta.url),
  'utf8',
);
const executionService = readFileSync(
  new URL('../../services/workoutExecutions.ts', import.meta.url),
  'utf8',
);
const workoutScreen = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const startSingleFlight = readFileSync(
  new URL('../../workoutExecution/startSingleFlight.ts', import.meta.url),
  'utf8',
);
const fullScreenLoading = readFileSync(
  new URL('../../components/ui/FullScreenLoading.tsx', import.meta.url),
  'utf8',
);
const workoutPreparingScreenUrl = new URL(
  '../../components/workout/WorkoutPreparingScreen.tsx',
  import.meta.url,
);

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('start workout performance and integrity flow', () => {
  const startBody = between(
    appShell,
    'const startWorkout = async () => {',
    'const startAdvancedWorkout = async () => {',
  );

  it('navigates to the workout surface before waiting for Firestore', () => {
    const navigate = startBody.indexOf("setTab('workout')");
    const remoteStart = startBody.indexOf('await execution.start(sessionIndex, {');
    expect(navigate).toBeGreaterThanOrEqual(0);
    expect(remoteStart).toBeGreaterThan(navigate);
    expect(startBody.indexOf('setWorkoutStartPending(true)')).toBeLessThan(remoteStart);
  });

  it('reuses the shared neutral loading surface and never mounts WorkoutScreen without a confirmed execution', () => {
    expect(appShell).toContain(
      "tab === 'workout' && (workoutStartPending || execution.starting || (workoutInProgress && !execution.execution))",
    );
    // The root splash (WordmarkSplash) is a single overlay owned by
    // App.tsx, unrelated to this component-level surface — see
    // bootstrapSplashWiring.test.ts. FullScreenLoading stays the surface
    // for every in-app loading moment, including this one.
    expect(appShell).toContain("import { FullScreenLoading } from '../components/ui/FullScreenLoading'");
    expect(appShell).toContain("<FullScreenLoading accessibilityLabel={t('preparing.title')} />");
    expect(appShell).toContain(
      'workoutInProgress && !workoutStartPending && !execution.starting && execution.execution && prescription.status',
    );
    expect(fullScreenLoading).toContain('<ActivityIndicator');
    expect(fullScreenLoading).toContain('backgroundColor: theme.colors.background');
    expect(fullScreenLoading).toContain("alignItems: 'center'");
    expect(fullScreenLoading).toContain("justifyContent: 'center'");
    expect(fullScreenLoading).toContain('accessibilityRole="progressbar"');
    expect(fullScreenLoading).toContain('accessibilityState={{ busy: true }}');
    expect(fullScreenLoading).not.toContain('<Pressable');
    expect(existsSync(workoutPreparingScreenUrl)).toBe(false);
  });

  it('swaps preparation for the normal workout in place after success', () => {
    const afterAwait = startBody.slice(startBody.indexOf('await execution.start(sessionIndex, {'));
    expect(afterAwait).toContain('setWorkoutInProgress(true)');
    expect(afterAwait).toContain('setWorkoutStartPending(false)');
    // The only workout navigation is the optimistic one before the await.
    expect(startBody.match(/setTab\('workout'\)/g)).toHaveLength(1);
  });

  it('rolls back to Home and reports an error when durable start fails', () => {
    const failure = between(startBody, 'if (!started) {', '// Persisted start succeeded.');
    expect(failure).toContain('setWorkoutStartPending(false)');
    expect(failure).toContain('setWorkoutInProgress(false)');
    expect(failure).toContain("setTab('home')");
    expect(failure).toContain('setStartWorkoutError(error)');
    expect(failure).not.toContain('<WorkoutScreen');
  });

  it('guards same-tick double confirm and reuses a same-session request in the hook', () => {
    expect(startBody).toContain('if (workoutStartInFlightRef.current) {');
    expect(startBody.indexOf('workoutStartInFlightRef.current = true')).toBeLessThan(
      startBody.indexOf('await execution.start(sessionIndex, {'),
    );
    expect(executionHook).toContain('beginWorkoutStartFlight(startInFlightRef, requestKey');
    expect(executionHook).toContain("flight.kind === 'reused'");
    expect(startSingleFlight).toContain("{ kind: 'reused', promise: current.promise }");
    expect(executionHook).toContain("'start_single_flight_rejected'");
  });

  it('installs the hook flight before its task can synchronously reject and always clears it after settlement', () => {
    expect(startSingleFlight.indexOf('ref.current = flight')).toBeLessThan(
      startSingleFlight.indexOf('.then(task)'),
    );
    expect(startSingleFlight).toContain('if (ref.current === flight) ref.current = null;');
    expect(executionHook).not.toContain("startInFlightRef.current = { key: requestKey, promise: operation }");
  });

  it('does not cancel a pending durable start on background/foreground transitions', () => {
    // The in-flight promise remains the single authority until its finally
    // block. If the process dies instead of merely backgrounding, the
    // existing proactive recovery hook resolves the persisted mutex on boot.
    expect(startBody).toContain('finally {');
    expect(startBody).toContain('workoutStartInFlightRef.current = false;');
    expect(startBody).not.toContain('AppState');
    expect(appShell).toContain('useWorkoutSessionRecovery(user?.uid ?? null)');
  });

  it('keeps the legacy safety check and durable transaction mutex', () => {
    expect(executionService).toContain("where('status', '==', 'IN_PROGRESS')");
    expect(executionHook).toContain('subscribeToInProgressWorkoutExecutionIds');
    expect(executionService).toContain('await runTransaction(db');
    expect(executionService).toContain('transaction.get(stateRef)');
    expect(executionService).toContain('transaction.set(stateRef');
  });

  it('removes the unconditional post-transaction server round trip', () => {
    const serviceStart = between(
      executionService,
      'export async function startOrResumeWorkoutExecution',
      '/** Loads an execution by id',
    );
    expect(serviceStart).toContain("{ kind: 'existing', execution: trackedExecution }");
    expect(serviceStart).toContain("timestampAuthority: 'LOCAL_UI_PROJECTION'");
    expect(serviceStart).toContain("source: 'committed-write-projection'");
    expect(serviceStart).not.toContain('getDocFromCache(ref)');
    expect(serviceStart).not.toContain('await loadWorkoutExecution(uid, executionId)');
    expect(executionHook).toContain('void loadWorkoutExecution(uid, result.executionId)');
  });

  it('removes the pointer peek and reuses prefetched preferences plus AppShell context', () => {
    expect(executionService).not.toContain("'start_pointer_peek_completed'");
    expect(executionService).not.toContain('const pointerPeek');
    expect(executionHook).toContain('subscribeToPermanentExerciseSubstitutionPreferences');
    expect(startBody).toContain('manualSubstitutionContext: manualSubstitutionContextState.context');
    expect(startBody).toContain('manualSubstitutionContextStatus: manualSubstitutionContextState.status');
  });

  it('does not delay the first usable frame with the old 240ms entrance fade', () => {
    expect(appShell).not.toContain('function WorkoutEntranceFade');
    expect(appShell).not.toContain('<WorkoutEntranceFade>');
  });

  it('keeps SESSION substitution as a post-start authoritative mutation and PERMANENT as creation-only materialization', () => {
    expect(executionService).toContain('resolvePermanentSubstitutionsForSession');
    expect(appShell).toContain('applyExerciseSubstitution({');
    expect(appShell).toContain('scope,');
    expect(appShell).toContain('await applyExerciseSubstitution');
  });

  it('instruments visible navigation, transaction, materialization and final outcome', () => {
    expect(appShell).toContain("'start_surface_visible'");
    expect(appShell).toContain("'start_user_confirmed'");
    expect(executionHook).toContain("'start_execution_confirmed'");
    expect(executionHook).toContain("'start_failed'");
    expect(executionService).toContain("'start_transaction_completed'");
    expect(executionService).toContain("'start_materialization_completed'");
    expect(executionService).toContain("'start_legacy_check_completed'");
    for (const marker of [
      'start_workout_confirmed',
      'preparing_visible',
      'execution_start',
      'transaction_start',
      'transaction_end',
      'execution_ready',
      'workout_screen_mount',
      'workout_screen_ready',
    ]) expect(`${appShell}\n${executionHook}\n${executionService}\n${workoutScreen}`).toContain(`'${marker}'`);
  });

});
