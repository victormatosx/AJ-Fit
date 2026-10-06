import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8');
const workout = readFileSync(new URL('../WorkoutScreen.tsx', import.meta.url), 'utf8');
const summary = readFileSync(
  new URL('../../components/workoutSummary/WorkoutSummaryScreen.tsx', import.meta.url),
  'utf8',
);

describe('workout finalization observability + retry UX', () => {
  it('never logs a finalize/retry failure through the __DEV__-gated logInfo/logDebug', () => {
    const retryFn = shell.slice(
      shell.indexOf('const retryWorkoutCompletion = async () => {'),
      shell.indexOf('useEffect(() => {\n    const subscription = AppState.addEventListener'),
    );
    const catchBlock = retryFn.slice(retryFn.indexOf('} catch (error) {'));
    expect(catchBlock).toContain("logError('workout_retry', error");
    expect(catchBlock).not.toContain("logInfo('workout_retry'");
  });

  it('logs the raw callable failure once, correlated by executionId, retry flag, boundary and duration', () => {
    expect(shell).toContain("logError('workout_finalize_callable', finalized.error, {");
    const logCall = shell.slice(
      shell.indexOf("logError('workout_finalize_callable', finalized.error, {"),
    );
    const body = logCall.slice(0, logCall.indexOf('});'));
    expect(body).toContain('executionId,');
    expect(body).toContain('isRetry: recovery,');
    expect(body).toContain('stage: workoutFinalizationFailureStage(finalized.error)');
    expect(body).toContain('durationMs: Date.now() - finishFlowStartedAtMs');
  });

  it('always logs both reconciliation outcomes (found and not-found), never only the happy path', () => {
    expect(shell).toContain('finalization_response_reconciled_from_authority');
    expect(shell).toContain('finalization_response_reconciliation_not_found');
    // Both must be logWarn (always-on), not logInfo (dev-only) — a lost
    // response is never routine telemetry.
    const reconciliationBlock = shell.slice(
      shell.indexOf('if (terminal) {', shell.indexOf('loadAuthoritativelyCommittedFinalization')),
      shell.indexOf("} catch (reconciliationError) {"),
    );
    expect(reconciliationBlock).toContain("logWarn('workout', 'finalization_response_reconciled_from_authority'");
    expect(reconciliationBlock).toContain("logWarn('workout', 'finalization_response_reconciliation_not_found'");
    expect(reconciliationBlock).not.toContain('logInfo');
  });

  it('classifies the failure once per attempt and keeps the category stable across the retry attempt itself', () => {
    expect(shell).toContain('workoutCompletionFailureCategory');
    expect(shell).toContain('setWorkoutCompletionFailureCategory(');
    expect(shell).toContain('finalized.ok ? null : classifyWorkoutFinalizationError(finalized.error)');
    // The attempt-start block (inside runWorkoutCompletion) must NOT reset
    // the category — only the leave/restart surfaces may, so a stale
    // category surviving into a new `finishing=true` window is exactly the
    // "this is a retry" signal WorkoutScreen relies on.
    const attemptStart = shell.slice(
      shell.indexOf('setWorkoutFinalizationProgress(\'WAITING\');\n    setWorkoutCompletionResult(null);'),
      shell.indexOf('setFinishingSession(true);'),
    );
    expect(attemptStart).not.toContain('setWorkoutCompletionFailureCategory');
  });

  it('threads the failure category down to WorkoutScreen and derives "retrying" only while finishing with a stale category', () => {
    expect(shell).toContain('completionFailureCategory={workoutCompletionFailureCategory}');
    expect(workout).toContain('retrying={!!finishing && completionFailureCategory != null}');
    expect(workout).toContain('failureCategory={!finishing ? (completionFailureCategory ?? null) : null}');
  });

  it('picks distinct, non-technical copy per failure category and falls back to the generic message otherwise', () => {
    expect(summary).toContain("case 'OFFLINE': return 'done.finishFailedOffline';");
    expect(summary).toContain("case 'TIMEOUT': return 'done.finishFailedTimeout';");
    expect(summary).toContain("default: return 'done.finishFailed';");
    // Never a raw Firebase/backend code or message reaches user-facing copy.
    expect(summary).not.toMatch(/t\(.*error\.(code|message)/);
  });

  it('gives the retry attempt its own label instead of silently repeating "Finalizando"', () => {
    expect(summary).toContain("retrying ? 'done.summary.finalization.retrying' : 'done.summary.finalization.processing'");
  });

  it('hides the failed state (and its retry CTA) for the exact duration of a new attempt, preventing a second tap', () => {
    expect(workout).toContain('completionFailed={!!completionFailed && !finishing}');
    expect(summary).toContain('{completionFailed && !committed ?');
  });

  it('CARDIO_COMPLETION_REQUIRED gets its own message key, distinct from the generic failure copy', () => {
    expect(summary).toContain("case 'CARDIO_COMPLETION_REQUIRED': return 'done.finishFailedCardioRequired';");
  });

  it('swaps the generic retry CTA for the cardio-resume action only when the category is CARDIO_COMPLETION_REQUIRED', () => {
    const errorBlock = summary.slice(
      summary.indexOf('{completionFailed && !committed ?'),
      summary.indexOf(') : !hasLocalData ?'),
    );
    expect(errorBlock).toContain("failureCategory === 'CARDIO_COMPLETION_REQUIRED' && onResumeCardioCompletion");
    expect(errorBlock).toContain('<CtaButton onPress={onResumeCardioCompletion}>{t(\'done.completeCardioCta\')}</CtaButton>');
    expect(errorBlock).toContain('<CtaButton onPress={onRetry}>{t(\'done.retry\')}</CtaButton>');
  });

  it('sends the user back into the existing cardio-finisher screen, never a new/invented flow', () => {
    const resumeFn = workout.slice(
      workout.indexOf('const resumeCardioCompletion = cardioFinisher'),
      workout.indexOf('onResumeCardioCompletion={resumeCardioCompletion}'),
    );
    expect(resumeFn).toContain('setFinished(false);');
    expect(resumeFn).toContain('setShowCardioFinisher(true);');
    // Only offered when there is actually a cardio finisher to resume —
    // otherwise `undefined`, and the summary screen falls back to the
    // generic retry rather than rendering a dead CTA.
    expect(workout).toContain('const resumeCardioCompletion = cardioFinisher\n      ? () => {');
    expect(workout).toContain('      : undefined;');
    // The exact same authoritative call the normal cardio-finish path uses —
    // no second finalize path invented for this error state.
    expect(workout).toContain(": onCardioCompleted(actualDurationSeconds ?? 0);");
  });
});
