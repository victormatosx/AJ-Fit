import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  applyWorkoutCompletionNavigation,
  runWorkoutCompletionSingleFlight,
  type WorkoutCompletionResult,
} from '../../workoutLifecycle/finishFlow';

const appShell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');

describe('completed workout -> Profile synchronization', () => {
  it.each([
    ['COMPLETED', true],
    ['EXECUTION_FAILED', false],
    ['SCHEDULE_FAILED', false],
    ['LIFECYCLE_FOLLOW_UP_FAILED', true],
  ] satisfies [WorkoutCompletionResult, boolean][])('%s -> Home allowed: %s', (result, allowed) => {
    const leaveWorkout = vi.fn();
    expect(applyWorkoutCompletionNavigation(result, leaveWorkout)).toBe(allowed);
    expect(leaveWorkout).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it('keeps the active local workout intact when durable completion fails', () => {
    const state = { workoutInProgress: true, tab: 'workout' };
    applyWorkoutCompletionNavigation('EXECUTION_FAILED', () => {
      state.workoutInProgress = false;
      state.tab = 'home';
    });
    expect(state).toEqual({ workoutInProgress: true, tab: 'workout' });
  });

  it('coalesces a same-tick double tap and releases the guard for a retry', async () => {
    const guard = { current: false };
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const task = vi.fn(() => pending);

    const first = runWorkoutCompletionSingleFlight(guard, task);
    const second = runWorkoutCompletionSingleFlight(guard, task);
    await expect(second).resolves.toBe(false);
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toBe(true);
    await expect(runWorkoutCompletionSingleFlight(guard, async () => undefined)).resolves.toBe(true);
  });

  it('runs one handled background lifecycle follow-up and refreshes projections without a second reconcile', () => {
    const start = appShell.indexOf('runWorkoutCompletionFollowUp({');
    const followUp = appShell.slice(
      start,
      appShell.indexOf("logInfo('workout_performance', 'finish_flow_end'", start),
    );

    expect(followUp).toContain('processWorkoutLifecycleAfterSession');
    expect(followUp).toContain('evolution.refreshProjection()');
    expect(followUp).toContain('activitySnapshot.reload()');
    expect(followUp).toContain('frequencyWindow.reload()');
    expect(followUp).not.toContain('evolution.refresh()');
    expect(followUp).toContain('onLifecycleFailure:');
    expect(followUp).toContain('onProjectionFailure:');
  });

  it('marks the durable boundary and retains, but does not await, the background follow-up', () => {
    const start = appShell.indexOf("if (result === 'COMPLETED')");
    const end = appShell.indexOf("logInfo('workout_performance', 'finish_flow_end'", start);
    const durableBranch = appShell.slice(start, end);

    expect(durableBranch).toContain("'durable_completion_reached'");
    expect(durableBranch).toContain('workoutCompletionFollowUpRef.current = runWorkoutCompletionFollowUp');
    expect(durableBranch).not.toContain('await runWorkoutCompletionFollowUp');
  });

  it('uses the settled durable result for Home instead of rerunning completion', () => {
    const start = appShell.indexOf('const finishWorkoutSession = async () =>');
    const finish = appShell.slice(start, appShell.indexOf('// Abandon is already', start));
    expect(finish).toContain('const result = workoutCompletionResult');
    expect(finish).toContain('?? (workoutCompletionRef.current');
  });
});
