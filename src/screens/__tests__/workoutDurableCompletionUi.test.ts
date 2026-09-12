import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const loading = readFileSync(new URL('../../components/ui/FullScreenLoading.tsx', import.meta.url), 'utf8');

describe('workout durable-completion visual contract', () => {
  it('uses the existing app-wide FullScreenLoading with localized visible copy', () => {
    expect(workout).toContain("import { FullScreenLoading } from '../components/ui/FullScreenLoading'");
    expect(workout).toContain("message={t('done.finishing')}");
    expect(loading).toContain('message?: string');
  });

  it('last-set completion renders loading before AppShell effects can confirm durability', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finishedBranch.indexOf('if (!completionConfirmed && !completionFailed)')).toBeLessThan(finishedBranch.indexOf('<WorkoutDone'));
    expect(finishedBranch).toContain('<FullScreenLoading');
  });

  it('cardio enters that same loading surface while server-authoritative persistence is pending', () => {
    const cardio = workout.slice(workout.indexOf('const finalizeNow = async () => {'), workout.indexOf('function WorkoutDone'));
    expect(cardio).toContain("setFinishState('persisting')");
    expect(cardio).toContain("'cardio_persist_start'");
    expect(cardio).toContain("'cardio_persist_end'");
    expect(cardio).toContain("if (finishState === 'persisting')");
    expect(cardio).toContain('<FullScreenLoading');
  });

  it('Execution and Schedule are both awaited before success is confirmed', () => {
    const completion = shell.slice(shell.indexOf('const finalized = await execution.finalize'), shell.indexOf("logInfo('workout_performance', 'finalize_request_end'"));
    expect(completion).toContain('await execution.finalize(actualCardioDurationSeconds)');
    expect(completion).not.toContain('schedule.completeSession');
    expect(completion).toContain("if (result === 'COMPLETED')");
    expect(shell).toContain("completionConfirmed={workoutCompletionResult === 'COMPLETED'");
  });

  it('critical failure replaces success with a dedicated retry-only surface', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finishedBranch).toContain('if (completionFailed)');
    expect(finishedBranch).toContain('<WorkoutCompletionError');
    expect(shell).toContain("workoutCompletionResult === 'EXECUTION_FAILED'");
    expect(shell).toContain("workoutCompletionResult === 'SCHEDULE_FAILED'");
  });

  it('share and Home exist only inside the post-durable WorkoutDone surface', () => {
    const done = workout.slice(workout.indexOf('function WorkoutDone('), workout.indexOf('function WorkoutCompletionError'));
    const error = workout.slice(workout.indexOf('function WorkoutCompletionError'));
    expect(done).toContain("t('done.share')");
    expect(done).toContain("t('done.backHome')");
    expect(error).not.toContain("t('done.share')");
    expect(error).not.toContain("t('done.backHome')");
  });

  it('records the render-only delay after the durable boundary', () => {
    expect(shell).toContain("'durable_completion_reached'");
    expect(workout).toContain("'success_screen_visible'");
    expect(workout).toContain('durationFromDurableMs');
  });

  it('retains single-flight guards for completion and cardio double taps', () => {
    expect(shell).toContain('runWorkoutCompletionSingleFlight(finishSessionInFlightRef');
    expect(workout).toContain('if (finishingRef.current) return;');
  });
});
