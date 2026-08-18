import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AJMark } from '../../components/ui/AJMark';
import { Display } from '../../components/ui/Display';
import { colors, spacing } from '../../theme/tokens';
import { useReducedMotionPreference } from '../../lib/reducedMotion';

// Typewriter timing — tuned to read as a small brand detail, not a "look, an
// animation" moment. Interval scales down for longer strings (see
// `charIntervalFor`) so a long line never runs on forever.
const TYPE_INITIAL_DELAY_MS = 180;
const HEADING_TYPE_CONFIG = { charInterval: 55, maxTotalMs: 1200, minCharInterval: 18 };
// Heading cursor lingers after the line finishes, a small pause before the
// screen advances.
const HEADING_CURSOR_HOLD_MS = 400;
const HEADING_CURSOR_FADE_MS = 220;
const CURSOR_CHAR = '|';

// Advances a fixed delay after the greeting genuinely finishes typing, so
// it's tied to the real animation instead of an estimate of it.
const ADVANCE_DELAY_AFTER_TYPING_MS = 500;

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
 * its own `ADVANCE_DELAY_AFTER_TYPING_MS` after the greeting finishes typing,
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

  const greetingTyping = useTypewriter(greeting, reduceMotion, true, HEADING_TYPE_CONFIG);
  const greetingCursor = useTypewriterCursor(
    greetingTyping.started,
    greetingTyping.finished,
    reduceMotion,
    HEADING_CURSOR_HOLD_MS,
    HEADING_CURSOR_FADE_MS,
  );

  useEffect(() => {
    if (!greetingTyping.finished) return;
    const timer = setTimeout(() => {
      if (advancing.current) return;
      advancing.current = true;
      onContinue();
    }, ADVANCE_DELAY_AFTER_TYPING_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount when typing genuinely finishes, not on every onContinue identity change
  }, [greetingTyping.finished]);

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
      <View style={{ marginTop: -spacing[4], alignSelf: 'stretch' }}>
        {/* Ghost reserves the final layout (text + cursor width) so the
            revealed text never shifts once typing finishes. */}
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
    </View>
  );
}
