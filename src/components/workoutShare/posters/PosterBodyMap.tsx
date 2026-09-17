import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { BodyMuscleMap } from '../../fitness/BodyMuscleMap';
import { useTheme } from '../../../theme';
import { palette } from '../../../theme/tokens';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoSource } from '../../../workoutShare/logo';
import { PosterPhoto } from './PosterPhoto';
import type { WorkoutSharePosterProps } from './types';

/**
 * Design 4/5 — BodyMap (9:16, full-bleed photo). Same canvas as every other
 * layout; the differentiator is a translucent panel showing the real
 * `BodyMuscleMap` for the muscles actually trained today
 * (`WorkoutShareData.bodyMap`, derived in `workoutShare/data.ts` from
 * completed sets only — see `buildWorkoutShareBodyMap`).
 *
 * `data.bodyMap.primary` can legitimately be empty (unresolvable exercise
 * ids, or nothing completed) — this must never be papered over with
 * invented muscles. When empty, the panel is omitted entirely and the
 * layout degrades to a clean name+metrics card (still intentional, never a
 * broken/empty silhouette).
 */
export function PosterBodyMap({ data, photo, width, height, posterRef }: WorkoutSharePosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const hasBodyMap = data.bodyMap.primary.length > 0;
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
      style={{ width, height, overflow: 'hidden', backgroundColor: '#040214' }}
    >
      {photo ? (
        <PosterPhoto key={photo.uri} photo={photo} width={width} height={height} />
      ) : (
        <LinearGradient
          colors={['#0B2A64', '#080526', '#03010F']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ width, height }}
        />
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(1,0,8,0.15)', 'rgba(1,0,8,0.55)', 'rgba(1,0,8,0.85)']}
        locations={[0, 0.5, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <View pointerEvents="none" style={{ position: 'absolute', left: 24 * scale, right: 24 * scale, top: 30 * scale }}>
        <Text style={{ color: '#AFCBFF', fontFamily: theme.fonts.monoBold, fontSize: 9.5 * scale, letterSpacing: 2 * scale }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 27 * scale,
            marginTop: 6 * scale,
            textTransform: 'uppercase',
          }}
        >
          {data.workoutName}
        </Text>
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', left: 24 * scale, right: 24 * scale, bottom: 64 * scale, alignItems: 'center' }}>
        {hasBodyMap ? (
          <View
            style={{
              backgroundColor: 'rgba(4,8,24,0.58)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              borderRadius: 18 * scale,
              paddingVertical: 16 * scale,
              paddingHorizontal: 14 * scale,
              alignItems: 'center',
              marginBottom: 18 * scale,
            }}
          >
            <BodyMuscleMap
              primaryMuscles={data.bodyMap.primary}
              secondaryMuscles={data.bodyMap.secondary}
              size={62 * scale}
              activeColor={palette.blue500}
              baseColor="rgba(255,255,255,0.12)"
              outlineColor="rgba(255,255,255,0.22)"
            />
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: theme.fonts.monoBold, fontSize: 7 * scale, letterSpacing: 1.4 * scale, marginTop: 10 * scale }}>
              {t('done.shareComposer.bodyMapLabel').toUpperCase()}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row' }}>
          {metrics.map(([value, label], index) => (
            <View key={label} style={{ flex: index === 2 ? 1.3 : 0.8, minWidth: 0, alignItems: 'center' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: theme.fonts.uiBold, fontSize: 20 * scale }}>
                {value}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontFamily: theme.fonts.monoBold, fontSize: 7 * scale, letterSpacing: 0.6 * scale, marginTop: 3 * scale }}>
                {label.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>

        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 38 * scale, height: 38 * scale, marginTop: 18 * scale }}
        />
      </View>
    </View>
  );
}
