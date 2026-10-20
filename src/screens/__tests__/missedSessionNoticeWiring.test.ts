import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const HOOK = readFileSync('src/scheduleEngine/useWorkoutSchedule.ts', 'utf8');
const MODAL = readFileSync('src/components/schedule/MissedSessionDecisionModal.tsx', 'utf8');
const STORAGE = readFileSync('src/services/missedSessionNoticeStorage.ts', 'utf8');
/** Comments legitimately NAME the mechanisms this file avoids; assert on code. */
const STORAGE_CODE = STORAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const LOCALES = ['pt-BR', 'en', 'es'] as const;

/**
 * Wiring, not arithmetic — the detection is pinned by
 * `missedSessionNotice.test.ts`. What this file pins is that the notice the
 * pilot sees is the EXISTING Jotinha moment, reached from the existing tap,
 * and that answering it cannot move the rotation twice.
 */
describe('the existing Jotinha moment is reused, not replaced', () => {
  it('no second modal component was introduced', () => {
    // One AjMoment, one component, one visible condition. The modal file is
    // untouched by this feature: it still takes only presentation props.
    expect((MODAL.match(/<AjMoment/g) ?? [])).toHaveLength(1);
    expect(APP_SHELL).toContain('<MissedSessionDecisionModal');
    expect((APP_SHELL.match(/<MissedSessionDecisionModal/g) ?? [])).toHaveLength(1);
    expect(APP_SHELL).toContain("visible={startWorkoutFlow === 'missedDecision' || startWorkoutFlow === 'missedResolved'}");
  });

  it('reuses the same two-beat AJ conversation and its existing copy', () => {
    expect(MODAL).toContain("step={letter ? 'resolved' : 'decision'}");
    expect(MODAL).toContain("t('schedule.missedDecision.aj.question')");
    expect(MODAL).toContain("t('schedule.missedDecision.aj.continueSequence')");
    expect(MODAL).toContain("t('schedule.missedDecision.aj.followSchedule')");
    expect(MODAL).toContain("t('schedule.missedDecision.aj.resolvedContinueSequence'");
    expect(MODAL).toContain("t('schedule.missedDecision.aj.startSession'");
  });

  it('the pilot reaches it through the same requestStartWorkout tap', () => {
    const start = APP_SHELL.indexOf('const requestStartWorkout = useCallback(() => {');
    const fn = APP_SHELL.slice(start, APP_SHELL.indexOf('}, [workoutInProgress', start));
    // Recovery precedence still outranks it, exactly as for the legacy status.
    expect(fn.indexOf('if (recoveryModalOpen) return;'))
      .toBeLessThan(fn.indexOf('if (schedule.missedNotice) {'));
    expect(fn).toContain("setStartWorkoutFlow('missedDecision')");
  });

  it('the legacy reconciliation effect cannot close the pilot notice', () => {
    // Both identities are null for an enrolled account and
    // `sameMissedDecision(null, null)` is false, so without this guard the
    // effect jumped straight to the start confirmation on first render.
    const start = APP_SHELL.indexOf("if (startWorkoutFlow !== 'missedDecision' || missedDecisionPending) return;");
    const block = APP_SHELL.slice(start, APP_SHELL.indexOf('}, [missedDecisionContext', start));
    const guard = block.indexOf('if (schedule.missedNotice) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(block.indexOf('missedDecisionIdentity(schedule.resolution)'));
    expect(APP_SHELL).toContain('}, [missedDecisionContext, missedDecisionPending, schedule.missedNotice, schedule.resolution, startWorkoutFlow]);');
  });
});

describe('answering it moves the rotation at most once', () => {
  const body = () => {
    const start = HOOK.indexOf('const decideMissedNotice = useCallback(');
    expect(start).toBeGreaterThan(-1);
    return HOOK.slice(start, HOOK.indexOf('const dismissMissedNotice', start));
  };

  it('each answer SELECTS the session it will train', () => {
    const fn = body();
    // Recovering trains the pending session; following the schedule trains
    // the next one. Selecting the pending session for BOTH was the defect: it
    // left the suggestion ON the session being trained, so cancelling or
    // abandoning it offered the same session again.
    expect(fn).toContain("const target = decision === 'CONTINUE_SEQUENCE'\n          ? notice.pendingSessionIndex\n          : notice.skipToSessionIndex;");
    expect(fn).toContain('const next = await selectSession(target);');
    expect((fn.match(/selectSession\(/g) ?? [])).toHaveLength(1);
  });

  it('the started session is ALWAYS the one the notice showed', () => {
    // `target` is both what gets selected and what is returned, so the letter
    // in the AJ line and the session actually started cannot diverge.
    expect(body()).toContain('return target;');
    expect(body()).not.toContain('return next;');
  });

  it('the suggestion lands exactly one position past the trained session', () => {
    // `selectSession(X)` sets the suggestion to X+1 — pinned in the pure
    // module — so selecting the trained session is what makes
    // A→B (recover) and B→C (follow) both hold.
    const suggestion = readFileSync('src/scheduleEngine/sessionSuggestion.ts', 'utf8');
    expect(suggestion).toContain('const suggestedSessionIndex = suggestionAfter(sessionIndex, sessionCount);');
    expect(suggestion).toContain('return sessionCount > 0 ? (((sessionIndex + 1) % sessionCount) + sessionCount) % sessionCount : 0;');
  });

  it('exactly ONE position moves, never one per elapsed day', () => {
    expect(body()).not.toContain('missedOccurrenceCount');
  });

  it('cancelling or abandoning never reverts the advance', () => {
    const fn = body();
    // Nothing in the decision path undoes the selection, and the cancel path
    // only drops the local start target.
    expect(fn).not.toContain('revert');
    const cancel = APP_SHELL.slice(
      APP_SHELL.indexOf('const cancelMissDecision = () => {'),
      APP_SHELL.indexOf('};', APP_SHELL.indexOf('const cancelMissDecision = () => {')),
    );
    expect(cancel).not.toContain('selectSession');
    expect(cancel).toContain('setStartSessionOverride(null);');
    // Abandoning is handled by the execution service, which never writes
    // scheduleState at all — only the execution document's own status.
    const executions = readFileSync('src/services/workoutExecutions.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(executions).not.toContain('scheduleState');
    expect(executions).toContain("transaction.update(ref, { status: 'ABANDONED'");
  });

  it('recovering starts the pending session EXPLICITLY, not the moved pointer', () => {
    // The rotation has already advanced past it, so re-reading
    // `schedule.resolution.sessionIndex` here would start the NEXT session —
    // the user would answer "refazer o A" and get B.
    expect(APP_SHELL).toContain('const sessionIndex = startSessionOverride ?? schedule.resolution.sessionIndex;');
    expect(APP_SHELL).toContain('setStartSessionOverride(sessionIndex);');
    expect(APP_SHELL).toContain('sessionIndex={startSessionOverride ?? (schedule.resolution.status === \'SESSION_READY\'');
  });

  it('the explicit target is cleared on every exit, so it cannot leak', () => {
    // Success, both rollbacks, the confirmation cancel and the notice
    // dismissal all drop it.
    expect((APP_SHELL.match(/setStartSessionOverride\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('finalizing cannot advance a second time', () => {
    // Structural, in the pure module: completion recomputes
    // `suggestionAfter(sessionIndex)`, finds the pointer already there and
    // reports UNCHANGED. Pinned here so the wiring above cannot be read as
    // relying on a second advance.
    const suggestion = readFileSync('src/scheduleEngine/sessionSuggestion.ts', 'utf8');
    expect(suggestion).toContain('if (current.suggestedSessionIndex === suggestedSessionIndex) {');
    expect(suggestion).toContain("return { status: 'UNCHANGED', suggestion: current };");
  });

  it('a refused write is neither recorded nor reported as answered', () => {
    const fn = body();
    const refused = fn.indexOf('if (next === null) return null;');
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(fn.indexOf('rememberDecidedMissedNoticeId'));
  });

  it('is single-flighted, so a double tap cannot decide twice', () => {
    expect(body()).toContain('if (decideMissedNoticeInFlightRef.current) return decideMissedNoticeInFlightRef.current;');
  });

  it('never starts a workout itself — it hands over to the existing confirmation', () => {
    const start = APP_SHELL.indexOf('if (schedule.missedNotice) {', APP_SHELL.indexOf('const handleMissDecision'));
    const branch = APP_SHELL.slice(start, APP_SHELL.indexOf('if (!missedDecisionContext) return;', start));
    expect(branch).toContain("setStartWorkoutFlow('missedResolved')");
    expect(branch).toContain('setMissedResolved({ decision, sessionIndex })');
    expect(branch).not.toContain('execution.start');
    expect(branch).not.toContain('startWorkout(');
  });

  it('the explicit target never bypasses the daily limit or the real gate', () => {
    const start = APP_SHELL.indexOf('const startWorkout = async () => {');
    const fn = APP_SHELL.slice(start, APP_SHELL.indexOf('const sessionIndex = startSessionOverride', start));
    // The resolution still decides whether a session may start at all; the
    // override only chooses WHICH one, after that gate.
    expect(fn).toContain("SESSION_READY");
  });

  it('writes no retroactive execution anywhere in the flow', () => {
    // Nothing in this feature may date an execution in the past.
    expect(HOOK).not.toContain('performedLocalDate: notice');
    expect(body()).not.toContain('missedScheduledDate');
  });
});

describe('the decision is persisted so the same day is asked once', () => {
  it('dismissal counts as answered', () => {
    const start = APP_SHELL.indexOf('const cancelMissDecision = () => {');
    const fn = APP_SHELL.slice(start, APP_SHELL.indexOf('};', start));
    expect(fn).toContain('if (schedule.missedNotice) schedule.dismissMissedNotice();');
    const dismiss = HOOK.slice(HOOK.indexOf('const dismissMissedNotice = useCallback('));
    expect(dismiss).toContain('rememberDecidedMissedNoticeId(uid, missedNotice.noticeId)');
    // Dismissing must not touch the rotation.
    expect(dismiss.slice(0, dismiss.indexOf('}, [uid, missedNotice]);'))).not.toContain('selectSession');
  });

  it('is device-local, needing no Rules change or redeploy', () => {
    expect(STORAGE_CODE).toContain('AsyncStorage');
    expect(STORAGE_CODE).not.toContain('firebase');
    expect(STORAGE_CODE).not.toContain('pendingMissDecision');
    expect(STORAGE_CODE).not.toContain('firestore');
  });

  it('an unreadable store degrades to "nothing answered yet"', () => {
    expect(STORAGE_CODE).toContain('return [];');
  });

  /**
   * The degradation above is silent in the function's OWN output: `[]` means
   * both "nothing was ever answered" and "the read failed". Those two have
   * opposite meanings for the user — the second re-raises a day they already
   * dismissed — so each must leave a trace, or a reappearing notice is not
   * diagnosable after the fact.
   */
  it('both ways the set can be lost are logged, never silent', () => {
    for (const event of ['missed_notice_decided_read_failed', 'missed_notice_decided_write_failed']) {
      expect(STORAGE_CODE).toContain(`logWarn('workout_schedule', '${event}'`);
    }
    // No empty catch is left in the module.
    expect(STORAGE_CODE).not.toMatch(/catch\s*\{/);
    // The uid is derived into a key and never logged.
    expect(STORAGE_CODE).not.toContain('uid,\n      errorCode');
  });

  it('the reload reports what the notice decided and what it knew', () => {
    const start = HOOK.indexOf("logInfo('workout_schedule', 'schedule_resolved', {");
    const call = HOOK.slice(start, HOOK.indexOf('});', start));
    for (const field of ['enrolled: pilotEnrolled', 'missedNoticeId:', 'decidedNoticeCount']) {
      expect(call).toContain(field);
    }
    // `noticeId` is `(instanceId, missedDate)` — the uid never reaches a log.
    // Asserted on code only: the comment there legitimately names it.
    expect(call.replace(/\/\/.*$/gm, '')).not.toContain('uid');
  });

  it('the decided set is read with the other reload reads, not separately', () => {
    const start = HOOK.indexOf('const [suggestionState, workoutCreditedToday, decidedNoticeIds] = await Promise.all([');
    expect(start).toBeGreaterThan(-1);
    expect(HOOK.slice(start, start + 400)).toContain('loadDecidedMissedNoticeIds(uid)');
  });
});

describe('everything else is preserved', () => {
  it('legacy accounts keep the published MISSED_SESSION_DECISION_REQUIRED flow', () => {
    expect(APP_SHELL).toContain("if (schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {");
    expect(APP_SHELL).toContain('setMissedDecisionContext(missedDecisionIdentity(schedule.resolution))');
    expect(HOOK).toContain('await resolveMissedSession({');
    // The pilot branch runs first and never latches the legacy identity.
    const handler = APP_SHELL.slice(APP_SHELL.indexOf('const handleMissDecision'));
    expect(handler.indexOf('schedule.decideMissedNotice'))
      .toBeLessThan(handler.indexOf('schedule.resolveMiss'));
  });

  it('a legacy account never receives a notice', () => {
    expect(HOOK).toContain('setMissedNotice(pilotEnrolled ? noticeUpdate : null);');
  });

  it('the notice gates nothing: the resolution is still SESSION_READY', () => {
    // It is computed AFTER `result` is assigned and never feeds into it.
    const pilot = HOOK.indexOf('if (pilotEnrolled) {');
    expect(HOOK.indexOf('noticeUpdate = free.status', pilot))
      .toBeGreaterThan(HOOK.indexOf('result = free.status === ', pilot));
  });

  it('free selection, the daily limit, frequency and the streak are untouched', () => {
    expect(HOOK).toContain('const selectSession = useCallback((');
    expect(HOOK).toContain('hasWorkoutDailyCompletion(uid, todayLocalDate)');
    const fn = HOOK.slice(HOOK.indexOf('const decideMissedNotice = useCallback('));
    const scoped = fn.slice(0, fn.indexOf('const dismissMissedNotice'));
    // Answering the notice touches none of the neighbouring metrics.
    for (const token of ['streak', 'weeklyFrequency', 'workoutDailyCompletions', 'finalize']) {
      expect(scoped).not.toContain(token);
    }
  });

  it('the existing copy already covers both answers in every locale', () => {
    for (const locale of LOCALES) {
      const json = JSON.parse(readFileSync(`src/i18n/resources/${locale}/home.json`, 'utf8'));
      const aj = json.schedule.missedDecision.aj;
      expect(typeof aj.question).toBe('string');
      expect(typeof aj.continueSequence).toBe('string');
      expect(typeof aj.followSchedule).toBe('string');
      expect(aj.startSession).toContain('{{letter}}');
    }
  });
});
