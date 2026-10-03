import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel, Slash } from '../ui/Display';
import { useTheme } from '../../theme';
import { spacing } from '../../theme/tokens';
import { exerciseDisplayName } from '../../services/exerciseSubstitutionCandidates';
import { useUnits } from '../../state/UnitsContext';
import { formatWorkoutLoadFromKg, workoutLoadUnit } from '../../units/workoutLoadConversions';
import type { WorkoutHighlight } from '../../workoutSummary/highlights';

function highlightReason(
  item: WorkoutHighlight,
  reasons: { newRecord: string; improvedVsLast: string; bestOfSession: string },
): string | null {
  if (item.isPersonalRecord) return reasons.newRecord;
  if (item.deltaVsPreviousSessionKg != null && item.deltaVsPreviousSessionKg > 0) {
    return reasons.improvedVsLast;
  }
  if (item.maxLoadKg != null) return reasons.bestOfSession;
  return null;
}

export function WorkoutHighlightsSection({ highlights }: { highlights: WorkoutHighlight[] }) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const unit = workoutLoadUnit(resolvedUnits);
  const reasons = {
    newRecord: t('done.summary.highlights.newRecord'),
    improvedVsLast: t('done.summary.highlights.improvedVsLast'),
    bestOfSession: t('done.summary.highlights.bestOfSession'),
  };

  if (highlights.length === 0) return null;

  return (
    <View style={{ marginTop: spacing[7] }}>
      <Slash style={{ marginBottom: spacing[3] }}>{t('done.summary.highlights.title')}</Slash>
      <View style={{ gap: spacing[2.5] }}>
        {highlights.map((item) => {
          const reason = highlightReason(item, reasons);
          return (
            <Card key={item.exerciseId} style={{ padding: spacing[3.5], flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: theme.radii.md,
                  backgroundColor: item.isPersonalRecord ? theme.colors.primarySurface : theme.colors.surfaceElevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  name={item.isPersonalRecord ? 'trophy' : 'dumbbell'}
                  size={16}
                  color={item.isPersonalRecord ? theme.colors.primaryEmphasis : theme.colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }} numberOfLines={1}>
                  {exerciseDisplayName(item.exerciseId, catalogLocale)}
                </Text>
                {reason ? (
                  <MonoLabel size={9} color={item.isPersonalRecord ? theme.colors.primaryEmphasis : theme.colors.textFaint} style={{ marginTop: 3 }}>
                    {reason.toUpperCase()}
                  </MonoLabel>
                ) : null}
              </View>
              {item.maxLoadKg != null ? (
                <Text style={{ fontFamily: theme.fonts.display, fontSize: 18, color: theme.colors.textPrimary, transform: [{ skewX: '-8deg' }] }}>
                  {formatWorkoutLoadFromKg(item.maxLoadKg, resolvedUnits)} {unit}
                </Text>
              ) : null}
            </Card>
          );
        })}
      </View>
    </View>
  );
}
