import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BodyMuscleMap } from '../fitness/BodyMuscleMap';
import { Slash } from '../ui/Display';
import { useTheme } from '../../theme';
import { spacing } from '../../theme/tokens';
import type { SessionMuscleBreakdown } from '../../lib/sessionMuscles';
import type { Sex } from '../../state/AppState';

type LooseT = (key: string, options?: Record<string, unknown>) => string;

function translateMuscle(tLoose: LooseT, muscleId: string): string {
  return tLoose(`muscleGroups.${muscleId}`, { defaultValue: muscleId });
}

export function MusclesWorkedSection({
  sex,
  bodyMap,
}: {
  sex: Sex;
  bodyMap: SessionMuscleBreakdown;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const tLoose = t as unknown as LooseT;

  if (bodyMap.primary.length === 0) return null;

  const primaryLabels = bodyMap.primary.map((muscleId) => translateMuscle(tLoose, muscleId));

  return (
    <View style={{ marginTop: spacing[7], alignItems: 'center' }}>
      <Slash style={{ marginBottom: spacing[3], alignSelf: 'flex-start' }}>{t('done.summary.muscles.title')}</Slash>
      <Text style={{ alignSelf: 'flex-start', fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary, marginBottom: spacing[4] }}>
        {primaryLabels.join(' · ')}
      </Text>
      <BodyMuscleMap
        sex={sex}
        primaryMuscles={bodyMap.primary}
        secondaryMuscles={bodyMap.secondary}
        size={96}
        activeColor={theme.colors.primaryEmphasis}
        baseColor={theme.colors.surfaceElevated}
        outlineColor={theme.colors.borderStrong}
      />
    </View>
  );
}
