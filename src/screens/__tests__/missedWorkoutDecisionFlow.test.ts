import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the "iniciar treino" flow after the Missed
 * Session decision moved from "shown automatically on Home mount" to "shown
 * only when the user actually tries to start a workout"
 * (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Sessão perdida). No RN
 * renderer is available in this Node-only unit suite (see
 * appShellNavigationStructure.test.ts for the same pattern) — these read
 * AppShell's source directly and pin the specific rules that, if silently
 * reverted, reintroduce either the auto-popup UX or the two-native-Modal
 * concurrency bug the audit found (MissedSessionDecisionModal +
 * StartWorkoutConfirmation both `visible` at once).
 */

const APP_SHELL = readFileSync('src/screens/AppShell.tsx', 'utf8');
const APP_SHELL_CODE = APP_SHELL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('AppShell start-workout flow — single state machine', () => {
  it('drives every step of the flow from the same startWorkoutFlow state, never independent booleans', () => {
    expect(APP_SHELL_CODE).toContain(
      "const [startWorkoutFlow, setStartWorkoutFlow] = useState<'idle' | 'missedDecision' | 'missedResolved' | 'confirmation'>('idle')",
    );
    // The old, independently-toggled flag must not come back.
    expect(APP_SHELL_CODE).not.toContain('showWorkoutConfirmation');
  });

  it('every overlay in the flow is structurally exclusive — one enum value can never satisfy two `visible` conditions', () => {
    expect(APP_SHELL_CODE).toContain("visible={startWorkoutFlow === 'confirmation' && !workoutInProgress}");
    // Both beats live in the SAME AjMoment, so visibility must cover the
    // resolved one too. Gating on the decision beat alone made the modal
    // vanish exactly when it should confirm what changed — found by operating
    // the Simulator on 2026-10-19: answering "Sim, refazer hoje" closed
    // everything and the Home fell back to the rotation pointer, offering the
    // NEXT session instead of the recovered one.
    expect(APP_SHELL_CODE).toContain("visible={startWorkoutFlow === 'missedDecision' || startWorkoutFlow === 'missedResolved'}");
    expect(APP_SHELL_CODE).not.toContain('<MissedSessionDecisionModal\n        visible={false}');
    // Exclusivity is what this test is really about: the two overlays are
    // driven by disjoint sets of the SAME enum, so no value satisfies both.
    const decisionBeats = ['missedDecision', 'missedResolved'];
    expect(decisionBeats).not.toContain('confirmation');
  });

  it('never hands over between two native Modals mid-flow', () => {
    // Presenting one Modal while another is still dismissing is dropped by
    // iOS — the second screen simply never appears. The confirmation beat is
    // therefore a `step` of the same AjMoment, not a sibling overlay.
    const missed = readFileSync('src/components/schedule/MissedSessionDecisionModal.tsx', 'utf8');
    expect((missed.match(/<AjMoment/g) ?? [])).toHaveLength(1);
    expect(missed).toContain("step={letter ? 'resolved' : 'decision'}");
    expect(APP_SHELL_CODE).not.toContain('MissedSessionResolvedMoment');
  });

  it('does not auto-show the missed-decision modal from the Schedule Engine resolution alone', () => {
    // The old bug: visible was derived straight from
    // `schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'`,
    // with no user intent involved.
    expect(APP_SHELL_CODE).not.toContain(
      "visible={tab !== 'workout' && schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'}",
    );
  });

  it('folds the whole start-workout flow into overlayOpen, so the TabBar/other overlays cannot open concurrently', () => {
    const overlayOpenIdx = APP_SHELL_CODE.indexOf('const overlayOpen =');
    const overlayOpenBlock = APP_SHELL_CODE.slice(overlayOpenIdx, overlayOpenIdx + 400);
    expect(overlayOpenBlock).toContain("startWorkoutFlow !== 'idle'");
  });

  it('keeps recovery precedence ahead of the missed-session diversion', () => {
    const start = APP_SHELL_CODE.indexOf('const requestStartWorkout = useCallback(() => {');
    const end = APP_SHELL_CODE.indexOf('}, [workoutInProgress', start);
    const fn = APP_SHELL_CODE.slice(start, end);
    // Docs §14: a pending/inconsistent recovery pointer outranks every other
    // start-workout decision, Missed Session included. The pilot gate changes
    // which accounts can reach the diversion at all, never this ordering.
    expect(fn.indexOf('if (recoveryModalOpen) return;'))
      .toBeLessThan(fn.indexOf('MISSED_SESSION_DECISION_REQUIRED'));
    expect(fn).toContain("setStartWorkoutFlow('confirmation')");
  });

  it('routes every real entry point into starting a workout through requestStartWorkout', () => {
    // The TREINO tab opens the hub; only the hub/Home CTA and deep-link
    // enter the canonical start state machine.
    const selectTabStart = APP_SHELL_CODE.indexOf('const selectTab = (nextTab: TabId) => {');
    const selectTabEnd = APP_SHELL_CODE.indexOf('};', selectTabStart);
    expect(APP_SHELL_CODE.slice(selectTabStart, selectTabEnd)).not.toContain('requestStartWorkout();');
    expect(APP_SHELL_CODE).toContain('onStart={requestStartWorkout}');
    const intentEffectStart = APP_SHELL_CODE.indexOf("if (pendingIntent.type === 'active-workout')");
    const intentEffectEnd = APP_SHELL_CODE.indexOf('}, [', intentEffectStart);
    const intentEffect = APP_SHELL_CODE.slice(intentEffectStart, intentEffectEnd);
    expect(intentEffect).toContain("startWorkoutFlow === 'idle'");
    expect(intentEffect).toContain('requestStartWorkout();');
  });

  it('never sets startWorkoutFlow to confirmation directly outside requestStartWorkout/startWorkout/handleMissDecision', () => {
    const setters = APP_SHELL_CODE.match(/setStartWorkoutFlow\('confirmation'\)/g) ?? [];
    // requestStartWorkout, and handleMissDecision's success path.
    expect(setters.length).toBe(2);
  });
});

describe('AppShell missed-decision resolution — concurrency and error handling', () => {
  it('guards against a second tap while a decision is already being resolved', () => {
    const start = APP_SHELL_CODE.indexOf('const handleMissDecision = async');
    const end = APP_SHELL_CODE.indexOf('};', start);
    const fn = APP_SHELL_CODE.slice(start, end);
    expect(fn).toContain('if (missDecisionTapInFlightRef.current || missedDecisionPending || schedule.loading) return;');
    expect(fn).toContain('missDecisionTapInFlightRef.current = true;');
    expect(fn).toContain('setMissedDecisionPending(decision)');
    expect(fn).toContain('setMissedDecisionPending(null)');
  });

  it('keeps the decision step open and flags an error on failure instead of silently discarding it', () => {
    const start = APP_SHELL_CODE.indexOf('const handleMissDecision = async');
    const end = APP_SHELL_CODE.indexOf('};', start);
    const fn = APP_SHELL_CODE.slice(start, end);
    expect(fn).toContain('const outcome = await schedule.resolveMiss(decision, expected);');
    expect(fn).toMatch(/outcome\.status === 'FAILED'[\s\S]*setMissedDecisionError\(true\)/);
    // The success path now hands over to the acknowledgement step, which is
    // what continues into the confirmation — the destination is unchanged,
    // only the beat in between is new.
    expect(fn).toMatch(/outcome\.resolution\.status === 'SESSION_READY'[\s\S]*setStartWorkoutFlow\('missedResolved'\)/);
  });

  it('never advances past the decision before resolveMiss has actually resolved', () => {
    // The success-path transition must be conditioned on the resolved
    // outcome, not fired unconditionally right after the await.
    const start = APP_SHELL_CODE.indexOf('const handleMissDecision = async');
    const awaitResolution = APP_SHELL_CODE.indexOf('await schedule.resolveMiss(decision, expected)', start);
    const nextStep = APP_SHELL_CODE.indexOf("setStartWorkoutFlow('missedResolved')", awaitResolution);
    const sessionReadyGuard = APP_SHELL_CODE.indexOf("outcome.resolution.status === 'SESSION_READY'", awaitResolution);
    expect(awaitResolution).toBeGreaterThan(-1);
    expect(sessionReadyGuard).toBeGreaterThan(awaitResolution);
    expect(nextStep).toBeGreaterThan(sessionReadyGuard);
    // There are exactly two producers of the acknowledgement beat — the
    // legacy outcome above and the pilot's notice — and EACH must be reached
    // only after its own decision durably resolved. Counting them is not the
    // invariant; guarding each one is.
    expect((APP_SHELL_CODE.match(/setStartWorkoutFlow\('missedResolved'\)/g) ?? [])).toHaveLength(2);
    const pilotBranch = APP_SHELL_CODE.indexOf('if (schedule.missedNotice) {', start);
    const pilotAwait = APP_SHELL_CODE.indexOf('await schedule.decideMissedNotice(decision)', pilotBranch);
    const pilotRefusalGuard = APP_SHELL_CODE.indexOf('sessionIndex === null', pilotAwait);
    const pilotNextStep = APP_SHELL_CODE.indexOf("setStartWorkoutFlow('missedResolved')", pilotAwait);
    expect(pilotAwait).toBeGreaterThan(pilotBranch);
    expect(pilotRefusalGuard).toBeGreaterThan(pilotAwait);
    expect(pilotNextStep).toBeGreaterThan(pilotRefusalGuard);
  });

  it('the confirmation beat reports a committed decision — it can never re-resolve one', () => {
    const missed = readFileSync('src/components/schedule/MissedSessionDecisionModal.tsx', 'utf8');
    // Its two actions are existing destinations, both decided by AppShell.
    const mountIdx = APP_SHELL_CODE.indexOf('<MissedSessionDecisionModal');
    const mount = APP_SHELL_CODE.slice(mountIdx, APP_SHELL_CODE.indexOf('/>', mountIdx));
    expect(mount).toContain("setStartWorkoutFlow('confirmation')");
    expect(mount).toContain('onCancel={cancelMissDecision}');
    // The beat's own options never call `onChoose` — nothing is re-decided.
    const resolvedOptions = missed.slice(
      missed.indexOf('const resolvedOptions'),
      missed.indexOf('return (', missed.indexOf('const resolvedOptions')),
    );
    expect(resolvedOptions).not.toContain('onChoose');
    expect(resolvedOptions).toContain('onStartResolved?.()');
    expect(resolvedOptions).toContain('onPress: onCancel,');
    // It reads the engine's own answer for "which session is today's".
    expect(APP_SHELL_CODE).toContain('sessionIndex: outcome.resolution.sessionIndex');
    expect(missed).toContain('String.fromCharCode(65 + resolved.sessionIndex)');
    // And it never shows the retryable decision error over a settled outcome.
    expect(missed).toContain("error={!letter && error ? t('schedule.missedDecision.error') : null}");
  });

  it('"Depois" drops only the captured outcome, never the resolution itself', () => {
    const start = APP_SHELL_CODE.indexOf('const cancelMissDecision = () => {');
    const fn = APP_SHELL_CODE.slice(start, APP_SHELL_CODE.indexOf('};', start));
    expect(fn).toContain('setMissedResolved(null)');
    expect(fn).toContain("setStartWorkoutFlow('idle')");
    expect(fn).not.toContain('resolveMiss');
  });

  it('still latches a full decision identity, which only a legacy account can reach', () => {
    // The latch/replace dance stays intact. For an enrolled account the
    // resolver never produces the status, so none of it runs; for everyone
    // else it is the published behaviour and must not regress.
    expect(APP_SHELL_CODE).toContain('setMissedDecisionContext(missedDecisionIdentity(schedule.resolution))');
    expect(APP_SHELL_CODE).toContain('!sameMissedDecision(expected, currentDecision)');
    expect(APP_SHELL_CODE).toContain('setMissedDecisionContext(currentDecision)');
  });

  it('keeps the only entry point into the decision modal', () => {
    // Removing this diversion (and nothing else) was enough to strand a real
    // pending miss with no way to resolve it, because no other call site sets
    // `startWorkoutFlow` to `missedDecision` from a resolution.
    const start = APP_SHELL_CODE.indexOf('const requestStartWorkout = useCallback(() => {');
    const fn = APP_SHELL_CODE.slice(start, APP_SHELL_CODE.indexOf('}, [workoutInProgress', start));
    expect(fn).toContain("if (schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {");
    expect(fn).toContain("setStartWorkoutFlow('missedDecision')");
    expect(fn).toContain("setStartWorkoutFlow('confirmation')");
  });

  it('disables choices during a concurrent schedule reload', () => {
    const missedModalStart = APP_SHELL_CODE.indexOf('<MissedSessionDecisionModal');
    const missedModalEnd = APP_SHELL_CODE.indexOf('/>', missedModalStart);
    expect(APP_SHELL_CODE.slice(missedModalStart, missedModalEnd)).toContain('refreshing={schedule.loading}');
  });

  it('has no explicit "not now" button — CONTINUE_SEQUENCE/FOLLOW_SCHEDULE are the only two domain decisions offered', () => {
    // There is no third button. Backdrop-tap dismissal (cancelMissDecision)
    // is the only way out besides resolving a decision, and it never
    // resolves/skips the pending miss — see the next test.
    const missedModalStart = APP_SHELL_CODE.indexOf('<MissedSessionDecisionModal');
    const missedModalEnd = APP_SHELL_CODE.indexOf('/>', missedModalStart);
    const missedModalProps = APP_SHELL_CODE.slice(missedModalStart, missedModalEnd);
    expect(missedModalProps).toContain('onCancel={cancelMissDecision}');
  });

  it('backdrop dismissal never resolves/skips the pending decision — it only returns to idle', () => {
    const start = APP_SHELL_CODE.indexOf('const cancelMissDecision = () => {');
    const end = APP_SHELL_CODE.indexOf('};', start);
    const fn = APP_SHELL_CODE.slice(start, end);
    expect(fn).toContain('if (missedDecisionPending) return;');
    expect(fn).toContain("setStartWorkoutFlow('idle')");
    expect(fn).not.toContain('resolveMiss');
    expect(fn).not.toContain('onChoose');
  });
});

describe('AppShell showEvolutionUnlock — no longer concurrent with the start-workout flow', () => {
  it('the AUTO_ACTIVATION_NOTICE effect relies on overlayOpen alone (which now includes the start-workout flow)', () => {
    const idx = APP_SHELL_CODE.indexOf("evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE'");
    const block = APP_SHELL_CODE.slice(idx, idx + 300);
    expect(block).toContain('!overlayOpen');
    expect(block).not.toContain('showWorkoutConfirmation');
  });
});
