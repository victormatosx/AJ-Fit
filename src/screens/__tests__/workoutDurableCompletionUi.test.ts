import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const composer = readFileSync(
  new URL('../../components/workoutShare/WorkoutShareComposer.tsx', import.meta.url),
  'utf8',
);

describe('workout durable-completion visual contract', () => {
  it('uses the final completion animation as the only finalization progress surface', () => {
    expect(workout).not.toContain("import { FullScreenLoading } from '../components/ui/FullScreenLoading'");
    expect(workout).toContain("nextName={t('done.finishing')}");
    expect(workout).toContain('finalCompletionAnimationElapsed');
  });

  it('last-set completion keeps its animation mounted until durability and minimum animation time', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    const advanceBody = workout.slice(
      workout.indexOf('const advanceAfterRest = ('),
      workout.indexOf("useEffect(() => {\n    if (restStatus !== 'expired'"),
    );
    expect(advanceBody).toContain("nextName: t('done.finishing')");
    expect(advanceBody).toContain('finalizesWorkout: true');
    expect(finishedBranch).toContain('!completionConfirmed || !finalCompletionAnimationElapsed || finishing');
    expect(finishedBranch).toContain('<ExerciseDoneOverlay');
    expect(finishedBranch).toContain('finalizingWorkout');
    expect(finishedBranch).not.toContain('<FullScreenLoading');
    expect(finishedBranch.indexOf('<ExerciseDoneOverlay')).toBeLessThan(finishedBranch.indexOf('<WorkoutShareComposer'));
  });

  it('cardio uses its completion animation while finalization runs in parallel', () => {
    const cardio = workout.slice(workout.indexOf('const finalizeNow = async () => {'), workout.indexOf('function WorkoutCompletionError'));
    expect(cardio).toContain("setFinishState('finalizing')");
    expect(cardio).toContain('Promise.all([persistence, completionAnimation])');
    expect(cardio).toContain("'cardio_persist_start'");
    expect(cardio).toContain("'cardio_persist_end'");
    expect(cardio).toContain("if (finishState === 'finalizing')");
    expect(cardio).toContain('<ExerciseDoneOverlay');
    expect(cardio).toContain('finalizingWorkout');
    expect(cardio).not.toContain('<FullScreenLoading');
  });

  it('Execution and Schedule are both awaited before success is confirmed', () => {
    const completion = shell.slice(shell.indexOf('let finalized:'), shell.indexOf("logInfo('workout_performance', 'finalize_request_end'"));
    expect(completion).toContain('await execution.finalize(actualCardioDurationSeconds, mode)');
    expect(completion).toContain('await finalizeWorkoutSession({');
    expect(completion).not.toContain('schedule.completeSession');
    expect(completion).toContain("if (result === 'COMPLETED')");
    expect(shell).toContain("completionConfirmed={workoutCompletionResult === 'COMPLETED'");
  });

  it('critical failure replaces success with a dedicated retry-only surface', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finishedBranch).toContain('if (completionFailed && !finishing)');
    expect(finishedBranch).toContain('<WorkoutCompletionError');
    expect(shell).toContain("workoutCompletionResult === 'EXECUTION_FAILED'");
    expect(shell).toContain("workoutCompletionResult === 'SCHEDULE_FAILED'");
  });

  it('share and the composer\'s close/exit affordance exist only inside the post-durable composer surface, never the error surface', () => {
    const error = workout.slice(workout.indexOf('function WorkoutCompletionError'));
    expect(composer).toContain('<ShareToRow');
    // The composer's header close is now the only exit (no separate "back
    // to home" CTA duplicating it — see the composer UX pass).
    expect(composer).toContain("t('done.shareComposer.close')");
    expect(error).not.toContain('<ShareToRow');
    expect(error).not.toContain("t('done.shareComposer.close')");
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
