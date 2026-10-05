import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `WorkoutSessionRecoveryModal.tsx` cannot be rendered in this project's
 * test suite (no React Native test renderer — same constraint documented in
 * `workoutScreenFinishStructure.test.ts`). This locks the long-session
 * alert's structure textually: single source of truth for elapsed time
 * (Firestore `execution.startedAt`, via the shared `workoutSessionTimer`
 * helpers), no locally-owned ticking, and a plain (non-alarming) fallback
 * for a normal, recently-started session.
 */
const source = readFileSync(new URL('../WorkoutSessionRecoveryModal.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../../screens/AppShell.tsx', import.meta.url), 'utf8');
const workoutScreen = readFileSync(new URL('../../../screens/WorkoutScreen.tsx', import.meta.url), 'utf8');

describe('WorkoutSessionRecoveryModal — long-session alert', () => {
  it('derives elapsed/format/threshold from the shared workoutSessionTimer module, never a reimplementation', () => {
    expect(source).toContain("from '../../lib/workoutSessionTimer'");
    expect(source).toContain('computeWorkoutElapsedSeconds');
    expect(source).toContain('formatWorkoutSessionDuration');
    expect(source).toContain('isLongWorkoutSession');
    expect(source).toContain('safeStartedAtMs');
  });

  it('reads elapsed time from execution.startedAt — Firestore is the only source of truth, never a second locally-tracked instant', () => {
    expect(source).toContain('safeStartedAtMs(execution.startedAt)');
  });

  it('never owns a setInterval/ticking loop — it is a short-lived decision surface, not the workout timer', () => {
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('shows the long-session copy only when isLongWorkoutSession is true, with a formatted duration interpolated', () => {
    expect(source).toMatch(/isLongSession\s*&&\s*durationLabel/);
    expect(source).toContain("t('sessionRecovery.longSessionBody', { duration: durationLabel })");
  });

  it('falls back to the plain, non-alarming copy for a normal (short) session', () => {
    expect(source).toContain("t('sessionRecovery.body')");
  });

  it('the long-session copy never replaces the modal title — only the body changes', () => {
    const titleAssignment = source.slice(source.indexOf('const title ='), source.indexOf('const body ='));
    expect(titleAssignment).not.toContain('longSession');
  });
});

describe('explicit recovery resolution — continue, finish, or discard', () => {
  it('removes "Agora não" and every dismiss callback from the recovery modal', () => {
    expect(source).not.toContain("t('sessionRecovery.later')");
    expect(source).not.toContain('onDismiss');
    expect(appShell).not.toContain('dismissRecovery');
    expect(appShell).not.toContain('onDismiss={dismissRecovery}');
  });

  it('keeps the orphan-pointer acknowledgement strictly unavailable to a real pending execution', () => {
    expect(source).toContain('{executionMissing && (');
    expect(source).toContain('onPress={onAcknowledgeMissing}');
    const start = appShell.indexOf('const acknowledgeMissingRecovery = () => {');
    const end = appShell.indexOf('const runWorkoutCompletion = (', start);
    const body = appShell.slice(start, end);
    expect(body).toContain("recovery.state.reason !== 'EXECUTION_MISSING'");
    expect(body).toContain('recovery.state.execution !== null');
    expect(body).toContain('recovery.resolve()');
  });

  it('does not dismiss on backdrop press or Android Back', () => {
    expect(source).toContain('onRequestClose={() => undefined}');
    const modalBody = source.slice(source.indexOf('<Modal'), source.indexOf('</Modal>'));
    expect(modalBody).toContain('<View\n        style={{ flex: 1');
    expect(modalBody).not.toContain('onPress={dismiss}');
  });

  it('renders the finish action with loading and disables every action while it is in flight', () => {
    expect(source).toContain("t('sessionRecovery.finishNow')");
    expect(source).toContain("t('sessionRecovery.finishing')");
    expect(source).toContain('const busy = resuming || finishing || discarding');
    expect(source).toContain('onPress={onFinish}');
    expect(source).toContain('disabled={busy}');
    expect(source).toContain("t('sessionRecovery.finishError')");
  });

  it('keeps Continue and Discard wired to their original, distinct handlers', () => {
    expect(appShell).toContain('onResume={() => { void handleResumeRecovery(); }}');
    expect(appShell).toContain('onDiscard={() => { void handleDiscardRecovery(); }}');
    expect(appShell).toContain('onFinish={handleFinishRecovery}');
  });

  it('guards same-tick finish double taps and retains recovery on failure', () => {
    const start = appShell.indexOf('const handleFinishRecovery = () => {');
    const end = appShell.indexOf('const retryWorkoutCompletion = async () =>', start);
    const body = appShell.slice(start, end);
    expect(body).toContain('recoveryFinishInFlightRef.current');
    expect(body).toContain("setRecoveryAction('finishing')");
    expect(body).toContain("if (result !== 'COMPLETED'");
    expect(body).toContain('setRecoveryFinishError(true)');
    const failedResultBranch = body.slice(
      body.indexOf("if (result !== 'COMPLETED'"),
      body.indexOf('// The callable result is the durable authority'),
    );
    expect(failedResultBranch).toContain('setRecoveryFinishError(true)');
    expect(failedResultBranch).toContain('return;');
    expect(failedResultBranch).not.toContain('recovery.resolve()');
  });

  it('finalizes the exact pointer execution through the shared authoritative callable', () => {
    const runStart = appShell.indexOf('const runWorkoutCompletion = (');
    const runEnd = appShell.indexOf('const handleFinishRecovery = () =>', runStart);
    const runBody = appShell.slice(runStart, runEnd);
    const finishStart = appShell.indexOf('const handleFinishRecovery = () =>');
    const finishEnd = appShell.indexOf('const retryWorkoutCompletion = async () =>', finishStart);
    const finishBody = appShell.slice(finishStart, finishEnd);
    expect(finishBody).toContain('loadWorkoutExecution(user.uid, recoveredPointer.executionId)');
    expect(finishBody).toContain('runWorkoutCompletion(true, undefined, mode, fresh)');
    expect(runBody).toContain('finalizeWorkoutSession({');
    expect(runBody).toContain('executionId: recoveredExecution.executionId');
    expect(runBody).toContain('execution.finalize(actualCardioDurationSeconds, mode, {');
    expect(runBody).toContain('attemptId,');
    expect(runBody).toContain('onCheckpoint: reportCheckpoint');
  });

  it('resolves recovery only after durable success and prepares the normal completion UI from a terminal Firestore reload', () => {
    const start = appShell.indexOf('const handleFinishRecovery = () => {');
    const end = appShell.indexOf('const retryWorkoutCompletion = async () =>', start);
    const body = appShell.slice(start, end);
    expect(body.indexOf('await runWorkoutCompletion')).toBeLessThan(body.indexOf('recovery.resolve()'));
    expect(body).toContain("['COMPLETED', 'PARTIALLY_COMPLETED'].includes(loaded.status)");
    expect(body).toContain('execution.adoptExecution(terminal)');
    expect(body).toContain("setTab('workout')");
    expect(body).toContain('workoutHomeSyncRef.current');
    expect(body).toContain('workoutCompletionFollowUpRef.current');
    expect(workoutScreen).toContain("execution?.status === 'COMPLETED' || execution?.status === 'PARTIALLY_COMPLETED'");
    expect(workoutScreen).toContain('execution.finishedAt.toMillis()');
  });
});
