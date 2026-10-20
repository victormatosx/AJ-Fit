import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegBar } from '../ui/SegBar';
import { AqPrimaryButton, AqRise } from '../ui/AcquisitionControls';
import { AjSpeechSequence } from '../aj/AjSpeechSequence';
import { AJ_INTERSTITIAL, AJ_REACT_STAGE, AJ_TYPING_MS_PER_CHAR } from '../aj/ajMomentTiming';
import { useAjFunnelDirector } from './AjFunnelStage';
import { useTheme } from '../../theme';

/**
 * Shared chrome for the funnel's steps that ask nothing: AJ says a couple of
 * lines, something is shown, and a single CTA moves on.
 *
 * Two arrangements, because the design has two:
 *
 * - **`centered`** — AJ at a quarter of the screen's height with the lines
 *   beneath him and nothing else. Used by the step that genuinely has no
 *   media of its own.
 * - **`media`** — AJ small and high, the lines under him, and the step's own
 *   carousel or player filling the room down to the CTA. This is the
 *   arrangement for every interstitial that carries real content: the design
 *   sheets show it for the video steps, and the prompt is explicit that the
 *   existing carousels and copy stay (§4.6), so the ones built around a
 *   carousel use it too rather than losing their content to a centred mascot.
 *
 * AJ himself is not rendered here. He is the funnel's single persistent
 * mascot, placed by `AjFunnelStepPose`; this component only reserves the space
 * he occupies and keeps his mouth in sync with the lines.
 */
export function AjInterstitialLayout({
  variant = 'media',
  progress,
  lines,
  ctaLabel,
  onContinue,
  /** The step's own carousel/player. Only rendered in the `media` arrangement. */
  children,
  /** Anything the step keeps below its CTA, e.g. a privacy reassurance line. */
  footer,
}: {
  variant?: 'centered' | 'media';
  /** Omitted by the steps that deliberately show no progress bar. */
  progress?: { current: number; total: number };
  lines: string[];
  ctaLabel: string;
  onContinue: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const aj = useAjFunnelDirector();
  const [spoken, setSpoken] = useState(false);

  const lineStyle = {
    fontFamily: theme.fonts.ui,
    fontSize: 16,
    lineHeight: 23,
    color: theme.colors.textSpeechSoft,
    textAlign: 'center' as const,
    marginTop: 12,
  };
  const leadLineStyle = {
    fontFamily: theme.fonts.uiSemi,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.4,
    color: theme.colors.textPrimary,
    textAlign: 'center' as const,
  };

  const speech = (
    <AjSpeechSequence
      lines={lines}
      msPerChar={AJ_TYPING_MS_PER_CHAR.headline}
      reduceMotion={aj.reduceMotion}
      lineStyle={lineStyle}
      leadLineStyle={leadLineStyle}
      onLineStart={() => {
        aj.setTalking(true);
        aj.setMood('talk');
      }}
      onLineDone={() => aj.setTalking(false)}
      onDone={() => {
        aj.setTalking(false);
        aj.setMood('happy');
        setSpoken(true);
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {progress ? (
          <View style={{ paddingHorizontal: 22, paddingTop: 15 }}>
            <SegBar
              value={progress.total ? progress.current / progress.total : 0}
              segs={progress.total || 1}
            />
          </View>
        ) : null}

        {variant === 'centered' ? (
          <View style={{ flex: 1, paddingHorizontal: 30, paddingBottom: 34 }}>
            {/* The lines sit a fixed distance below the top of AJ's box, which
                is itself a fraction of the screen — so the pair stays composed
                on any device without measuring the mascot. */}
            <View
              style={{
                position: 'absolute',
                top: height * AJ_INTERSTITIAL.yFraction + AJ_REACT_STAGE.speechOffsetY,
                left: 30,
                right: 30,
              }}
            >
              {speech}
            </View>
            <View style={{ marginTop: 'auto' }}>
              {spoken ? (
                <AqRise reduceMotion={aj.reduceMotion}>
                  <AqPrimaryButton label={ctaLabel} onPress={onContinue} />
                  {footer}
                </AqRise>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, paddingHorizontal: 22, paddingBottom: 34 }}>
            {/* Room for AJ, who is drawn by the stage above this tree. */}
            <View style={{ height: AJ_INTERSTITIAL.videoOffsetY + AJ_INTERSTITIAL.videoSize - 15 }} />
            {speech}
            <View
              style={{
                flex: 1,
                marginTop: 22,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {children}
            </View>
            <View style={{ marginTop: 18 }}>
              {spoken ? (
                <AqRise reduceMotion={aj.reduceMotion}>
                  <AqPrimaryButton label={ctaLabel} onPress={onContinue} />
                  {footer}
                </AqRise>
              ) : null}
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
