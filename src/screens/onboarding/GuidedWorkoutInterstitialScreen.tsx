import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoView } from 'expo-video';
import { Image } from 'expo-image';
import { Display, Slash } from '../../components/ui/Display';
import { CtaButton, CtaText } from '../../components/ui/CtaButton';
import { SegBar } from '../../components/ui/SegBar';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { OutlineNumber } from '../../components/ui/OutlineNumber';
import { colors, fonts, motion, palette, sizes, spacing } from '../../theme/tokens';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { getGuidedWorkoutVideoPlayer } from '../../onboarding/onboardingVideoPreload';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

const GUIDED_WORKOUT_VIDEO_POSTER = require('../../../assets/onboarding/guided-workout-video-poster.jpg');

// Matches assets/videos/guided-workout.mp4's native 464x832 frame, so
// `contentFit="cover"` never has to crop — the phone screen's aspect ratio
// is derived from the footage itself.
const VIDEO_ASPECT_RATIO = 464 / 832;

const PHONE_BEZEL = 7;
const PHONE_SCREEN_RADIUS = 26;
const PHONE_FRAME_RADIUS = PHONE_SCREEN_RADIUS + PHONE_BEZEL;

/**
 * Product-demo interstitial: the phone mockup showing `guided-workout.mp4`
 * on loop *is* the pitch, replacing the old static "sets/reps/load/rest"
 * card mock. Same preload+poster+first-frame architecture as
 * `MethodologyInterstitialScreen` (see `onboardingVideoPreload.ts`), just
 * confined to the phone screen's bounds instead of covering the whole view.
 */
// Absolute safety bounds so the phone can't collapse on a tiny device or
// balloon absurdly on a tablet — everything in between is driven by the
// actual measured space (see `stageSize` below), not these constants.
const MIN_PHONE_HEIGHT = 210;
const MAX_PHONE_HEIGHT = 460;
// Never claim the full measured stage height — leaves a deliberate gap so
// the frame can't touch (or, with the bezel added on top, overrun into) the
// headline above or the supporting text below.
const HEIGHT_FILL_RATIO = 0.86;
// Width shrinks proportionally more than height — a slim silhouette rather
// than a phone that's merely a scaled-down copy of the old one. This is
// normally the binding constraint (not MAX_PHONE_HEIGHT above).
const MAX_PHONE_WIDTH_RATIO = 0.58;

export function GuidedWorkoutInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const reduceMotion = useReducedMotionPreference();
  const player = getGuidedWorkoutVideoPlayer();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const posterOpacity = useRef(new Animated.Value(1)).current;
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);

  // The phone is sized to exactly fill the flexible space left over once
  // the header (eyebrow + headline) and footer (supporting text + CTA) have
  // laid out — measured via `onLayout` rather than guessed from font-metric
  // constants, so it's correct across dynamic type sizes and devices
  // without needing a second, brittle set of height calculations to keep in
  // sync with the actual JSX. A window-driven guess seeds the first paint
  // so there's no visible pop once the real measurement lands.
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: windowWidth - sizes.screenGutter * 2,
    height: windowHeight * 0.4,
  });

  // Subtract the bezel before fitting: `screenHeight` here is the *inner*
  // video area, but the rendered frame is `screenHeight + PHONE_BEZEL * 2`
  // tall — without this the frame could exceed the stage's own measured
  // bounds and overlap the supporting text below it.
  const availableHeight = Math.max(0, stageSize.height - PHONE_BEZEL * 2) * HEIGHT_FILL_RATIO;
  let screenHeight = Math.max(MIN_PHONE_HEIGHT, Math.min(availableHeight, MAX_PHONE_HEIGHT));
  let screenWidth = screenHeight * VIDEO_ASPECT_RATIO;
  const maxWidth = stageSize.width * MAX_PHONE_WIDTH_RATIO;
  if (screenWidth > maxWidth) {
    screenWidth = maxWidth;
    screenHeight = screenWidth / VIDEO_ASPECT_RATIO;
  }

  // The player is a singleton that outlives this screen's mount (see
  // onboardingVideoPreload), so pausing on cleanup is safe — unlike a
  // `useVideoPlayer()`-owned player, nothing releases it out from under us.
  useEffect(() => {
    if (reduceMotion) {
      player.pause();
      return;
    }
    player.play();
    return () => {
      player.pause();
    };
  }, [player, reduceMotion]);

  // Reduce Motion: keep the static poster as the permanent visual instead
  // of ever confirming/fading to a moving frame.
  useEffect(() => {
    if (reduceMotion || !firstFrameRendered) return;
    Animated.timing(posterOpacity, {
      toValue: 0,
      duration: motion.duration.fast,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [firstFrameRendered, reduceMotion, posterOpacity]);

  return (
    <ScreenBg>
      <OutlineNumber
        size={260}
        style={{ position: 'absolute', top: -40, right: -50, opacity: 0.35 }}
      >
        AJ
      </OutlineNumber>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[3] }}>
          <SegBar value={progress.total ? progress.current / progress.total : 0} segs={progress.total || 1} />
        </View>

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingTop: spacing[6] }}>
          <Slash>{t('interstitials.guidedWorkout.eyebrow')}</Slash>
          <View style={{ marginTop: spacing[3] }}>
            <Display size={30}>{t('interstitials.guidedWorkout.titleLine1')}</Display>
            <Display size={30} color={colors.accentHi}>
              {t('interstitials.guidedWorkout.titleLine2')}
            </Display>
          </View>
        </View>

        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: spacing[3],
            paddingHorizontal: sizes.screenGutter,
          }}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setStageSize({ width, height });
          }}
        >
          <View
            style={[
              styles.phoneFrame,
              {
                width: screenWidth + PHONE_BEZEL * 2,
                height: screenHeight + PHONE_BEZEL * 2,
                borderRadius: PHONE_FRAME_RADIUS,
              },
            ]}
          >
            <View
              style={[
                styles.phoneScreen,
                { width: screenWidth, height: screenHeight, borderRadius: PHONE_SCREEN_RADIUS },
              ]}
            >
              <VideoView
                style={StyleSheet.absoluteFill}
                player={player}
                contentFit="cover"
                nativeControls={false}
                allowsPictureInPicture={false}
                pointerEvents="none"
                onFirstFrameRender={() => setFirstFrameRendered(true)}
              />

              {/* Same size/position/contentFit/radius as the video, so the
                  poster-to-video handoff reads as the image starting to
                  move rather than a photo swap. */}
              <Animated.View style={[StyleSheet.absoluteFill, { opacity: posterOpacity }]} pointerEvents="none">
                <Image
                  source={GUIDED_WORKOUT_VIDEO_POSTER}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              </Animated.View>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[2] }}>
          <Text style={styles.body}>{t('interstitials.guidedWorkout.body')}</Text>

          <CtaButton onPress={onContinue} style={{ marginTop: spacing[3], marginBottom: spacing[2] }}>
            <CtaText>{t('interstitials.guidedWorkout.cta')}</CtaText>
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

const styles = StyleSheet.create({
  phoneFrame: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    // A plain drop shadow, not a glow — just enough to lift the frame off
    // the background (#5). No colored blob behind it.
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  phoneScreen: {
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  body: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mute,
    textAlign: 'center',
    maxWidth: 260,
    alignSelf: 'center',
  },
});
