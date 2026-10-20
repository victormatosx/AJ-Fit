import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('real load-progress wiring', () => {
  const progress = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');
  const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
  const workoutHook = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');
  const workoutScreen = readFileSync('src/screens/WorkoutScreen.tsx', 'utf8');
  const loadsView = readFileSync('src/components/fitness/LoadsEvolutionView.tsx', 'utf8');

  it('never uses preview load data', () => {
    expect(progress).not.toContain('PROGRESS_LOADS_PREVIEW');
    expect(progress).not.toContain('SHOW_PROGRESS_DESIGN_PREVIEW');
    expect(progress).toContain('useLoadProgressState()');
    expect(appShell).toContain('<LoadProgressProvider uid={user?.uid ?? null}>');
  });

  it('publishes an invalidation only after the queued set write resolves', () => {
    const recordBlock = workoutHook.slice(
      workoutHook.indexOf('const recordSet = useCallback'),
      workoutHook.indexOf('const skipSet = useCallback'),
    );
    expect(recordBlock.indexOf('await mutationQueueRef.current.enqueue')).toBeLessThan(
      recordBlock.indexOf('publishWorkoutLoadRefresh(uid, execution.executionId)'),
    );
  });

  it('offers the requested search, record list and four time ranges', () => {
    expect(loadsView).toContain('displayRecords.slice(0, 3)');
    expect(loadsView).toContain('progress.loads.seeAllRecords');
    expect(loadsView).toContain('<TextInput');

    const exerciseDetail = readFileSync('src/components/fitness/ExerciseEvolutionDetail.tsx', 'utf8');
    expect(exerciseDetail).toContain('LOAD_PROGRESS_PERIODS.map');
  });

  it('shares Evolution history with the workout without gating workout rendering', () => {
    // PR detection still runs off the all-time record, never rendered directly.
    expect(workoutScreen).toContain('derivePreviousExerciseRecords(loadHistory, execution?.executionId ?? null)');
    // The "next set" card renders the previous load for the exact upcoming
    // setIndex, falling back to the last valid load ever registered — never
    // the record.
    expect(workoutScreen).toContain('derivePreviousExerciseSetLoads(completedSetHistory, execution?.executionId ?? null)');
    expect(workoutScreen).toContain('derivePreviousExerciseLastLoad(loadHistory, execution?.executionId ?? null)');
    expect(workoutScreen).toContain('previousSetLoads[ex.db]?.[setIdx]');
    expect(workoutScreen).toContain('previousExerciseLastLoad[ex.db]');
    // The rest overlay's own weight field placeholder reuses this same
    // per-set source — never a separate "Carga anterior" text line (that
    // copy/key was removed), and never pre-filled into `regWeight`.
    expect(workoutScreen).toContain('previousLoadKg={previousSetLoads[ex.db]?.[pending ? pending.setIdx : setIdx] ?? undefined}');
    expect(workoutScreen).not.toContain("t('rest.previousLoad'");
    // The historical record load racing a set confirmation is handled by
    // queueing + replaying (`pendingPrChecksRef`/`replayQueuedPersonalRecordChecks`)
    // — never by blocking the screen's render on `loadsLoading`.
    expect(workoutScreen).not.toMatch(/if \(loadsLoading\) return (<|null|;\s*\/\/ block)/);
    expect(workoutScreen).toContain('pendingPrChecksRef');
    expect(workoutScreen).toContain('replayQueuedPersonalRecordChecks(');
  });
});
