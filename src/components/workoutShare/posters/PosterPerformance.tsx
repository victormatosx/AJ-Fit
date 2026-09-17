import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoSource } from '../../../workoutShare/logo';
import { PosterPhoto } from './PosterPhoto';
import type { WorkoutSharePosterProps } from './types';

/**
 * Design 3/5 — Performance Metrics (9:16, full-bleed photo). Same canvas as
 * every other layout — the photo always fills the whole poster — but the
 * overlay is data-forward: a taller, stronger bottom gradient clears room
 * for three large stat rows (a Garmin/Strava activity-summary cadence)
 * instead of Classic's compact 3-column block. No metric beyond
 * exercises/sets/duration is invented here.
 */
export function PosterPerformance({ data, photo, width, height, posterRef }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const metrics = [
    [formatWorkoutShareDuration(data.durationSeconds), t('done.shareComposer.duration')],
    [String(data.completedSetCount), t('done.shareComposer.sets')],
    [String(data.exerciseCount), t('done.shareComposer.exercises')],
  ] as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-poster"
      style={{ width, height, overflow: 'hidden', backgroundColor: '#050505' }}
    >
      {photo ? (
        <PosterPhoto key={photo.uri} photo={photo} width={width} height={height} />
      ) : (
        <LinearGradient
          colors={['#101820', '#080D12', '#020304']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={{ width, height }}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.42, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: height * 0.3, bottom: 0 }}
      />

      <View pointerEvents="none" style={{ position: 'absolute', left: 26 * scale, top: 30 * scale }}>
        <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold, fontSize: 9 * scale, letterSpacing: 2 * scale }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', left: 26 * scale, right: 26 * scale, bottom: 64 * scale }}>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
          style={{ color: '#FFFFFF', fontFamily: theme.fonts.display, fontSize: 26 * scale, textTransform: 'uppercase', marginBottom: 16 * scale }}
        >
          {data.workoutName}
        </Text>

        {metrics.map(([value, label], index) => (
          <View
            key={label}
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              paddingVertical: 10 * scale,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: 'rgba(255,255,255,0.16)',
            }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: theme.fonts.uiSemi, fontSize: 11.5 * scale, letterSpacing: 0.6 * scale }}>
              {label.toUpperCase()}
            </Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.display, fontSize: 34 * scale }}>
              {value}
            </Text>
          </View>
        ))}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 * scale }}>
          <Image
            source={logoSource}
            contentFit="contain"
            accessibilityLabel="AJ Fit"
            style={{ width: 38 * scale, height: 38 * scale, opacity: 0.92 }}
          />
        </View>
      </View>
    </View>
  );
}
