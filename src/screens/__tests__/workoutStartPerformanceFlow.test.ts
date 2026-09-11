import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const executionHook = readFileSync(
  new URL('../../workoutExecution/useWorkoutExecution.ts', import.meta.url),
  'utf8',
);
const executionService = readFileSync(
  new URL('../../services/workoutExecutions.ts', import.meta.url),
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
    'const resolvePendingExecutionAndRetry',
  );

  it('navigates to the workout surface before waiting for Firestore', () => {
    const navigate = startBody.indexOf("setTab('workout')");
    const remoteStart = startBody.indexOf('await execution.start(sessionIndex)');
    expect(navigate).toBeGreaterThanOrEqual(0);
    expect(remoteStart).toBeGreaterThan(navigate);
    expect(startBody.indexOf('setWorkoutStartPending(true)')).toBeLessThan(remoteStart);
  });

  it('reuses the bootstrap loading surface and never mounts WorkoutScreen without a confirmed execution', () => {
    expect(appShell).toContain(
      "tab === 'workout' && (workoutStartPending || execution.starting || (workoutInProgress && !execution.execution))",
    );
    expect(app).toContain("import { FullScreenLoading } from './src/components/ui/FullScreenLoading'");
    expect(app).toContain(': <FullScreenLoading />}');
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
    const afterAwait = startBody.slice(startBody.indexOf('await execution.start(sessionIndex)'));
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
    expect(startBody).toContain('if (workoutStartInFlightRef.current) return;');
    expect(startBody.indexOf('workoutStartInFlightRef.current = true')).toBeLessThan(
      startBody.indexOf('await execution.start(sessionIndex)'),
    );
    expect(executionHook).toContain('if (current.key === requestKey)');
    expect(executionHook).toContain('return current.promise;');
    expect(executionHook).toContain("'start_single_flight_rejected'");
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
    expect(serviceStart).toContain('getDocFromCache(ref)');
    expect(serviceStart).toContain("materialization = 'server-fallback'");
    expect(serviceStart).not.toContain('const result = await loadWorkoutExecution(uid, executionId);');
  });

  it('instruments visible navigation, transaction, materialization and final outcome', () => {
    expect(appShell).toContain("'start_surface_visible'");
    expect(appShell).toContain("'start_user_confirmed'");
    expect(executionHook).toContain("'start_execution_confirmed'");
    expect(executionHook).toContain("'start_failed'");
    expect(executionService).toContain("'start_transaction_completed'");
    expect(executionService).toContain("'start_materialization_completed'");
    expect(executionService).toContain("'start_legacy_check_completed'");
  });
});
