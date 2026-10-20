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
 *
 * The modal's BODY became an `AjMoment` (the AJ assistant presents the same
 * decision), so the assertions below moved from JSX props to the option
 * descriptors handed to that overlay. The invariants they pin are unchanged
 * and deliberately not weakened: three separate actions wired to three
 * distinct handlers, discard only through its own confirmation sub-step, no
 * dismiss path of any kind for a real execution, and the orphan-pointer
 * acknowledgement reachable only from EXECUTION_MISSING.
 */
const source = readFileSync(new URL('../WorkoutSessionRecoveryModal.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../../screens/AppShell.tsx', import.meta.url), 'utf8');
const workoutScreen = readFileSync(new URL('../../../screens/WorkoutScreen.tsx', import.meta.url), 'utf8');
const ajMoment = readFileSync(new URL('../../aj/AjMoment.tsx', import.meta.url), 'utf8');
/** Same comment-stripping convention `missedWorkoutDecisionFlow.test.ts` uses. */
const sourceCode = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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
    // It is the ONLY option built in the `executionMissing` branch, and that
    // branch is mutually exclusive with the one that offers resume/finish/
    // discard — an orphan pointer can never reach a real action, and a real
    // pending execution can never reach this escape.
    expect(source).toContain('} else if (executionMissing) {');
    expect(source).toContain('onPress: onAcknowledgeMissing,');
    const missingBranch = source.slice(
      source.indexOf('} else if (executionMissing) {'),
      source.indexOf('} else {', source.indexOf('} else if (executionMissing) {')),
    );
    expect(missingBranch).toContain('onPress: onAcknowledgeMissing,');
    expect(missingBranch).not.toContain('onResume');
    expect(missingBranch).not.toContain('onFinish');
    expect(missingBranch).not.toContain('onDiscard');
    const start = appShell.indexOf('const acknowledgeMissingRecovery = () => {');
    const end = appShell.indexOf('const runWorkoutCompletion = (', start);
    const body = appShell.slice(start, end);
    expect(body).toContain("recovery.state.reason !== 'EXECUTION_MISSING'");
    expect(body).toContain('recovery.state.execution !== null');
    expect(body).toContain('recovery.resolve()');
  });

  it('does not dismiss on backdrop press or Android Back', () => {
    // `dismissible={false}` is what AjMoment turns into "no close button,
    // inert backdrop, inert Android Back" — the single switch that replaced
    // the old inert `<View>` backdrop and `onRequestClose={() => undefined}`.
    expect(source).toContain('dismissible={false}');
    expect(source).not.toContain('dismissible\n');
    expect(source).not.toContain('onDismiss');
    expect(ajMoment).toContain('onRequestClose={dismissible && !busy ? requestDismiss : () => undefined}');
    expect(ajMoment).toContain('disabled={!dismissible || busy}');
    const requestDismissBody = ajMoment.slice(
      ajMoment.indexOf('const requestDismiss = () => {'),
      ajMoment.indexOf('};', ajMoment.indexOf('const requestDismiss = () => {')),
    );
    expect(requestDismissBody).toContain('if (!dismissible || busy || !onDismiss) return;');
  });

  it('renders the finish action with loading and disables every action while it is in flight', () => {
    expect(source).toContain("t('sessionRecovery.finishNow')");
    expect(source).toContain("t('sessionRecovery.finishing')");
    expect(source).toContain('const busy = resuming || finishing || discarding');
    expect(source).toContain('onPress: onFinish,');
    expect(source).toContain('loading: finishing,');
    // Every option built in the normal branch carries `disabled: busy`, so a
    // second tap can never fire a second resolution.
    expect(source.match(/disabled: busy,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("t('sessionRecovery.finishError')");
  });

  it('offers the three real actions as three separate options, each under its original condition', () => {
    expect(source).toContain('const resumeOffered = canResume && state.status === \'pending\';');
    expect(source).toContain('if (resumeOffered) {');
    expect(source).toContain('if (canFinalize && execution) {');
    expect(source).toContain('if (canDiscard) {');
    expect(source).toContain('onPress: onResume,');
    expect(source).toContain('onPress: onFinish,');
    // Discard still never fires straight from its own row.
    expect(source).toContain('onPress: requestDiscard,');
    expect(source).toContain('onPress: onDiscard,');
    const discardRow = source.slice(source.indexOf("key: 'discard',"), source.indexOf("key: 'discard',") + 200);
    expect(discardRow).not.toContain('onDiscard');
  });

  it('keeps the discard confirmation as its own sub-step, with both answers intact', () => {
    expect(source).toContain('if (confirmingDiscard) {');
    expect(source).toContain("t('sessionRecovery.discardConfirmYes')");
    expect(source).toContain("t('sessionRecovery.discardConfirmBack')");
    expect(source).toContain('onPress: cancelDiscardConfirm,');
    expect(source).toContain('loading: discarding,');
    expect(source).toContain("t('sessionRecovery.discardError')");
    // The sub-step is a distinct `step`, so AJ retypes instead of the lines
    // mutating mid-sentence.
    expect(source).toContain("step={confirmingDiscard ? 'discardConfirm' : executionMissing ? 'missing' : 'main'}");
  });

  it('never promises anything the app cannot do — no cycle freeze, no "sets do not count against the streak"', () => {
    // The design prototype offered both; neither exists in the app. Checked
    // against the CODE only (comments stripped), since this file's own doc
    // comment has to name what was deliberately left out.
    expect(sourceCode).not.toMatch(/freeze|congel|streak|sequência/i);
    // Every string this modal speaks still comes from i18n — a fabricated
    // promise could only arrive as a literal, and there are none.
    expect(sourceCode).not.toMatch(/label: ['"]/);
    // Discard's real consequence is still stated by the existing copy alone.
    expect(source).toContain("t('sessionRecovery.discardConfirmBody')");
  });

  it('speaks the body the existing logic chose, and ends on a question that matches the actions actually offered', () => {
    expect(source).toContain('const lines = [...(identityLine ? [identityLine] : []), body, question];');
    // No "continue where you left off?" when resuming is not one of the answers.
    expect(source).toContain("? t('sessionRecovery.aj.question')");
    expect(source).toContain(": t('sessionRecovery.aj.questionNoResume');");
    expect(source).toMatch(/const question = confirmingDiscard \|\| executionMissing[\s\S]*resumeOffered/);
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
