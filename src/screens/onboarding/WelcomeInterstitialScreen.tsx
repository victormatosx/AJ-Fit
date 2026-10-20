import React, { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AjSpeechText } from '../../components/aj/AjSpeechText';
import {
  AJ_INTERSTITIAL,
  AJ_REACT_STAGE,
  AJ_TYPING_MS_PER_CHAR,
} from '../../components/aj/ajMomentTiming';
import { useAjFunnelDirector } from '../../components/onboarding/AjFunnelStage';
import { useTheme } from '../../theme';

/**
 * Advances a fixed delay after the greeting genuinely finishes typing, so
 * it's tied to the real reveal instead of an estimate of it.
 */
const ADVANCE_DELAY_AFTER_TYPING_MS = 500;

/**
 * Pure transition screen — no progress bar, no eyebrow, no CTA. It still
 * advances on its own, exactly as before: a timer fires
 * `ADVANCE_DELAY_AFTER_TYPING_MS` after the greeting lands, cleaned up on
 * unmount so a stale timer can't fire onto whatever step the funnel already
 * moved to. The approved design draws a CTA here; adding one would turn a
 * screen that passes through by itself into one that demands a tap, which is
 * a behaviour change rather than a visual one. Recorded as a difference.
 *
 * Two things this screen used to own are gone, both because the funnel now
 * provides them:
 *
 * - Its own `AJMark`. The funnel's single persistent AJ is already on screen
 *   at this step (`AjFunnelStepPose`), and a second mark beside him would be
 *   a second mascot.
 * - Its own typewriter. `AjSpeechText` is the app's one typing effect; two
 *   implementations of the same reveal is exactly the duplication the
 *   assistant's motion contract exists to prevent.
 */
export function WelcomeInterstitialScreen({
  name,
  onContinue,
}: {
  name: string | null;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const aj = useAjFunnelDirector();
  const advancing = useRef(false);
  const [finished, setFinished] = useState(false);

  const greeting = name ? t('welcome.greeting', { name }) : t('welcome.greetingNoName');

  useEffect(() => {
    if (!finished) return () => undefined;
    const timer = setTimeout(() => {
      if (advancing.current) return;
      advancing.current = true;
      onContinue();
    }, ADVANCE_DELAY_AFTER_TYPING_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount when typing genuinely finishes, not on every onContinue identity change
  }, [finished]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AjSpeechText
        text={greeting}
        msPerChar={AJ_TYPING_MS_PER_CHAR.headline}
        reduceMotion={aj.reduceMotion}
        onStart={() => {
          aj.setTalking(true);
          aj.setMood('talk');
        }}
        onDone={() => {
          aj.setTalking(false);
          aj.setMood('happy');
          setFinished(true);
        }}
        style={{
          position: 'absolute',
          top: height * AJ_INTERSTITIAL.yFraction + AJ_REACT_STAGE.speechOffsetY,
          left: 30,
          right: 30,
          textAlign: 'center',
          fontFamily: theme.fonts.uiSemi,
          fontSize: 27,
          lineHeight: 33,
          letterSpacing: -0.4,
          color: theme.colors.textPrimary,
        }}
      />
    </View>
  );
}
