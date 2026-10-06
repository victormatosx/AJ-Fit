import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { displayLineHeight } from '../../../theme/tokens';
import { formatWorkoutShareDuration } from '../../../workoutShare/data';
import { useAjLogoSource } from '../../../workoutShare/logo';
import type { WorkoutShareArtPosterProps } from './types';

/**
 * ARTE 1/4 — Minimal. A real transparent PNG: the root `View` never sets a
 * `backgroundColor`, so whatever the user places behind it (a photo, a
 * Story background) shows straight through. Legibility over an unknown
 * background comes from a drop shadow on the text/logo, not from a tinted
 * backdrop panel — a backdrop covering the full canvas would defeat the
 * point of exporting a transparent PNG in the first place.
 */
export function ArtPosterMinimal({ shareData, width, height, posterRef }: WorkoutShareArtPosterProps) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const scale = width / 360;
  const textShadow = {
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 2 * scale },
    textShadowRadius: 10 * scale,
  } as const;

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-art-poster"
      style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 32 * scale }}>
        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 44 * scale, height: 44 * scale, marginBottom: 22 * scale }}
        />
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: theme.fonts.mono, fontSize: 10 * scale, letterSpacing: 3 * scale, ...textShadow }}>
          {t('done.shareComposer.complete').toUpperCase()}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{
            color: '#FFFFFF',
            fontFamily: theme.fonts.display,
            fontSize: 38 * scale,
            lineHeight: displayLineHeight(38 * scale),
            textAlign: 'center',
            marginTop: 12 * scale,
            textTransform: 'uppercase',
            ...textShadow,
          }}
        >
          {shareData.workoutName}
        </Text>
        <View style={{ width: 30 * scale, height: 1, backgroundColor: theme.colors.primaryEmphasis, marginTop: 16 * scale, marginBottom: 16 * scale }} />
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontFamily: theme.fonts.uiSemi, fontSize: 14 * scale, letterSpacing: 1 * scale, ...textShadow }}>
          {formatWorkoutShareDuration(shareData.durationSeconds).toUpperCase()}
        </Text>
      </View>
    </View>
  );
}
