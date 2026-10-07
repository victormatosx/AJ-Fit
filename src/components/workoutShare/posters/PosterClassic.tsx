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
 * Design 1/5 — the original single-poster design (9:16), preserved exactly:
 * full-bleed photo or navy gradient, bottom readability veil, kicker +
 * workout name + 3-metric row + logo pinned near the bottom.
 */
export function PosterClassic({ data, photo, width, height, posterRef, variant = 'photo' }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const metrics = [
    [String(data.exerciseCount), t('done.shareComposer.exercises')],
    [String(data.completedSetCount), t('done.shareComposer.sets')],
    [formatWorkoutShareDuration(data.durationSeconds), t('done.shareComposer.duration')],
  ] as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-poster"
      style={{ width, height, overflow: 'hidden', ...(variant === 'photo' ? { backgroundColor: '#040214' } : {}) }}
    >
      {variant === 'transparent' ? null : photo ? (
        <PosterPhoto key={photo.uri} photo={photo} width={width} height={height} />
      ) : (
        <LinearGradient
          colors={['#0B2A64', '#080526', '#03010F']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ width, height }}
        />
      )}
      {variant === 'photo' ? (
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', 'rgba(1,0,8,0.18)', 'rgba(1,0,8,0.76)']}
          locations={[0, 0.55, 1]}
          style={{ position: 'absolute', left: 0, right: 0, top: height * 0.38, bottom: 0 }}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 28 * scale,
          right: 24 * scale,
          // ~252 px in the 1080x1920 export: clear of common Stories controls.
          bottom: 84 * scale,
        }}
      >
        <Text style={{ color: '#AFCBFF', fontFamily: theme.fonts.monoBold, fontSize: 10 * scale, letterSpacing: 1.7 * scale }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.68}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 39 * scale,
            lineHeight: displayLineHeight(39 * scale),
            marginTop: 4 * scale,
            textTransform: 'uppercase',
          }}
        >
          {data.workoutName}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 17 * scale }}>
          {metrics.map(([value, label], index) => (
            <View key={label} style={{ flex: index === 2 ? 1.3 : 0.8, minWidth: 0 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 22 * scale }}>
                {value}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.68)', fontFamily: theme.fonts.monoBold, fontSize: 7.5 * scale, letterSpacing: 0.7 * scale, marginTop: 3 * scale }}>
                {label.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 40 * scale, height: 40 * scale, marginTop: 20 * scale }}
        />
      </View>
    </View>
  );
}
