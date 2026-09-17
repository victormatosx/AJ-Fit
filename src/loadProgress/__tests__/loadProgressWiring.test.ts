import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('real load-progress wiring', () => {
  const progress = readFileSync('src/screens/ProgressScreen.tsx', 'utf8');
  const workoutHook = readFileSync('src/workoutExecution/useWorkoutExecution.ts', 'utf8');
  const loadsView = readFileSync('src/components/fitness/LoadsEvolutionView.tsx', 'utf8');

  it('never uses preview load data', () => {
    expect(progress).not.toContain('PROGRESS_LOADS_PREVIEW');
    expect(progress).not.toContain('SHOW_PROGRESS_DESIGN_PREVIEW');
    expect(progress).toContain('useLoadProgress(user?.uid ?? null)');
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
    expect(loadsView).toContain('recordsLast90Days.slice(0, 3)');
    expect(loadsView).toContain('progress.loads.seeAllRecords');
    expect(loadsView).toContain('<TextInput');
    expect(loadsView).toContain('LOAD_PROGRESS_PERIODS.map');
  });
});
