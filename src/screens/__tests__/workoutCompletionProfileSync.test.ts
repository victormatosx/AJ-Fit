import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  applyWorkoutCompletionNavigation,
  runWorkoutHomeProjectionSync,
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

  it('runs one handled background lifecycle follow-up without delaying it on Home reads', () => {
    const start = appShell.indexOf('runWorkoutCompletionFollowUp({');
    const followUp = appShell.slice(
      start,
      appShell.indexOf("logInfo('workout_performance', 'finish_flow_end'", start),
    );

    expect(followUp).toContain('processWorkoutLifecycleAfterSession');
    expect(followUp).toContain('evolution.refreshProjection()');
    expect(followUp).not.toContain('activitySnapshot.reload()');
    expect(followUp).not.toContain('frequencyWindow.reload()');
    expect(followUp).not.toContain('evolution.refresh()');
    expect(followUp).toContain('onLifecycleFailure:');
    expect(followUp).toContain('onProjectionFailure:');
  });

  it('synchronizes Schedule, weekly progress and frequency concurrently for Home', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const refreshSchedule = vi.fn(async () => { calls.push('schedule'); await pending; });
    const refreshWeek = vi.fn(async () => { calls.push('week'); await pending; });
    const refreshFrequency = vi.fn(async () => { calls.push('frequency'); await pending; });

    const sync = runWorkoutHomeProjectionSync({ refreshSchedule, refreshWeek, refreshFrequency });
    await Promise.resolve();
    expect(calls).toEqual(['schedule', 'week', 'frequency']);
    release();
    await expect(sync).resolves.toEqual({
      schedule: 'COMPLETED', week: 'COMPLETED', frequency: 'COMPLETED',
    });
    expect(refreshSchedule).toHaveBeenCalledOnce();
    expect(refreshWeek).toHaveBeenCalledOnce();
    expect(refreshFrequency).toHaveBeenCalledOnce();
  });

  it('starts Home synchronization only after durable completion and never awaits it before success', () => {
    const start = appShell.indexOf("logInfo('workout_performance', 'durable_completion_reached'");
    const success = appShell.indexOf('setWorkoutCompletionResult(result)', start);
    const branch = appShell.slice(start, success);
    expect(branch).toContain('workoutHomeSyncRef.current = runWorkoutHomeProjectionSync');
    expect(branch).not.toContain('await workoutHomeSyncRef.current');
    expect(branch).toContain("'home_sync_start'");
    expect(branch).toContain("'home_sync_end'");
  });

  it('awaits the existing Home sync before exposing Home without re-finalizing or writing a Schedule event', () => {
    const start = appShell.indexOf('const finishWorkoutSession = async () =>');
    const finish = appShell.slice(start, appShell.indexOf('// Abandon is already', start));
    expect(finish.indexOf('await Promise.all([')).toBeLessThan(finish.lastIndexOf("setTab('home')"));
    expect(finish).toContain('workoutHomeSyncRef.current');
    expect(finish).toContain('workoutCompletionFollowUpRef.current');
    expect(finish).not.toContain('finalizeWorkoutSession(');
    expect(finish).not.toContain('completeScheduledSession(');
    expect(finish).not.toContain('scheduleEvents');
    expect(finish).toContain("'home_ready_after_completion'");
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
