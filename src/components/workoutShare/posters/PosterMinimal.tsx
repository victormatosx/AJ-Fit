import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { displayLineHeight } from '../../../theme/tokens';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoSource } from '../../../workoutShare/logo';
import { PosterPhoto } from './PosterPhoto';
import type { WorkoutSharePosterProps } from './types';

/**
 * Design 2/5 — Minimal Premium (9:16, full-bleed photo). Inspired by the
 * restrained, one-line stat strip common to Strava/Garmin activity shares:
 * a single soft gradient (not Classic's multi-stop vignette), a centered
 * kicker + name, a thin rule, and the three metrics as one inline row
 * separated by middot dots instead of Classic's stat columns. Works
 * identically with or without a photo — the flat gradient below stands in
 * for it.
 */
export function PosterMinimal({ data, photo, width, height, posterRef }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const metricLine = [
    formatWorkoutShareDuration(data.durationSeconds),
    `${data.exerciseCount} ${t('done.shareComposer.exercises').toLowerCase()}`,
    `${data.completedSetCount} ${t('done.shareComposer.sets').toLowerCase()}`,
  ].join('   ·   ');

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-poster"
      style={{ width, height, overflow: 'hidden', backgroundColor: '#0A0A0A' }}
    >
      {photo ? (
        <PosterPhoto key={photo.uri} photo={photo} width={width} height={height} />
      ) : (
        <LinearGradient
          colors={['#151515', '#0C0C0C', '#040404']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={{ width, height }}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.72)']}
        locations={[0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: height * 0.55, bottom: 0 }}
      />

      <View pointerEvents="none" style={{ position: 'absolute', left: 24 * scale, right: 24 * scale, bottom: 64 * scale, alignItems: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: theme.fonts.mono, fontSize: 9 * scale, letterSpacing: 2.6 * scale }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 30 * scale,
            lineHeight: displayLineHeight(30 * scale),
            textAlign: 'center',
            marginTop: 10 * scale,
            textTransform: 'uppercase',
          }}
        >
          {data.workoutName}
        </Text>

        <View style={{ width: 26 * scale, height: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 14 * scale, marginBottom: 14 * scale }} />

        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          style={{ color: 'rgba(255,255,255,0.9)', fontFamily: theme.fonts.uiSemi, fontSize: 12.5 * scale, letterSpacing: 0.3 * scale }}
        >
          {metricLine}
        </Text>

        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 36 * scale, height: 36 * scale, marginTop: 20 * scale, opacity: 0.92 }}
        />
      </View>
    </View>
  );
}
