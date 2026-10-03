import type { ReactNode } from 'react';
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
import type { WorkoutSummaryCurrentBest, WorkoutSummaryPersonalRecord } from '../../workoutSummary/buildWorkoutSummaryData';

function RecordRow({
  exerciseId,
  highlighted,
  valueLabel,
  metricLabel,
  catalogLocale,
}: {
  exerciseId: string;
  highlighted: boolean;
  valueLabel: ReactNode;
  metricLabel: string;
  catalogLocale: 'ptBR' | 'en' | 'es';
}) {
  const { theme } = useTheme();
  return (
    <Card style={{ padding: spacing[3.5], flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radii.md,
          backgroundColor: highlighted ? theme.colors.primarySurface : theme.colors.surfaceElevated,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="trophy" size={16} color={highlighted ? theme.colors.primaryEmphasis : theme.colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }} numberOfLines={1}>
          {exerciseDisplayName(exerciseId, catalogLocale)}
        </Text>
        <MonoLabel size={9} style={{ marginTop: 3 }}>
          {metricLabel.toUpperCase()}
        </MonoLabel>
      </View>
      {valueLabel}
    </Card>
  );
}

export function PersonalRecordsSection({
  personalRecords,
  currentBests,
  performedAnyLoadBasedExercise,
}: {
  personalRecords: WorkoutSummaryPersonalRecord[];
  currentBests: WorkoutSummaryCurrentBest[];
  performedAnyLoadBasedExercise: boolean;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const unit = workoutLoadUnit(resolvedUnits);
  const formatLoad = (kg: number) => `${formatWorkoutLoadFromKg(kg, resolvedUnits)} ${unit}`;
  const metricLabel = t('done.summary.records.loadMetricLabel');

  if (!performedAnyLoadBasedExercise) {
    return (
      <View style={{ marginTop: spacing[7] }}>
        <Slash style={{ marginBottom: spacing[3] }}>{t('done.summary.records.title')}</Slash>
        <Card style={{ padding: spacing[4] }}>
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
            {t('done.summary.records.noLoadDataTitle')}
          </Text>
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted, marginTop: spacing[1] }}>
            {t('done.summary.records.noLoadDataSubtitle')}
          </Text>
        </Card>
      </View>
    );
  }

  const hasRecords = personalRecords.length > 0;

  return (
    <View style={{ marginTop: spacing[7] }}>
      <Slash style={{ marginBottom: spacing[3] }}>{t('done.summary.records.title')}</Slash>

      {!hasRecords ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted, marginBottom: spacing[3] }}>
          {t('done.summary.records.emptySubtitle')}
        </Text>
      ) : null}

      <View style={{ gap: spacing[2.5] }}>
        {hasRecords
          ? personalRecords.map((record) => (
              <RecordRow
                key={record.exerciseId}
                exerciseId={record.exerciseId}
                highlighted
                catalogLocale={catalogLocale}
                metricLabel={metricLabel}
                valueLabel={
                  <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 12, color: theme.colors.primaryEmphasis }}>
                    {t('done.summary.records.previousToNew', {
                      previous: formatLoad(record.previousBestKg),
                      current: formatLoad(record.newLoadKg),
                    })}
                  </Text>
                }
              />
            ))
          : currentBests.map((best) => (
              <RecordRow
                key={best.exerciseId}
                exerciseId={best.exerciseId}
                highlighted={false}
                catalogLocale={catalogLocale}
                metricLabel={metricLabel}
                valueLabel={
                  <Text style={{ fontFamily: theme.fonts.display, fontSize: 18, color: theme.colors.textPrimary, transform: [{ skewX: '-8deg' }] }}>
                    {formatLoad(best.loadKg)}
                  </Text>
                }
              />
            ))}
      </View>
    </View>
  );
}
