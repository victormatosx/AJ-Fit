import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const composer = readFileSync(
  new URL('../../components/workoutShare/WorkoutShareComposer.tsx', import.meta.url),
  'utf8',
);
const summary = readFileSync(
  new URL('../../components/workoutSummary/WorkoutSummaryScreen.tsx', import.meta.url),
  'utf8',
);
const progress = readFileSync(
  new URL('../../workoutLifecycle/finalizationProgress.ts', import.meta.url),
  'utf8',
);

describe('workout durable-completion visual contract', () => {
  it('opens the summary directly and removes the former timed finalization barrier', () => {
    expect(workout).not.toContain("import { FullScreenLoading } from '../components/ui/FullScreenLoading'");
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('// Completing the last strength exercise'));
    expect(finishedBranch).toContain('<WorkoutSummaryScreen');
    expect(finishedBranch).not.toContain('<ExerciseDoneOverlay');
    expect(workout).not.toContain('FINAL_COMPLETION_ANIMATION_MS');
    expect(workout).not.toContain('finalCompletionAnimationElapsed');
  });

  it('maps only real checkpoints to the five allowed percentages', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(progress).toContain('WAITING: 0');
    expect(progress).toContain('CLIENT_READY: 25');
    expect(progress).toContain('SERVER_ACCEPTED: 50');
    expect(progress).toContain('PREFLIGHT_VALIDATED: 75');
    expect(progress).toContain('COMMITTED: 100');
    expect(finishedBranch).toContain("completionConfirmed ? 'COMMITTED' : finalizationProgress");
    expect(summary).toContain('<FinalizationProgressRing');
    expect(summary).not.toContain('percentageBasisPoints / 100');
    expect(summary).not.toContain('setTimeout');
  });

  it('cardio reveals the summary before awaiting persistence and clears recovery only after success', () => {
    const cardio = workout.slice(workout.indexOf('const finalizeNow = async () => {'), workout.indexOf('/* ───────────────────────── COMPLETED SET EDITOR'));
    expect(cardio).toContain('const result = await onFinalizationStarted(');
    expect(cardio).not.toContain('completionAnimation');
    expect(cardio).toContain("'cardio_persist_start'");
    expect(cardio).toContain("'cardio_persist_end'");
    const durableSuccess = shell.slice(shell.indexOf("if (result === 'COMPLETED')"));
    expect(shell).toContain("if (result === 'COMPLETED' && hasCardioFinisher) void clearCardioSession()");
    expect(cardio).not.toContain('void clearCardioSession()');
    expect(cardio).not.toContain('publish(finishedSession)');
  });

  it('Execution and Schedule are both awaited before success is confirmed', () => {
    const completion = shell.slice(shell.indexOf('let finalized:'), shell.indexOf("logInfo('workout_performance', 'finalize_request_end'"));
    expect(completion).toContain('await execution.finalize(actualCardioDurationSeconds, mode, {');
    expect(completion).toContain('await finalizeWorkoutSession({');
    expect(completion).not.toContain('schedule.completeSession');
    expect(completion).toContain("if (result === 'COMPLETED')");
    expect(shell).toContain("isAuthoritativelyCommitted: (result) => result === 'COMPLETED'");
    expect(shell).toContain("completionConfirmed={workoutCompletionResult === 'COMPLETED'");
  });

  it('critical failure stays on the summary with retry but without close/share', () => {
    const finishedBranch = workout.slice(workout.indexOf('if (finished) {'), workout.indexOf('if (showCardioFinisher'));
    expect(finishedBranch).toContain('completionFailed={!!completionFailed && !finishing}');
    expect(summary).toContain('disabled={!contentReady}');
    expect(summary).toContain('const committed = completionConfirmed');
    expect(summary).toContain('{contentReady ? <View');
    expect(summary).toContain('<CtaButton onPress={onRetry}>');
    expect(shell).toContain("workoutCompletionResult === 'EXECUTION_FAILED'");
    expect(shell).toContain("workoutCompletionResult === 'SCHEDULE_FAILED'");
  });

  it('share and the composer\'s close/exit affordance exist only inside the post-durable composer surface, never the error surface', () => {
    expect(composer).toContain('<ShareToRow');
    // The composer's header close is now the only exit (no separate "back
    // to home" CTA duplicating it — see the composer UX pass).
    expect(composer).toContain("t('done.shareComposer.close')");
    expect(summary).not.toContain('<ShareToRow');
    expect(summary).not.toContain("t('done.shareComposer.close')");
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
