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
  it('drives both overlays from the same startWorkoutFlow state, never two independent booleans', () => {
    expect(APP_SHELL_CODE).toContain(
      "const [startWorkoutFlow, setStartWorkoutFlow] = useState<'idle' | 'missedDecision' | 'confirmation'>('idle')",
    );
    // The old, independently-toggled flag must not come back.
    expect(APP_SHELL_CODE).not.toContain('showWorkoutConfirmation');
  });

  it('StartWorkoutConfirmation and MissedSessionDecisionModal are structurally exclusive — one enum value can never satisfy both `visible` conditions', () => {
    expect(APP_SHELL_CODE).toContain("visible={startWorkoutFlow === 'confirmation' && !workoutInProgress}");
    expect(APP_SHELL_CODE).toContain("visible={startWorkoutFlow === 'missedDecision'}");
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

  it('gates requestStartWorkout on the Schedule Engine resolution before opening the confirmation step', () => {
    const start = APP_SHELL_CODE.indexOf('const requestStartWorkout = useCallback(() => {');
    const end = APP_SHELL_CODE.indexOf('}, [workoutInProgress', start);
    const fn = APP_SHELL_CODE.slice(start, end);
    expect(fn).toContain("schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'");
    expect(fn).toContain("setStartWorkoutFlow('missedDecision')");
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
    expect(fn).toMatch(/outcome\.resolution\.status === 'SESSION_READY'[\s\S]*setStartWorkoutFlow\('confirmation'\)/);
  });

  it('never opens StartWorkoutConfirmation before resolveMiss has actually resolved', () => {
    // setStartWorkoutFlow('confirmation') on the success path must be
    // conditioned on `resolved`, not called unconditionally right after the
    // await.
    const start = APP_SHELL_CODE.indexOf('const handleMissDecision = async');
    const awaitResolution = APP_SHELL_CODE.indexOf('await schedule.resolveMiss(decision, expected)', start);
    const nextConfirmation = APP_SHELL_CODE.indexOf("setStartWorkoutFlow('confirmation')", awaitResolution);
    const sessionReadyGuard = APP_SHELL_CODE.indexOf("outcome.resolution.status === 'SESSION_READY'", awaitResolution);
    expect(awaitResolution).toBeGreaterThan(-1);
    expect(sessionReadyGuard).toBeGreaterThan(awaitResolution);
    expect(nextConfirmation).toBeGreaterThan(sessionReadyGuard);
  });

  it('latches a full decision identity and replaces a stale modal with a new canonical decision', () => {
    expect(APP_SHELL_CODE).toContain('setMissedDecisionContext(missedDecisionIdentity(schedule.resolution))');
    expect(APP_SHELL_CODE).toContain('!sameMissedDecision(expected, currentDecision)');
    expect(APP_SHELL_CODE).toContain('setMissedDecisionContext(currentDecision)');
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
