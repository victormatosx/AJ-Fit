import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AJ_TYPING, ajTypingLineDurationMs, ajTypingMsPerChar } from '../useAjTypedText';
import {
  AJ_BOT_ENTER,
  AJ_BOT_ENTER_START,
  AJ_BOT_ENTER_TRACKS,
  AJ_BOT_EXIT,
  AJ_BOT_REDUCED_FADE_MS,
  ajBotEnterTracks,
} from '../ajBotMotion';
import { AJ_MOMENT_STAGE_PHASE, ajMomentIsSpeaking } from '../ajMomentStages';
import {
  AJ_ANSWER_COMMIT_DELAY_MS,
  AJ_ANSWER_DISMISS_MS,
  AJ_ANSWER_RISE_MS,
  AJ_ANSWER_RISE_STAGGER_MS,
  AJ_BACKDROP_FADE_IN_MS,
  AJ_BACKDROP_FADE_OUT_DELAY_MS,
  AJ_BACKDROP_FADE_OUT_MS,
  AJ_BOT_SIZE,
  AJ_CLOSE_BUTTON_DELAY_MS,
  AJ_CYCLE_PAUSED_DELAY_MS,
} from '../ajMomentTiming';

/**
 * No React Native renderer exists in this suite (see
 * `WorkoutSessionRecoveryModal.test.ts`), so the overlay's behavioural
 * guarantees are pinned textually plus through the pure timing helpers.
 *
 * What matters here is that `AjMoment` stays a presentation shell: it must
 * never decide what an answer means, when it opens, or whether it may be
 * dismissed — and it must never lose a timer, a guard, or an accessibility
 * affordance that the poster modals it replaced already had.
 */
const ajMoment = readFileSync(new URL('../AjMoment.tsx', import.meta.url), 'utf8');
const ajBot = readFileSync(new URL('../AjBot.tsx', import.meta.url), 'utf8');
const typed = readFileSync(new URL('../useAjTypedText.ts', import.meta.url), 'utf8');
const paused = readFileSync(new URL('../AjCyclePausedMoment.tsx', import.meta.url), 'utf8');
const missed = readFileSync(new URL('../../schedule/MissedSessionDecisionModal.tsx', import.meta.url), 'utf8');
/**
 * Comment-stripped views (same convention as
 * `missedWorkoutDecisionFlow.test.ts`). Assertions about what a file must
 * NOT contain have to read the CODE: these files' doc comments deliberately
 * name the prototype paths and data sources that were left out.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const pausedCode = stripComments(paused);
const missedCode = stripComments(missed);
const homeScreen = readFileSync(new URL('../../../screens/HomeScreen.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../../../screens/AppShell.tsx', import.meta.url), 'utf8');

describe('AjMoment — presentation only', () => {
  it('owns no app state: no domain import, no persistence, no navigation', () => {
    expect(ajMoment).not.toMatch(/scheduleEngine|workoutExecution|services\/|AsyncStorage|firestore|firebase/i);
    expect(ajMoment).not.toMatch(/useAuth|setTab|navigation/);
  });

  it('renders no literal user-facing copy — every string arrives as a prop', () => {
    expect(ajMoment).toContain('lines: string[]');
    expect(ajMoment).toContain('options: AjMomentOption[]');
    // The only strings in the file are style/identifier values, never text
    // rendered inside a <Text>.
    expect(ajMoment).not.toMatch(/<Text[^>]*>\s*[A-Za-zÀ-ÿ]{4,}/);
  });

  it('defers the real action until the hop and the answer dismissal have played', () => {
    expect(AJ_ANSWER_COMMIT_DELAY_MS).toBe(520);
    // Long enough for both to finish, so the tap never looks ignored.
    expect(AJ_ANSWER_COMMIT_DELAY_MS).toBeGreaterThanOrEqual(AJ_ANSWER_DISMISS_MS);
    expect(ajMoment).toContain('}, reduceMotion ? 0 : AJ_ANSWER_COMMIT_DELAY_MS);');
    // ...and calls the caller's handler untouched, with no arguments of its own.
    expect(ajMoment).toContain('option.onPress();');
  });

  it('keeps the prototype\'s overlay measurements', () => {
    expect(AJ_BACKDROP_FADE_IN_MS).toBe(500);
    expect(AJ_BACKDROP_FADE_OUT_MS).toBe(600);
    expect(AJ_ANSWER_RISE_MS).toBe(400);
    expect(AJ_ANSWER_RISE_STAGGER_MS).toBe(80);
    expect(AJ_ANSWER_DISMISS_MS).toBe(300);
    expect(AJ_CLOSE_BUTTON_DELAY_MS).toBe(800);
    expect(AJ_BOT_SIZE).toBe(104);
  });

  it('ignores a second tap while an operation is in flight or an answer is already chosen', () => {
    const chooseBody = ajMoment.slice(
      ajMoment.indexOf('const choose = (option: AjMomentOption) => {'),
      ajMoment.indexOf('const requestDismiss', ajMoment.indexOf('const choose = (option: AjMomentOption) => {')),
    );
    expect(chooseBody).toContain('if (busy || option.disabled || selectedKey !== null) return;');
  });

  it('keeps a failed attempt retryable by restoring every answer', () => {
    expect(ajMoment).toContain('if (error) setSelectedKey(null);');
  });

  it('gates dismissal entirely on the caller\'s `dismissible` flag', () => {
    expect(ajMoment).toContain('if (!dismissible || busy || !onDismiss) return;');
    expect(ajMoment).toContain('onRequestClose={dismissible && !busy ? requestDismiss : () => undefined}');
    expect(ajMoment).toContain('disabled={!dismissible || busy}');
    expect(ajMoment).toContain('{dismissible ? (');
  });

  it('clears every timer it owns on unmount — nothing outlives the overlay', () => {
    expect(ajMoment).toContain('useEffect(() => () => {');
    expect(ajMoment).toContain('if (commitTimerRef.current) clearTimeout(commitTimerRef.current);');
    expect(ajMoment).toContain('if (exitTimerRef.current) clearTimeout(exitTimerRef.current);');
    expect(ajMoment).toContain('if (stageTimerRef.current) clearTimeout(stageTimerRef.current);');
    expect(typed).toContain('clearTimeout(start);');
    expect(typed).toContain('if (interval) clearInterval(interval);');
    expect(paused).toContain('if (timerRef.current) clearTimeout(timerRef.current);');
  });

  it('schedules exactly one stage transition at a time, never a pile of loose timers', () => {
    expect(ajMoment).toContain('const advanceTo = (next: AjMomentStage, afterMs: number) => {');
    const advanceBody = ajMoment.slice(
      ajMoment.indexOf('const advanceTo = (next: AjMomentStage, afterMs: number) => {'),
      ajMoment.indexOf('useEffect', ajMoment.indexOf('const advanceTo =')),
    );
    // Replacing the pending transition is what keeps the machine single-track.
    expect(advanceBody).toContain('clearStageTimer();');
    expect(advanceBody).toContain('stageTimerRef.current = setTimeout(');
  });

  it('meets the accessibility floor the poster modals set', () => {
    expect(ajMoment).toContain('accessibilityViewIsModal');
    expect(ajMoment).toContain('accessibilityLiveRegion="polite"');
    expect(ajMoment).toContain("accessibilityRole=\"button\"");
    expect(ajMoment).toContain('accessibilityState={{ disabled, busy: Boolean(option.loading) }}');
    expect(ajMoment).toContain('accessibilityRole="alert"');
    expect(ajMoment).toContain('minHeight: 44');
    expect(ajMoment).toContain('AccessibilityInfo.setAccessibilityFocus(node)');
    // The mascot is decoration; the words next to it are the content.
    expect(ajBot).toContain('importantForAccessibility="no"');
  });

  it('honours OS Reduce Motion everywhere motion exists', () => {
    expect(ajMoment).toContain('const reduceMotion = useReducedMotionPreference();');
    expect(ajMoment).toMatch(/reduceMotion \? 0 : AJ_BACKDROP_FADE_IN_MS/);
    expect(ajMoment).toMatch(/reduceMotion \? 0 : AJ_BACKDROP_FADE_OUT_MS/);
    expect(ajMoment).toContain('reduceMotion={reduceMotion}');
    expect(ajBot).toContain('const floating = phase === \'idle\' && !reduceMotion && floatEnabled;');
    expect(ajBot).toContain('const mouthMoving = talking && !reduceMotion;');
  });

  it('keeps the text block\'s height fixed while typing — the untyped tail is rendered transparent', () => {
    expect(ajMoment).toContain('{text.slice(0, revealed)}');
    expect(ajMoment).toContain('{ opacity: 0 }]}>{text.slice(revealed)}');
    // The reveal must not change what a screen reader is given.
    expect(ajMoment).toContain('accessibilityLabel={text}');
  });

  it('confines per-character re-renders to a single memoized line', () => {
    expect(ajMoment).toContain('const AjSpeechLine = memo(');
    expect(typed).toContain('const [revealed, setRevealed] = useState(0);');
    // The overlay itself only ever counts whole LINES.
    expect(ajMoment).toContain('const [typedLines, setTypedLines] = useState(0);');
  });

  it('rests AJ in the middle of the screen, still clear of the tab bar', () => {
    expect(ajMoment).toContain("justifyContent: 'center',");
    expect(ajMoment).not.toContain("justifyContent: 'flex-end',");
    // Centring is biased upward by the tab-bar clearance rather than by a
    // magic total, so a tall moment still cannot reach under the bar.
    expect(ajMoment).toContain('paddingBottom: insets.bottom + AJ_MOMENT_TAB_BAR_HEIGHT + 16');
    expect(ajMoment).toContain('paddingTop: insets.top + 56,');
  });

  it('never renders an answer as already picked', () => {
    // The filled radio + check mean "you picked this" and nothing else. A
    // `primary` answer wearing it made the question look pre-answered.
    expect(ajMoment).toContain('const emphasised = option.primary && !selected;');
    expect(ajMoment).toContain('borderWidth: selected ? 0 : 1.5,');
    expect(ajMoment).toContain('backgroundColor: selected ? theme.colors.primary : \'transparent\',');
    expect(ajMoment).toContain("{selected ? <Icon name=\"check\"");
    // The old conflation must not come back.
    expect(ajMoment).not.toContain('option.primary || selected');
    expect(ajMoment).not.toMatch(/highlighted \?/);
  });

  it('keeps the backdrop a quiet glow, with the top darker than the rest', () => {
    // Two passes: a restrained radial wash, then a top-down darkening.
    expect(ajMoment).toContain('id="ajMomentBackdrop"');
    expect(ajMoment).toContain('id="ajMomentTopShade"');
    expect(ajMoment).toContain('fill="url(#ajMomentTopShade)"');
    // The old, much stronger navy centre must not come back.
    expect(ajMoment).not.toContain('#081e5f');
    const shade = ajMoment.slice(ajMoment.indexOf('id="ajMomentTopShade"'), ajMoment.indexOf('</LinearGradient>'));
    // Opaque at the top, gone before the middle.
    expect(shade).toMatch(/offset="0"[^/]*stopOpacity=\{0\.62\}/);
    expect(shade).toMatch(/offset="0\.7"[^/]*stopOpacity=\{0\}/);
  });

  it('supports a moment that states an outcome instead of asking something', () => {
    // No question styling/pacing on the last line, and actions with no
    // indicator — nothing is being chosen between.
    expect(ajMoment).toContain("const role: AjSpeechRole = !isLast ? 'context' : statement ? 'statement' : 'question';");
    // A statement is paced like a question (it carries the moment) but
    // styled between the two.
    expect(ajTypingMsPerChar('statement')).toBe(AJ_TYPING.questionMsPerChar);
    expect(ajMoment).toContain("role === 'statement'");
    expect(ajMoment).toContain("export type AjMomentOptionVariant = 'answer' | 'cta' | 'link';");
    expect(ajMoment).toContain("if (variant !== 'answer') {");
    // Screen-reader focus still lands on the last line either way.
    expect(ajMoment).toContain('ref={isLast ? questionRef : undefined}');
  });
});

describe('Missed session resolved — the second beat of the same conversation', () => {
  it('states what changed and offers the session the engine says is today\'s', () => {
    expect(missed).toContain("t('schedule.missedDecision.aj.resolvedContinueSequence', { letter })");
    expect(missed).toContain("t('schedule.missedDecision.aj.resolvedFollowSchedule', { letter })");
    expect(missed).toContain("t('schedule.missedDecision.aj.startSession', { letter })");
    expect(missed).toContain("t('schedule.missedDecision.aj.later')");
    // The two decisions read differently and are never conflated.
    expect(missed).toContain("resolved?.decision === 'FOLLOW_SCHEDULE'");
  });

  it('renders as a statement with a CTA and a quiet way out, not as a question', () => {
    expect(missed).toContain('statement={letter !== null}');
    expect(missed).toContain("variant: 'cta',");
    expect(missed).toContain("variant: 'link',");
    expect(missed).toContain("mood={letter ? 'happy' : 'idle'}");
  });

  it('never switches beats without a real session to name', () => {
    expect(missed).toContain("const letter = resolved ? String.fromCharCode(65 + resolved.sessionIndex) : null;");
    expect(missed).toContain("step={letter ? 'resolved' : 'decision'}");
    expect(missed).toContain('options={letter ? resolvedOptions : decisionOptions}');
  });

  it('stays one overlay, so AJ nods across the beats instead of a Modal handover', () => {
    expect((missed.match(/<AjMoment/g) ?? [])).toHaveLength(1);
    // AjMoment's step change is a nod + retype, never a second entrance.
    expect(ajMoment).toContain("setStage('nodding');");
  });
});

describe('AJ entrance sequence', () => {
  it('maps every stage to exactly one mascot animation', () => {
    expect(AJ_MOMENT_STAGE_PHASE).toEqual({
      armed: 'armed',
      entering: 'enter',
      settling: 'hop',
      speaking: 'idle',
      nodding: 'nod',
      picked: 'hop',
      leaving: 'exit',
    });
  });

  it('starts the clock on the Modal being shown, never on the React commit', () => {
    // The regression this fixes: the arc was fired from an effect at commit
    // time, so its first few hundred ms played behind a native window that
    // was not on screen yet — and `enter`'s bezier front-loads the motion,
    // so the only visible part was the settle. Hence `armed` + `onShow`.
    expect(ajMoment).toContain('onShow={startSequence}');
    expect(ajMoment).toContain('if (startedRef.current || !visible) return;');
    expect(ajMoment).toContain("setStage('entering');");
    const startBody = ajMoment.slice(
      ajMoment.indexOf('const startSequence = () => {'),
      ajMoment.indexOf("setStage('entering');") + 24,
    );
    expect(startBody).toContain('toValue: 1');
    expect(startBody).toContain('AJ_BACKDROP_FADE_IN_MS');
  });

  it('has a frame-level fallback so a missing onShow cannot leave AJ parked off screen', () => {
    expect(ajMoment).toContain('requestAnimationFrame(() => requestAnimationFrame(startSequence))');
    expect(ajMoment).toContain('cancelAnimationFrame(frame)');
    expect(ajMoment).toContain('startedRef.current = true;');
  });

  it('replays the arc from frame 0 on every open, and only on an open', () => {
    const openBody = ajMoment.slice(
      ajMoment.indexOf('if (visible) {'),
      ajMoment.indexOf('clearStageTimer();', ajMoment.indexOf('if (visible) {') + 200),
    );
    expect(openBody).toContain('startedRef.current = false;');
    expect(openBody).toContain("setStage('armed');");
    expect(openBody).toContain('backdrop.setValue(0);');
    // A step change inside the same opening nods instead of re-entering —
    // this is what carries the missed-session flow from asking to confirming.
    const stepBody = ajMoment.slice(
      ajMoment.indexOf('const stepRef = useRef({ step, open: 0 });'),
      ajMoment.indexOf('}, [step, visible]);'),
    );
    expect(stepBody).toContain("setStage('nodding');");
    expect(stepBody).not.toContain("setStage('entering')");
    expect(stepBody).not.toContain("setStage('armed')");
    expect(stepBody).toContain('previous.open !== openCountRef.current');
  });

  it('lands, hops once, then settles into the float', () => {
    expect(ajMoment).toContain("if (stage === 'entering') {");
    expect(ajMoment).toContain("advanceTo(reduceMotion ? 'speaking' : 'settling'");
    expect(ajMoment).toContain("if (stage === 'settling') {");
    expect(ajMoment).toContain("advanceTo('speaking', AJ_BOT_HOP.durationMs);");
    expect(ajBot).toContain("const floating = phase === 'idle' && !reduceMotion && floatEnabled;");
  });

  it('holds AJ off screen and silent until the sequence starts', () => {
    expect(ajBot).toContain("if (phaseKey === 'armed') {");
    expect(ajBot).toContain('phaseProgress.value = 0;');
    expect(ajBot).toContain("useSharedValue(phase === 'enter' || phase === 'armed' ? 0 : 1)");
    expect(ajMomentIsSpeaking('armed')).toBe(false);
    expect(ajMomentIsSpeaking('entering')).toBe(false);
    expect(ajMomentIsSpeaking('leaving')).toBe(false);
    for (const stage of ['settling', 'speaking', 'nodding', 'picked'] as const) {
      expect(ajMomentIsSpeaking(stage)).toBe(true);
    }
    expect(ajMoment).toContain('const speaking = ajMomentIsSpeaking(stage);');
    expect(ajMoment).toContain('enabled={speaking && typedLines >= index}');
    expect(ajMoment).toContain('{speaking && allLinesTyped ? (');
    expect(ajMoment).toContain('talking={typing}');
    expect(ajBot).toContain("const blinking = !reduceMotion && phase !== 'armed' && phase !== 'enter';");
  });

  it('lets the wash outlast AJ on the way out', () => {
    expect(AJ_BACKDROP_FADE_OUT_DELAY_MS).toBe(100);
    expect(AJ_BACKDROP_FADE_OUT_DELAY_MS + AJ_BACKDROP_FADE_OUT_MS).toBeGreaterThan(AJ_BOT_EXIT.durationMs);
    expect(ajMoment).toContain('delay: reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS,');
    expect(ajMoment).toContain('reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS + AJ_BACKDROP_FADE_OUT_MS');
  });

  it('under Reduce Motion the arc becomes a 250ms fade with no hop', () => {
    expect(AJ_BOT_REDUCED_FADE_MS).toBe(250);
    expect(ajMoment).toContain("advanceTo(reduceMotion ? 'speaking' : 'settling', reduceMotion ? AJ_BOT_REDUCED_FADE_MS : AJ_BOT_ENTER.durationMs)");
    expect(ajBot).toContain("else if (phaseKey === 'enter') fade.value = withTiming(1, { duration: AJ_BOT_REDUCED_FADE_MS });");
    expect(ajBot).toContain('opacity: base.opacity * fade.value,');
  });

  it('never clips the arc: the mascot travels far outside its own box', () => {
    expect(ajMoment).not.toMatch(/overflow:\s*'hidden'/);
    expect(AJ_BOT_ENTER.keyframes[0].translateY).toBeGreaterThan(AJ_BOT_SIZE * 2);
  });

  it('lengthens the drop when 420px would not clear the bottom edge, and never shortens it', () => {
    expect(ajBotEnterTracks(AJ_BOT_ENTER_START.translateY)).toBe(AJ_BOT_ENTER_TRACKS);
    expect(ajBotEnterTracks(10)).toBe(AJ_BOT_ENTER_TRACKS);
    const tall = ajBotEnterTracks(900);
    expect(tall.translateY.output[0]).toBe(900);
    expect(Math.max(...tall.translateY.output)).toBe(900);
    expect(Math.min(...tall.translateY.output))
      .toBeCloseTo(Math.min(...AJ_BOT_ENTER_TRACKS.translateY.output));
    expect(tall.translateY.output[tall.translateY.output.length - 1]).toBe(0);
    expect(tall.translateX.output).toEqual(AJ_BOT_ENTER_TRACKS.translateX.output);
    expect(tall.translateY.input).toEqual(AJ_BOT_ENTER_TRACKS.translateY.input);
  });
});

describe('AJ typing cadence', () => {
  it('matches the prototype: 20ms/char context, 26ms/char question, 260ms between lines', () => {
    expect(ajTypingMsPerChar('context')).toBe(20);
    expect(ajTypingMsPerChar('question')).toBe(26);
    expect(AJ_TYPING.lineGapMs).toBe(260);
  });

  it('holds the first line until the entrance arc has landed', () => {
    expect(AJ_TYPING.openDelayMs).toBe(AJ_BOT_ENTER.durationMs);
  });

  it('accounts for the leading delay in a line\'s total duration', () => {
    expect(ajTypingLineDurationMs('abcde', 'context', 0)).toBe(100);
    expect(ajTypingLineDurationMs('abcde', 'question', AJ_TYPING.lineGapMs)).toBe(260 + 130);
  });

  it('reveals everything at once under Reduce Motion, creating no timer at all', () => {
    expect(typed).toContain('if (reduceMotion || text.length === 0) {');
    expect(typed).toContain('setRevealed(text.length);');
  });

  it('never restarts a line because the caller passed a fresh callback', () => {
    expect(typed).toContain('const onDoneRef = useRef(onDone);');
    expect(typed).toContain('onDoneRef.current?.();');
  });
});

describe('Missed session — AJ answers map to the real decisions', () => {
  it('"sim" continues the sequence (does the missed session) and "não" follows the schedule', () => {
    expect(missed).toContain("key: 'CONTINUE_SEQUENCE',");
    expect(missed).toContain("label: t('schedule.missedDecision.aj.continueSequence'),");
    expect(missed).toContain("onPress: () => onChoose('CONTINUE_SEQUENCE'),");
    expect(missed).toContain("key: 'FOLLOW_SCHEDULE',");
    expect(missed).toContain("label: t('schedule.missedDecision.aj.followSchedule'),");
    expect(missed).toContain("onPress: () => onChoose('FOLLOW_SCHEDULE'),");
  });

  it('keeps each decision\'s existing consequence copy as the answer\'s description', () => {
    expect(missed).toContain("description: t('schedule.missedDecision.continueSequence.subtitle'),");
    expect(missed).toContain("description: t('schedule.missedDecision.followSchedule.subtitle'),");
  });

  it('offers exactly two answers per beat — there is still no third "not now" button', () => {
    const decisionBeat = missedCode.slice(
      missedCode.indexOf('const decisionOptions'),
      missedCode.indexOf('const resolvedOptions'),
    );
    expect(decisionBeat.match(/key: '/g)).toHaveLength(2);
    expect(decisionBeat).toContain("key: 'CONTINUE_SEQUENCE',");
    expect(decisionBeat).toContain("key: 'FOLLOW_SCHEDULE',");
    const resolvedBeat = missedCode.slice(
      missedCode.indexOf('const resolvedOptions'),
      missedCode.indexOf('return ('),
    );
    expect(resolvedBeat.match(/key: '/g)).toHaveLength(2);
  });

  it('preserves every guard: per-decision spinner, both disabled while busy, retryable error, dismiss only when idle', () => {
    expect(missed).toContain('const busy = pending !== null || refreshing;');
    expect(missed).toContain("loading: pending === 'CONTINUE_SEQUENCE',");
    expect(missed).toContain("loading: pending === 'FOLLOW_SCHEDULE',");
    expect(missed.match(/disabled: busy,/g)).toHaveLength(2);
    // The retryable decision error never shows over a settled outcome.
    expect(missed).toContain("error={!letter && error ? t('schedule.missedDecision.error') : null}");
    expect(missed).toContain('onDismiss={onCancel}');
    expect(missed).toContain('busy={busy}');
  });

  it('never recomputes or re-reads the schedule — it only reports what it was handed', () => {
    expect(missedCode).not.toMatch(/useEffect|useState|resolveMiss|missedSessionIndex|prescription/);
  });
});

describe('Paused cycle — Home moment', () => {
  it('reuses the single real start-workout entry point instead of a new path', () => {
    expect(paused).toContain('onStartWorkout: () => void;');
    expect(paused).toContain('onStartWorkout();');
    expect(homeScreen).toContain('onStartWorkout={onStart}');
    expect(appShell).toContain('onStart={requestStartWorkout}');
  });

  it('opens 1.4s after Home settles, once per app session, with nothing persisted', () => {
    expect(AJ_CYCLE_PAUSED_DELAY_MS).toBe(1400);
    expect(paused).toContain('}, AJ_CYCLE_PAUSED_DELAY_MS);');
    expect(paused).toContain('const shownRef = useRef(false);');
    expect(paused).toContain('shownRef.current = true;');
    expect(pausedCode).not.toMatch(/AsyncStorage|SecureStore|firestore|setDoc|persist/i);
  });

  it('reads the pause fact the Home ring already renders, never a new miss count', () => {
    expect(homeScreen).toContain('evolutionViewModel.summary.pausedAtLocalDate !== null');
    // The moment itself is handed a boolean: it cannot see the view model,
    // the progression snapshot, or any miss count, so it cannot recompute one.
    expect(pausedCode).not.toMatch(/pausedAtLocalDate|viewModel|summary|activeTime|progression/i);
    expect(pausedCode).toContain('eligible: boolean;');
    // The copy stays generic precisely because the summary has no count.
    expect(pausedCode).toContain("t('schedule.cyclePaused.aj.context')");
    expect(pausedCode).not.toMatch(/count:|\{\{count\}\}/);
  });

  it('never opens where "treinar hoje" would do nothing', () => {
    expect(homeScreen).toContain('eligible={cyclePaused && canStartNow}');
    const canStart = homeScreen.slice(homeScreen.indexOf('const canStartNow ='), homeScreen.indexOf(';', homeScreen.indexOf('const canStartNow =')));
    expect(canStart).toContain('todayActionsReady');
    expect(canStart).toContain('!workoutInProgress');
    // isBlockedToday is REST_DAY / ACTIVE_RECOVERY_DAY / TODAY_COMPLETED.
    expect(canStart).toContain('!isBlockedToday');
    expect(canStart).toContain("prescription.status === 'SUCCESS'");
  });

  it('is gated by AppShell on Home being focused with no other surface open', () => {
    const gate = appShell.slice(
      appShell.indexOf('const ajMomentsAllowed ='),
      appShell.indexOf(';', appShell.indexOf('const ajMomentsAllowed =')),
    );
    expect(gate).toContain("tab === 'home'");
    expect(gate).toContain('homeInitialVisualReady');
    // `overlayOpen` already covers the start-workout flow (missed decision +
    // confirmation) and session recovery, so neither can coexist with this.
    expect(gate).toContain('!overlayOpen');
    expect(gate).toContain('!workoutInProgress');
    expect(gate).toContain('!showEvolutionUnlock');
    expect(appShell).toContain('ajMomentsAllowed={ajMomentsAllowed}');
    const overlayOpen = appShell.slice(appShell.indexOf('const overlayOpen ='), appShell.indexOf('useEffect', appShell.indexOf('const overlayOpen =')));
    expect(overlayOpen).toContain("startWorkoutFlow !== 'idle'");
    expect(overlayOpen).toContain('recoveryModalOpen');
  });

  it('does not implement the prototype\'s cycle-freeze path, which the app cannot do', () => {
    expect(pausedCode).not.toMatch(/week|semana|freezeCycle|pauseCycle/);
    expect(pausedCode.match(/key: '/g)).toHaveLength(2);
    expect(pausedCode).toContain("key: 'later',");
  });
});

describe('Handing over to another native Modal', () => {
  it('unmounts before running an answer that ends the moment', () => {
    // iOS drops a presentation that overlaps a dismissal, so an answer which
    // opens another Modal must not fire while this overlay is still mounted
    // and mid-exit. Order: hop -> exit -> unmount -> onPress.
    const chooseBody = ajMoment.slice(
      ajMoment.indexOf('const choose = (option: AjMomentOption) => {'),
      ajMoment.indexOf('const requestDismiss', ajMoment.indexOf('const choose = (option: AjMomentOption) => {')),
    );
    expect(chooseBody).toContain('if (!option.closesMoment) {');
    expect(chooseBody).toContain("setStage('leaving');");
    const unmount = chooseBody.indexOf('setRendered(false);');
    const handover = chooseBody.indexOf('option.onPress();', unmount);
    expect(unmount).toBeGreaterThan(-1);
    expect(handover).toBeGreaterThan(unmount);
    // ...and the hand-over waits two frames past the unmount commit.
    expect(chooseBody).toContain('requestAnimationFrame(() => {');
  });

  it('cleans up the hand-over timer and frame on unmount', () => {
    expect(ajMoment).toContain('if (closeTimerRef.current) clearTimeout(closeTimerRef.current);');
    expect(ajMoment).toContain('if (handoffFrameRef.current !== null) cancelAnimationFrame(handoffFrameRef.current);');
  });

  it('marks exactly the answers that open another Modal, and no answer that must stay to show a result', () => {
    // Opens StartWorkoutConfirmation.
    const startOption = missedCode.slice(missedCode.indexOf("key: 'start',"), missedCode.indexOf("key: 'later',"));
    expect(startOption).toContain('closesMoment: true,');
    // Routes into requestStartWorkout, which opens a Modal either way.
    const pausedStart = pausedCode.slice(pausedCode.indexOf("key: 'start',"), pausedCode.indexOf("key: 'later',"));
    expect(pausedStart).toContain('closesMoment: true,');
    // The two decisions must NOT close: they show a spinner and may fail.
    const decisionBeat = missedCode.slice(
      missedCode.indexOf('const decisionOptions'),
      missedCode.indexOf('const resolvedOptions'),
    );
    expect(decisionBeat).not.toContain('closesMoment');
    // Neither may any recovery action — each one shows loading or an error.
    const recovery = readFileSync(new URL('../../workout/WorkoutSessionRecoveryModal.tsx', import.meta.url), 'utf8');
    expect(recovery).not.toContain('closesMoment');
  });
});
