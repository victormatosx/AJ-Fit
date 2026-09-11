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
  ] satisfies Array<[WorkoutCompletionResult, boolean]>)('%s -> Home allowed: %s', (result, allowed) => {
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

  it('refreshes Profile evolution data even when another post-workout follow-up fails', () => {
    const afterSchedule = appShell.slice(
      appShell.indexOf('afterSchedule: async () => {'),
      appShell.indexOf("if (result === 'COMPLETED')"),
    );

    expect(afterSchedule).toContain('finally {');
    expect(afterSchedule).toContain('evolution.refresh()');
    expect(afterSchedule).toContain('activitySnapshot.reload()');
    expect(afterSchedule).toContain('frequencyWindow.reload()');
  });
});
