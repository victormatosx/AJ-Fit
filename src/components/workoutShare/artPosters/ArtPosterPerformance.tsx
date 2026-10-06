import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { useUnits } from '../../../state/UnitsContext';
import { formatWorkoutLoadFromKg, workoutLoadUnit } from '../../../units/workoutLoadConversions';
import { useAjLogoSource } from '../../../workoutShare/logo';
import type { WorkoutShareArtPosterProps } from './types';

/**
 * ARTE 2/4 — Performance. Volume is formatted with the exact same function
 * `WorkoutSummaryScreen` uses for its own "Volume" stat tile
 * (`formatWorkoutLoadFromKg` + `workoutLoadUnit`) — no separate rounding
 * rule invented for this poster.
 */
export function ArtPosterPerformance({ summaryData, width, height, posterRef }: WorkoutShareArtPosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const { resolvedUnits } = useUnits();
  const scale = width / 360;
  const textShadow = {
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 2 * scale },
    textShadowRadius: 10 * scale,
  } as const;
  const unit = workoutLoadUnit(resolvedUnits);
  const volume = formatWorkoutLoadFromKg(summaryData.volumeKg, resolvedUnits);
  const subtitle = [
    `${summaryData.completedSetCount} ${t('done.shareComposer.sets').toLowerCase()}`,
    `${summaryData.totalReps} ${t('done.shareComposer.artPerformanceReps').toLowerCase()}`,
  ].join('   ·   ');

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-art-poster"
      style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 32 * scale }}>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: theme.fonts.mono, fontSize: 10 * scale, letterSpacing: 3 * scale, ...textShadow }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 16 * scale }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: '#FFFFFF', fontFamily: theme.fonts.display, fontSize: 56 * scale, ...textShadow }}
          >
            {volume}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: theme.fonts.uiSemi, fontSize: 18 * scale, marginLeft: 6 * scale, ...textShadow }}>
            {unit.toUpperCase()}
          </Text>
        </View>
        <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi, fontSize: 12 * scale, letterSpacing: 2 * scale, marginTop: 4 * scale, ...textShadow }}>
          {t('done.shareComposer.artPerformanceVolume').toUpperCase()}
        </Text>

        <Text style={{ color: 'rgba(255,255,255,0.92)', fontFamily: theme.fonts.uiSemi, fontSize: 13 * scale, letterSpacing: 0.3 * scale, marginTop: 18 * scale, ...textShadow }}>
          {subtitle}
        </Text>

        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 36 * scale, height: 36 * scale, marginTop: 22 * scale, opacity: 0.95 }}
        />
      </View>
    </View>
  );
}
