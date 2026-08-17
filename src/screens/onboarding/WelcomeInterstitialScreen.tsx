import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AJMark } from '../../components/ui/AJMark';
import { Display } from '../../components/ui/Display';
import { colors, fonts, spacing } from '../../theme/tokens';
import { useReducedMotionPreference } from '../../lib/reducedMotion';

// Typewriter timing — tuned to read as a small brand detail, not a "look, an
// animation" moment. Interval scales down for longer strings (see
// `charIntervalFor`) so a long line never runs on forever. Body is slower
// per character than the heading — it's a full sentence, not a short greeting,
// so it reads more comfortably at a more deliberate pace.
const TYPE_INITIAL_DELAY_MS = 180;
const HEADING_TYPE_CONFIG = { charInterval: 55, maxTotalMs: 1200, minCharInterval: 18 };
const BODY_TYPE_CONFIG = { charInterval: 38, maxTotalMs: 2200, minCharInterval: 24 };
// Heading cursor: near-instant handoff — it fades out right as the body
// cursor appears, reading as one caret moving down a line ("Enter").
const HEADING_CURSOR_HOLD_MS = 0;
const HEADING_CURSOR_FADE_MS = 120;
// Body cursor: lingers after the last line finishes, a small pause before
// the screen advances.
const BODY_CURSOR_HOLD_MS = 400;
const BODY_CURSOR_FADE_MS = 220;
const CURSOR_CHAR = '|';

// The screen used to auto-advance on a fixed 2000ms timer regardless of the
// typing animation. With two lines typing in sequence, that fixed window
// could elapse before the body line even started (bug: screen changed
// before the body text ever appeared). It now advances a fixed delay after
// the body genuinely finishes typing, so it's tied to the real animation
// instead of an estimate of it.
const ADVANCE_DELAY_AFTER_BODY_MS = 1000;

type TypeConfig = { charInterval: number; maxTotalMs: number; minCharInterval: number };

function charIntervalFor(length: number, config: TypeConfig): number {
  if (length <= 0) return config.charInterval;
  const budgeted = config.maxTotalMs / length;
  return Math.max(config.minCharInterval, Math.min(config.charInterval, budgeted));
}

function delayForChar(char: string, baseInterval: number): number {
  if (char === ' ') return baseInterval * 0.5;
  if (/[.,!?;:¡¿]/.test(char)) return baseInterval + 90;
  return baseInterval;
}

/**
 * Reveals `text` one grapheme at a time, starting only once `start` becomes
 * true (so the body line can wait for the heading to fully settle before it
 * begins). Runs once per `start` per mount — the funnel genuinely unmounts
 * this screen on navigation, so re-entering Welcome is a fresh mount and
 * replays naturally. A single chained timeout drives the reveal instead of
 * one timer per character, so there's at most one pending timer to clean up
 * on unmount/skip.
 */
function useTypewriter(text: string, reduceMotion: boolean, start: boolean, config: TypeConfig) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [count, setCount] = useState(reduceMotion ? chars.length : 0);
  const [started, setStarted] = useState(reduceMotion);
  const [finished, setFinished] = useState(reduceMotion);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      setCount(chars.length);
      setStarted(true);
      setFinished(true);
      return;
    }
    if (!start || startedRef.current) return;
    startedRef.current = true;
    setStarted(true);

    setCount(0);
    setFinished(false);
    const interval = charIntervalFor(chars.length, config);

    let index = 0;
    const step = () => {
      index += 1;
      setCount(index);
      if (index >= chars.length) {
        setFinished(true);
        return;
      }
      timeoutRef.current = setTimeout(step, delayForChar(chars[index], interval));
    };

    timeoutRef.current = setTimeout(step, TYPE_INITIAL_DELAY_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once per mount when `start` first flips true, not on every `text`/`reduceMotion` identity change
  }, [start, reduceMotion]);

  return { displayText: chars.slice(0, count).join(''), started, finished };
}

/**
 * Drives a typing cursor's visibility: hidden until its line has actually
 * `started` typing (so the bottom line shows no cursor while the top line
 * is still being revealed), then hold-then-fades once `finished` — a short
 * hold for the line mid-handoff (feels like "Enter" moved the cursor down),
 * a longer hold for the final line (a small pause before the screen
 * advances).
 */
function useTypewriterCursor(
  started: boolean,
  finished: boolean,
  reduceMotion: boolean,
  holdMs: number,
  fadeMs: number,
) {
  const [showCursor, setShowCursor] = useState(false);
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion || !started) return;
    cursorOpacity.setValue(1);
    setShowCursor(true);
  }, [started, reduceMotion, cursorOpacity]);

  useEffect(() => {
    if (reduceMotion || !finished) return;
    const holdTimer = setTimeout(() => {
      Animated.timing(cursorOpacity, {
        toValue: 0,
        duration: fadeMs,
        useNativeDriver: true,
      }).start(({ finished: animFinished }) => {
        if (animFinished) setShowCursor(false);
      });
    }, holdMs);
    return () => clearTimeout(holdTimer);
  }, [finished, reduceMotion, cursorOpacity, holdMs, fadeMs]);

  return { showCursor, cursorOpacity };
}

/**
 * Pure transition screen — no progress bar, no eyebrow, no CTA. Advances on
 * its own `ADVANCE_DELAY_AFTER_BODY_MS` after the body line finishes typing,
 * same pattern as SplashScreen (timer owns the `onDone` call, cleaned up on
 * unmount so a stale timer can't fire onto whatever screen the funnel
 * already moved to).
 */
export function WelcomeInterstitialScreen({
  name,
  onContinue,
}: {
  name: string | null;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const advancing = useRef(false);
  const reduceMotion = useReducedMotionPreference();

  const greeting = name ? t('welcome.greeting', { name }) : t('welcome.greetingNoName');
  const body = t('welcome.body');

  const greetingTyping = useTypewriter(greeting, reduceMotion, true, HEADING_TYPE_CONFIG);
  const greetingCursor = useTypewriterCursor(
    greetingTyping.started,
    greetingTyping.finished,
    reduceMotion,
    HEADING_CURSOR_HOLD_MS,
    HEADING_CURSOR_FADE_MS,
  );

  // Body starts right as the heading finishes typing, and its cursor only
  // appears once it starts — so there's never a cursor under an empty line
  // while the heading is still being typed, and the handoff reads as one
  // caret jumping from the end of line one to the start of line two.
  const bodyTyping = useTypewriter(body, reduceMotion, greetingTyping.finished, BODY_TYPE_CONFIG);
  const bodyCursor = useTypewriterCursor(
    bodyTyping.started,
    bodyTyping.finished,
    reduceMotion,
    BODY_CURSOR_HOLD_MS,
    BODY_CURSOR_FADE_MS,
  );

  useEffect(() => {
    if (!bodyTyping.finished) return;
    const timer = setTimeout(() => {
      if (advancing.current) return;
      advancing.current = true;
      onContinue();
    }, ADVANCE_DELAY_AFTER_BODY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount when the body genuinely finishes, not on every onContinue identity change
  }, [bodyTyping.finished]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing[6],
        paddingBottom: spacing[12],
      }}
    >
      <AJMark size={120} />
      <View style={{ marginTop: spacing[2], alignSelf: 'stretch' }}>
        {/* Ghost reserves the final layout (text + cursor width) so the
            revealed text never shifts the logo/body below it. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Display size={26} style={{ textAlign: 'center', opacity: 0 }}>
            {greeting}
            {CURSOR_CHAR}
          </Display>
        </View>
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
          accessible
          accessibilityLabel={greeting}
          importantForAccessibility="yes"
        >
          <View importantForAccessibility="no-hide-descendants">
            <Display size={26} style={{ textAlign: 'center' }}>
              {greetingTyping.displayText}
              {greetingCursor.showCursor && (
                <Animated.Text style={{ opacity: greetingCursor.cursorOpacity, color: colors.text }}>
                  {CURSOR_CHAR}
                </Animated.Text>
              )}
            </Display>
          </View>
        </View>
      </View>
      <View style={{ marginTop: spacing[2], alignSelf: 'center', width: '100%', maxWidth: 300 }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text
            style={{
              fontFamily: fonts.ui,
              fontSize: 14.5,
              lineHeight: 21,
              color: colors.mute,
              textAlign: 'center',
              opacity: 0,
            }}
          >
            {body}
            {CURSOR_CHAR}
          </Text>
        </View>
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
          accessible
          accessibilityLabel={body}
          importantForAccessibility="yes"
        >
          <View importantForAccessibility="no-hide-descendants">
            <Text
              style={{
                fontFamily: fonts.ui,
                fontSize: 14.5,
                lineHeight: 21,
                color: colors.mute,
                textAlign: 'center',
              }}
            >
              {bodyTyping.displayText}
              {bodyCursor.showCursor && (
                <Animated.Text style={{ opacity: bodyCursor.cursorOpacity, color: colors.mute }}>
                  {CURSOR_CHAR}
                </Animated.Text>
              )}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
