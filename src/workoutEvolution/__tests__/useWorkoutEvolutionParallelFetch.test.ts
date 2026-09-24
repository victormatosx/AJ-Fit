import { describe, expect, it } from 'vitest';

describe('useWorkoutEvolution.load() pending-program fetch ordering', () => {
  it('starts the pending-program fetch before awaiting lifecycle events/notice, not after', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/workoutEvolution/useWorkoutEvolution.ts', 'utf8');
    const pendingProgramIndex = source.indexOf('const pendingProgramPromise');
    const eventsIndex = source.indexOf('listWorkoutLifecycleEventsForProgramInstance(');
    const awaitPendingProgramIndex = source.indexOf('await pendingProgramPromise');
    expect(pendingProgramIndex).toBeGreaterThan(-1);
    expect(pendingProgramIndex).toBeLessThan(eventsIndex);
    expect(awaitPendingProgramIndex).toBeGreaterThan(eventsIndex);
  });
});
