import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../theme';
import { useUnits } from '../../../state/UnitsContext';
import { exerciseDisplayName } from '../../../services/exerciseSubstitutionCandidates';
import { formatWorkoutLoadFromKg, workoutLoadUnit } from '../../../units/workoutLoadConversions';
import { useAjLogoSource } from '../../../workoutShare/logo';
import { workoutShareArtCatalogLocale } from './catalogLocale';
import type { WorkoutShareArtPosterProps } from './types';

/**
 * ARTE 3/4 — PR. Only ever mounted when
 * `isWorkoutShareArtLayoutAvailable('artPr', summaryData)` is true (the
 * composer filters it out of the carousel otherwise) — `personalRecords[0]`
 * is therefore always safe to read. When a session has more than one PR,
 * the single biggest jump over the previous best is the one worth a sticker.
 */
export function ArtPosterPr({ summaryData, width, height, posterRef }: WorkoutShareArtPosterProps) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('workout');
  const logoSource = useAjLogoSource();
  const { resolvedUnits } = useUnits();
  const scale = width / 360;
  const textShadow = {
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 2 * scale },
    textShadowRadius: 10 * scale,
  } as const;

  const record = [...summaryData.personalRecords].sort(
    (a, b) => (b.newLoadKg - b.previousBestKg) - (a.newLoadKg - a.previousBestKg),
  )[0];
  if (!record) return <View ref={posterRef} collapsable={false} style={{ width, height }} />;

  const unit = workoutLoadUnit(resolvedUnits);
  const load = formatWorkoutLoadFromKg(record.newLoadKg, resolvedUnits);
  const catalogLocale = workoutShareArtCatalogLocale(i18n.language);
  const exerciseName = exerciseDisplayName(record.exerciseId, catalogLocale);

  return (
    <View
      ref={posterRef}
      collapsable={false}
      testID="workout-share-art-poster"
      style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', paddingHorizontal: 32 * scale }}>
        <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.monoBold, fontSize: 11 * scale, letterSpacing: 3 * scale, ...textShadow }}>
          {t('done.shareComposer.artPrNewRecord').toUpperCase()}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 18 * scale }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            style={{ color: '#FFFFFF', fontFamily: theme.fonts.display, fontSize: 62 * scale, ...textShadow }}
          >
            {load}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: theme.fonts.uiSemi, fontSize: 19 * scale, marginLeft: 6 * scale, ...textShadow }}>
            {unit.toUpperCase()}
          </Text>
        </View>

        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{ color: 'rgba(255,255,255,0.95)', fontFamily: theme.fonts.uiSemi, fontSize: 15 * scale, letterSpacing: 1 * scale, marginTop: 10 * scale, textTransform: 'uppercase', ...textShadow }}
        >
          {exerciseName}
        </Text>

        <Image
          source={logoSource}
          contentFit="contain"
          accessibilityLabel="AJ Fit"
          style={{ width: 36 * scale, height: 36 * scale, marginTop: 24 * scale, opacity: 0.95 }}
        />
      </View>
    </View>
  );
}
