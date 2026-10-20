import { memo, useCallback, useEffect, useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { darkTheme } from '../../theme';
import { Icon } from '../ui/Icon';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { AjBot, type AjBotMood } from './AjBot';
import { AJ_MOMENT_STAGE_PHASE, ajMomentIsSpeaking, type AjMomentStage } from './ajMomentStages';
import {
  AJ_BOT_ENTER,
  AJ_BOT_ENTER_START,
  AJ_BOT_HOP,
  AJ_BOT_LOOK_NEUTRAL,
  AJ_BOT_NOD,
  AJ_BOT_REDUCED_FADE_MS,
  ajBotLookAt,
} from './ajBotMotion';
import { AJ_TYPING, useAjTypedText, type AjSpeechRole } from './useAjTypedText';
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
  AJ_MOMENT_TAB_BAR_HEIGHT,
} from './ajMomentTiming';

/**
 * Shared presentation for the AJ assistant's "moments": a full-screen
 * overlay where AJ arcs in, types what it has to say, and offers the real
 * decisions as answers to a question.
 *
 * This component is deliberately dumb. It owns the entrance/exit, the
 * typing, the selection animation and the accessibility wiring — and
 * nothing else. Every answer's meaning, every guard (`busy`, `loading`,
 * `disabled`), whether the overlay can be dismissed at all, and when it
 * opens are decided by the caller, which is always the surface that already
 * owned that logic before (`MissedSessionDecisionModal`,
 * `WorkoutSessionRecoveryModal`, Home's paused-cycle moment). Nothing here
 * reads app state, persists anything, or decides when to appear.
 *
 * Two timing details are load-bearing:
 * - `onPress` fires `AJ_ANSWER_COMMIT_DELAY_MS` after the tap, so the hop
 *   and the other answers' dismissal are actually seen. The caller's handler
 *   is otherwise untouched — same function, same arguments.
 * - `visible: false` does not unmount immediately; the exit arc plays first.
 *   That is visual only: the decision it was showing was already resolved by
 *   the caller before `visible` flipped.
 */

/**
 * How an option is drawn. `answer` is the default — a row in a list of
 * replies to a question, with a radio indicator. `cta`/`link` are for a
 * moment that STATES something rather than asking: a single solid call to
 * action and a quiet way out, with no indicator at all (nothing is being
 * chosen between, so nothing should look choosable).
 */
export type AjMomentOptionVariant = 'answer' | 'cta' | 'link';

export interface AjMomentOption {
  key: string;
  label: string;
  description?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Emphasis only. Never renders as "already picked" — see `AjAnswer`. */
  primary?: boolean;
  variant?: AjMomentOptionVariant;
  /**
   * This answer ENDS the moment — it is not followed by a spinner, an error
   * or another step. The overlay then plays its exit and **unmounts before**
   * `onPress` runs, instead of running it immediately and fading out on top
   * of whatever comes next.
   *
   * That ordering is load-bearing, not cosmetic: an answer that hands over
   * to another native `Modal` (a `StartWorkoutConfirmation`, say) would
   * otherwise present it while this one is still mounted and mid-exit, and
   * iOS silently drops a presentation that overlaps a dismissal — the next
   * screen simply never appears.
   *
   * Leave it off for anything whose result the moment has to keep showing
   * (every answer with `loading`, and every step change).
   */
  closesMoment?: boolean;
}

export interface AjMomentProps {
  visible: boolean;
  /** Spoken lines: context first, the question last. The last line is always styled and paced as the question. */
  lines: string[];
  options: AjMomentOption[];
  error?: string | null;
  /** False => no close button, and backdrop taps / Android Back are inert. */
  dismissible: boolean;
  onDismiss?: () => void;
  mood?: AjBotMood;
  /** True while the caller has an operation in flight — new taps are ignored. */
  busy?: boolean;
  /**
   * Identity of the content currently being spoken. When it changes while
   * the overlay stays open (e.g. the recovery flow's discard confirmation),
   * AJ nods and retypes instead of the lines mutating mid-sentence.
   */
  step?: string;
  closeAccessibilityLabel?: string;
  /**
   * The last line is a STATEMENT, not a question: it keeps the context
   * styling and pacing instead of being enlarged and slowed down as the
   * thing being asked. Use for a moment that reports an outcome.
   */
  statement?: boolean;
}

export function AjMoment({
  visible,
  lines,
  options,
  error = null,
  dismissible,
  onDismiss,
  mood = 'idle',
  busy = false,
  step = 'default',
  closeAccessibilityLabel,
  statement = false,
}: AjMomentProps) {
  const theme = darkTheme;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();

  // `visible: false` starts the exit; the Modal stays mounted until it ends.
  const [rendered, setRendered] = useState(visible);
  /**
   * One state machine for the whole opening, rather than loose timers:
   *
   *   armed -> entering -> settling -> speaking -> (nodding | picked) -> leaving
   *
   * `armed` is the pre-roll: the Modal is mounted but the native window may
   * not be on screen yet, so AJ holds frame 0 of the arc (off screen,
   * transparent) and nothing is typed. The clock only starts on the Modal's
   * `onShow`. `settling` is the arrival hop. Exactly one transition is ever
   * scheduled at a time, on `stageTimerRef`.
   */
  const [stage, setStage] = useState<AjMomentStage>('armed');
  const backdrop = useRef(new Animated.Value(0)).current;

  // How many lines have finished typing. Changes once per LINE, never per
  // character — the per-character state lives inside `AjSpeechLine`.
  const [typedLines, setTypedLines] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  /** Measured once the content is laid out: guarantees `enter` is born below the bottom edge even on a very tall window. */
  const [enterStartTranslateY, setEnterStartTranslateY] = useState<number>(AJ_BOT_ENTER_START.translateY);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Exit-then-hand-over for a `closesMoment` answer — see that flag. */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffFrameRef = useRef<number | null>(null);
  const questionRef = useRef<Text>(null);
  const botRef = useRef<View>(null);
  const announcedStepRef = useRef<string | null>(null);
  /** Bumped on every open — lets the step effect tell "new content" from "reopened". */
  const openCountRef = useRef(0);
  /** Guards against `onShow` and the rAF fallback both starting the sequence. */
  const startedRef = useRef(false);

  const clearStageTimer = () => {
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    stageTimerRef.current = null;
  };

  /** Schedules the single next transition, replacing any pending one. */
  const advanceTo = (next: AjMomentStage, afterMs: number) => {
    clearStageTimer();
    if (afterMs <= 0) {
      setStage(next);
      return;
    }
    stageTimerRef.current = setTimeout(() => {
      stageTimerRef.current = null;
      setStage(next);
    }, afterMs);
  };

  useEffect(() => () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (handoffFrameRef.current !== null) cancelAnimationFrame(handoffFrameRef.current);
  }, []);

  useEffect(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (visible) {
      openCountRef.current += 1;
      startedRef.current = false;
      clearStageTimer();
      setRendered(true);
      // Back to the pre-roll pose on EVERY open — the arc is replayed from
      // frame 0, never resumed from wherever the last close left it.
      setStage('armed');
      setTypedLines(0);
      setSelectedKey(null);
      setFocusedIndex(null);
      announcedStepRef.current = null;
      backdrop.setValue(0);
      return () => undefined;
    }
    clearStageTimer();
    setStage('leaving');
    Animated.timing(backdrop, {
      toValue: 0,
      duration: reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_MS,
      // Outlasts AJ's own exit arc, so the wash is still there to leave
      // through rather than disappearing from under him.
      delay: reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setRendered(false);
    }, reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS + AJ_BACKDROP_FADE_OUT_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, [visible, reduceMotion, backdrop]);

  /**
   * t = 0 for the whole sequence — called from the Modal's `onShow` (and a
   * one-frame fallback, for safety on platforms where it may not fire). This
   * is the fix for the entrance looking like it never played: starting the
   * arc on the React commit instead burned its first few hundred ms behind a
   * window that was not on screen yet, and since the curve front-loads the
   * motion, the only part ever visible was the final settle.
   */
  const startSequence = () => {
    if (startedRef.current || !visible) return;
    startedRef.current = true;
    Animated.timing(backdrop, {
      toValue: 1,
      duration: reduceMotion ? 0 : AJ_BACKDROP_FADE_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    setStage('entering');
  };

  /**
   * Safety net for `onShow`: if it has not fired by the frame after the
   * overlay is on screen, start anyway rather than leaving AJ parked off
   * screen forever. One frame of extra pre-roll is imperceptible; a moment
   * that never animates in is not.
   */
  useEffect(() => {
    if (!rendered || !visible || startedRef.current) return () => undefined;
    const frame = requestAnimationFrame(() => requestAnimationFrame(startSequence));
    return () => cancelAnimationFrame(frame);
    // `startSequence` closes over refs and the current `visible`/`reduceMotion`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, visible, reduceMotion]);

  // Stage durations. Everything downstream of `entering` is derived here, so
  // there is exactly one place that knows how long each beat lasts.
  useEffect(() => {
    if (!rendered) return () => undefined;
    if (stage === 'entering') {
      // Reduce Motion: the arc is a 250ms fade, and there is no arrival hop.
      advanceTo(reduceMotion ? 'speaking' : 'settling', reduceMotion ? AJ_BOT_REDUCED_FADE_MS : AJ_BOT_ENTER.durationMs);
      return clearStageTimer;
    }
    if (stage === 'settling') {
      advanceTo('speaking', AJ_BOT_HOP.durationMs);
      return clearStageTimer;
    }
    if (stage === 'nodding') {
      advanceTo('speaking', reduceMotion ? 0 : AJ_BOT_NOD.durationMs);
      return clearStageTimer;
    }
    if (stage === 'picked') {
      advanceTo('speaking', reduceMotion ? 0 : AJ_BOT_HOP.durationMs);
      return clearStageTimer;
    }
    return () => undefined;
    // `advanceTo` is a stable local closure over refs/setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, rendered, reduceMotion]);

  // New content in an already-open moment (the recovery flow's discard
  // confirmation and back): nod and retype from the top — never a second
  // entrance arc. A step that changed across a close/reopen is NOT a nod
  // either; the entrance owns that frame, which is what `openCountRef`
  // distinguishes.
  const stepRef = useRef({ step, open: 0 });
  useEffect(() => {
    const previous = stepRef.current;
    stepRef.current = { step, open: openCountRef.current };
    if (!visible || previous.step === step || previous.open !== openCountRef.current) return;
    setTypedLines(0);
    setSelectedKey(null);
    setFocusedIndex(null);
    announcedStepRef.current = null;
    setStage('nodding');
  }, [step, visible]);

  // A failed attempt must stay retryable: bring every answer back and undo
  // the "an answer was chosen" look.
  useEffect(() => {
    if (error) setSelectedKey(null);
  }, [error]);

  const allLinesTyped = typedLines >= lines.length;
  // Landed, so AJ is allowed to speak — gated on the stage, never a delay.
  const speaking = ajMomentIsSpeaking(stage);
  const typing = speaking && !allLinesTyped;

  // Screen readers land on the question once it is fully written, so they
  // never read a half-typed sentence. Announced once per step.
  useEffect(() => {
    if (!rendered || !speaking || !allLinesTyped || announcedStepRef.current === step) return;
    announcedStepRef.current = step;
    const node = findNodeHandle(questionRef.current);
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [rendered, speaking, allLinesTyped, step]);

  const handleLineDone = useCallback((index: number) => {
    setTypedLines((current) => (current === index ? index + 1 : current));
  }, []);

  const choose = (option: AjMomentOption) => {
    if (busy || option.disabled || selectedKey !== null) return;
    setSelectedKey(option.key);
    setFocusedIndex(null);
    setStage('picked');
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      if (!option.closesMoment) {
        option.onPress();
        return;
      }
      // Leave first, hand over second — see `closesMoment`.
      setStage('leaving');
      Animated.timing(backdrop, {
        toValue: 0,
        duration: reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_MS,
        delay: reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        setRendered(false);
        // Two frames after the unmount commits, so the native dismiss is
        // done before anything else tries to present.
        handoffFrameRef.current = requestAnimationFrame(() => {
          handoffFrameRef.current = requestAnimationFrame(() => {
            handoffFrameRef.current = null;
            option.onPress();
          });
        });
      }, reduceMotion ? 0 : AJ_BACKDROP_FADE_OUT_DELAY_MS + AJ_BACKDROP_FADE_OUT_MS);
    }, reduceMotion ? 0 : AJ_ANSWER_COMMIT_DELAY_MS);
  };

  const requestDismiss = () => {
    if (!dismissible || busy || !onDismiss) return;
    onDismiss();
  };

  const phase = AJ_MOMENT_STAGE_PHASE[stage];
  const effectiveMood: AjBotMood = selectedKey !== null
    ? 'happy'
    : typing
      ? 'talk'
      : mood;

  const look = focusedIndex !== null ? ajBotLookAt(focusedIndex, options.length) : AJ_BOT_LOOK_NEUTRAL;

  /** Still mounted only so the exit arc can play; the caller already moved on. */
  const exiting = rendered && !visible;

  if (!rendered) return null;

  return (
    <Modal
      visible
      transparent
      // The fade is driven here (500ms in / 600ms out) so the mascot's arc
      // and the backdrop are one continuous motion; the native fade is both
      // shorter and not configurable.
      animationType="none"
      // t = 0 for the arc and the backdrop fade. Never the render: see
      // `startSequence`.
      onShow={startSequence}
      onRequestClose={dismissible && !busy ? requestDismiss : () => undefined}
      statusBarTranslucent
    >
      {/*
        While exiting, the overlay is a fading image and nothing more: the
        decision it was showing has already been resolved by the caller, so
        a stray tap must not reach anything inside it.
      */}
      <Animated.View
        pointerEvents={exiting ? 'none' : 'auto'}
        accessibilityElementsHidden={exiting}
        importantForAccessibility={exiting ? 'no-hide-descendants' : 'auto'}
        style={[StyleSheet.absoluteFill, { opacity: backdrop }]}
      >
        <Pressable
          accessibilityRole={dismissible ? 'button' : 'none'}
          accessibilityLabel={dismissible ? closeAccessibilityLabel : undefined}
          onPress={dismissible ? requestDismiss : undefined}
          // Inert for a non-dismissible moment, exactly as the poster modal
          // it replaces was.
          disabled={!dismissible || busy}
          style={StyleSheet.absoluteFill}
        >
          <AjMomentBackdrop />
        </Pressable>

        <View
          accessibilityViewIsModal
          pointerEvents="box-none"
          style={{
            flex: 1,
            // AJ flies in from the corner and comes to rest in the MIDDLE of
            // the screen, with what he says reading downward from there.
            // The paddings are asymmetric on purpose: they bias the centring
            // upward just enough to keep the last answer clear of the tab bar
            // on short screens, without a magic total (the bar's own height
            // plus the inset it reserves).
            justifyContent: 'center',
            paddingHorizontal: 22,
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + AJ_MOMENT_TAB_BAR_HEIGHT + 16,
          }}
        >
          {/*
            Deliberately NOT clipped (`overflow` untouched) and sized to the
            mascot only: the arc travels hundreds of px outside this box, so
            any ancestor hiding overflow would crop the entrance away.
          */}
          <View
            ref={botRef}
            style={{ alignItems: 'center' }}
            onLayout={() => {
              // `enter` must be born off screen. 420px (the prototype's
              // value) clears the bottom edge on every phone, but not
              // necessarily on a tall/landscape window — so measure once and
              // lengthen the drop if needed. Never shortens it.
              botRef.current?.measureInWindow((_x, y, _width, height) => {
                const needed = Math.round(windowHeight - y + height * 0.5);
                setEnterStartTranslateY((current) => Math.max(current, needed));
              });
            }}
          >
            <AjBot
              size={AJ_BOT_SIZE}
              mood={effectiveMood}
              phase={phase}
              look={look}
              talking={typing}
              enterStartTranslateY={enterStartTranslateY}
              reduceMotion={reduceMotion}
            />
          </View>

          <View
            accessibilityLiveRegion="polite"
            style={{ marginTop: 22, gap: 10 }}
          >
            {lines.map((line, index) => {
              const isLast = index === lines.length - 1;
              const role: AjSpeechRole = !isLast ? 'context' : statement ? 'statement' : 'question';
              return (
                <AjSpeechLine
                  key={`${step}:${index}`}
                  // Screen-reader focus still lands on the last line, whether
                  // it is a question or a statement.
                  ref={isLast ? questionRef : undefined}
                  text={line}
                  role={role}
                  // The first line waits for the stage, not for a delay —
                  // `speaking` only becomes true once AJ has landed.
                  enabled={speaking && typedLines >= index}
                  startDelayMs={index === 0 ? 0 : AJ_TYPING.lineGapMs}
                  reduceMotion={reduceMotion}
                  index={index}
                  onDone={handleLineDone}
                />
              );
            })}
          </View>

          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                marginTop: 18,
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.colors.warning,
                backgroundColor: theme.colors.surfaceMuted,
              }}
            >
              <Text
                style={{
                  color: theme.colors.warning,
                  fontFamily: theme.fonts.uiSemi,
                  fontSize: 12.5,
                  lineHeight: 17,
                  textAlign: 'center',
                }}
              >
                {error}
              </Text>
            </View>
          ) : null}

          {speaking && allLinesTyped ? (
            <View style={{ marginTop: 22, gap: 8 }}>
              {options.map((option, index) => (
                <AjAnswer
                  key={option.key}
                  option={option}
                  index={index}
                  reduceMotion={reduceMotion}
                  selected={selectedKey === option.key}
                  // Everything the user did NOT pick steps aside while the
                  // real action runs.
                  dismissed={selectedKey !== null && selectedKey !== option.key}
                  busy={busy}
                  onFocusChange={setFocusedIndex}
                  onChoose={choose}
                />
              ))}
            </View>
          ) : null}
        </View>

        {dismissible ? (
          <AjCloseButton
            top={insets.top + 12}
            label={closeAccessibilityLabel}
            disabled={busy}
            reduceMotion={reduceMotion}
            onPress={requestDismiss}
          />
        ) : null}
      </Animated.View>
    </Modal>
  );
}

/**
 * Wash behind the moment: a blue glow low on the screen, falling away to
 * near-black, plus a dedicated top-down darkening pass.
 *
 * The blue is a glow around AJ, not a coloured screen, but it is allowed to
 * carry further and read a bit richer than a bare hint: the centre sits on a
 * fuller navy, the mid stop keeps more of that tint before handing off, and
 * the radius reaches further out, so the glow is wider as well as bluer.
 * The falloff still reaches near-black by the outer edge, and the linear
 * pass on top keeps the upper third closer to black so the content below it
 * carries the contrast.
 *
 * `expo-blur` only genuinely blurs on iOS (Android needs an experimental
 * method and is not worth the jank at these alphas), so the blur is a
 * refinement rather than the effect itself.
 */
const AjMomentBackdrop = memo(function AjMomentBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={14} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="ajMomentBackdrop" cx="50%" cy="66%" rx="88%" ry="88%">
            <Stop offset="0" stopColor="#123a7a" stopOpacity={0.95} />
            <Stop offset="0.5" stopColor="#0a2252" stopOpacity={0.95} />
            <Stop offset="1" stopColor="#01010a" stopOpacity={0.97} />
          </RadialGradient>
          {/* Keeps the top of the screen closer to black than the glow alone would. */}
          <LinearGradient id="ajMomentTopShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000006" stopOpacity={0.62} />
            <Stop offset="0.42" stopColor="#000006" stopOpacity={0.16} />
            <Stop offset="0.7" stopColor="#000006" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ajMomentBackdrop)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ajMomentTopShade)" />
      </Svg>
    </View>
  );
});

/**
 * One spoken line. Owns its own character counter so a per-character update
 * re-renders this leaf alone — never the mascot or the answers. The full
 * string is always in the tree; only the tail's opacity changes, so the
 * block's height is fixed from the first frame.
 */
const AjSpeechLine = memo(function AjSpeechLine({
  ref,
  text,
  role,
  enabled,
  startDelayMs,
  reduceMotion,
  index,
  onDone,
}: {
  ref?: Ref<Text>;
  text: string;
  role: AjSpeechRole;
  enabled: boolean;
  startDelayMs: number;
  reduceMotion: boolean;
  index: number;
  onDone: (index: number) => void;
}) {
  const handleDone = useCallback(() => onDone(index), [onDone, index]);
  const { revealed } = useAjTypedText({ text, role, enabled, startDelayMs, reduceMotion, onDone: handleDone });
  const theme = darkTheme;
  const isQuestion = role === 'question';
  const style = isQuestion
    ? {
        fontFamily: theme.fonts.uiSemi,
        fontSize: 22,
        lineHeight: 29,
        letterSpacing: -0.2,
        color: theme.colors.textPrimary,
      }
    : role === 'statement'
      // A statement carries the moment on its own, so it sits between the
      // supporting-context size and the question's.
      ? {
          fontFamily: theme.fonts.ui,
          fontSize: 17,
          lineHeight: 25,
          color: 'rgba(255,255,255,0.8)',
        }
      : {
          fontFamily: theme.fonts.ui,
          fontSize: 15.5,
          lineHeight: 22,
          color: 'rgba(255,255,255,0.72)',
        };

  return (
    <Text
      ref={ref}
      // The whole line is the accessible value from the first frame; the
      // reveal is purely visual.
      accessible
      accessibilityLabel={text}
      style={[style, { textAlign: 'center' }]}
    >
      <Text style={style}>{text.slice(0, revealed)}</Text>
      <Text style={[style, { opacity: 0 }]}>{text.slice(revealed)}</Text>
    </Text>
  );
});

function AjAnswer({
  option,
  index,
  reduceMotion,
  selected,
  dismissed,
  busy,
  onFocusChange,
  onChoose,
}: {
  option: AjMomentOption;
  index: number;
  reduceMotion: boolean;
  selected: boolean;
  dismissed: boolean;
  busy: boolean;
  onFocusChange: (index: number | null) => void;
  onChoose: (option: AjMomentOption) => void;
}) {
  const theme = darkTheme;
  // One value drives both the staggered entrance and the later dismissal:
  // 0 = offset/transparent, 1 = in place.
  const presence = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      presence.setValue(dismissed ? 0 : 1);
      return;
    }
    Animated.timing(presence, {
      toValue: dismissed ? 0 : 1,
      duration: dismissed ? AJ_ANSWER_DISMISS_MS : AJ_ANSWER_RISE_MS,
      delay: dismissed ? 0 : index * AJ_ANSWER_RISE_STAGGER_MS,
      easing: dismissed ? Easing.in(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [dismissed, index, reduceMotion, presence]);

  /**
   * The filled radio + check mean ONE thing: "you picked this". A `primary`
   * answer must never wear it — a question whose recommended answer already
   * looks ticked reads as "something is selected for me", which is exactly
   * the opposite of asking. Emphasis for `primary` is carried by the border
   * and a faint wash instead, never by the indicator.
   */
  const emphasised = option.primary && !selected;
  const disabled = Boolean(option.disabled) || busy;
  const variant = option.variant ?? 'answer';

  if (variant !== 'answer') {
    return (
      <Animated.View
        pointerEvents={dismissed ? 'none' : 'auto'}
        style={{
          opacity: presence,
          transform: [{ translateY: presence.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: Boolean(option.loading) }}
          accessibilityLabel={option.label}
          accessibilityHint={option.description}
          disabled={disabled}
          onPress={() => onChoose(option)}
          style={variant === 'cta'
            ? {
                minHeight: 44,
                paddingVertical: 18,
                paddingHorizontal: 24,
                borderRadius: 18,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                backgroundColor: theme.colors.primary,
                // Same lift the Home "iniciar treino" CTA carries.
                shadowColor: theme.colors.primary,
                shadowOpacity: 0.45,
                shadowRadius: 22,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
                opacity: disabled ? 0.6 : 1,
              }
            : { minHeight: 44, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' }}
        >
          {variant === 'cta' && (option.loading
            ? <ActivityIndicator color={theme.colors.primaryForeground} />
            : <Icon name="play" size={14} color={theme.colors.primaryForeground} />)}
          <Text
            numberOfLines={1}
            style={variant === 'cta'
              ? { flexShrink: 1, fontFamily: theme.fonts.uiBold, fontSize: 16, color: theme.colors.primaryForeground }
              : { fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textMuted }}
          >
            {option.label}
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents={dismissed ? 'none' : 'auto'}
      style={{
        opacity: presence,
        transform: [{ translateY: presence.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: Boolean(option.loading) }}
        accessibilityLabel={option.label}
        accessibilityHint={option.description}
        disabled={disabled}
        onPressIn={() => onFocusChange(index)}
        onPressOut={() => onFocusChange(null)}
        onPress={() => onChoose(option)}
        style={{
          minHeight: 44,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: selected
            ? 'rgba(11,112,249,0.18)'
            : emphasised ? 'rgba(11,112,249,0.08)' : 'rgba(255,255,255,0.04)',
          borderColor: selected
            ? theme.colors.primary
            : emphasised ? 'rgba(11,112,249,0.45)' : 'rgba(255,255,255,0.08)',
          opacity: option.disabled ? 0.5 : 1,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>
            {option.label}
          </Text>
          {option.description ? (
            <Text
              style={{
                fontFamily: theme.fonts.ui,
                fontSize: 12.5,
                lineHeight: 17,
                color: 'rgba(255,255,255,0.5)',
                marginTop: 3,
              }}
            >
              {option.description}
            </Text>
          ) : null}
        </View>
        {option.loading ? (
          <ActivityIndicator color={theme.colors.primaryForeground} />
        ) : (
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: selected ? 0 : 1.5,
              borderColor: 'rgba(255,255,255,0.22)',
              backgroundColor: selected ? theme.colors.primary : 'transparent',
            }}
          >
            {selected ? <Icon name="check" size={11} color={theme.colors.primaryForeground} stroke={2.6} /> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Appears a beat after the moment opens, so it never competes with AJ's entrance. */
function AjCloseButton({
  top,
  label,
  disabled,
  reduceMotion,
  onPress,
}: {
  top: number;
  label?: string;
  disabled: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const theme = darkTheme;
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, {
      toValue: 1,
      duration: 240,
      delay: AJ_CLOSE_BUTTON_DELAY_MS,
      useNativeDriver: true,
    }).start();
  }, [appear, reduceMotion]);

  return (
    <Animated.View style={{ position: 'absolute', top, right: 18, opacity: appear }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={10}
        onPress={onPress}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="x" size={14} color={theme.colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}
