import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoSource } from '../../../workoutShare/logo';
import type { WorkoutShareArtPosterProps } from './types';

/**
 * ARTE 4/4 — Stats. A compact grid of the four always-available numbers
 * (date, exercises, sets, reps) instead of one headline metric — the
 * "give me everything at a glance" option alongside Minimal/Performance/PR.
 */
export function ArtPosterStats({ shareData, summaryData, width, height, posterRef }: WorkoutShareArtPosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const textShadow = {
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 2 * scale },
    textShadowRadius: 10 * scale,
  } as const;

  const stats = [
    [String(shareData.exerciseCount), t('done.shareComposer.exercises')],
    [String(summaryData.completedSetCount), t('done.shareComposer.sets')],
    [String(summaryData.totalReps), t('done.shareComposer.artPerformanceReps')],
    [formatWorkoutShareDuration(shareData.durationSeconds), t('done.shareComposer.duration')],
  ] as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-art-poster"
      style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 30 * scale }}>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 26 * scale,
            textAlign: 'center',
            textTransform: 'uppercase',
            marginBottom: 22 * scale,
            ...textShadow,
          }}
        >
          {shareData.workoutName}
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 22 * scale, rowGap: 20 * scale }}>
          {stats.map(([value, label]) => (
            <View key={label} style={{ width: 120 * scale, alignItems: 'center' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.display, fontSize: 28 * scale, ...textShadow }}>
                {value}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: theme.fonts.uiSemi, fontSize: 10.5 * scale, letterSpacing: 1 * scale, marginTop: 4 * scale, ...textShadow }}>
                {label.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ width: 30 * scale, height: 1, backgroundColor: theme.colors.primaryEmphasis, marginTop: 24 * scale, marginBottom: 16 * scale }} />

        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 36 * scale, height: 36 * scale, opacity: 0.95 }}
        />
      </View>
    </View>
  );
}
