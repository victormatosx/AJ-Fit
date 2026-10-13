import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
import type { NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../nutrition/weekly';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { SkeletonBlock } from './NutritionPrimitives';

export function WeeklySummaryCard({
  summary, weight, loading, onPress,
}: {
  summary: NutritionWeeklySummary | null;
  weight: NutritionWeeklyWeightSummary | null;
  loading: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);

  if (loading) return <SkeletonBlock height={142} />;

  const delta = weight?.deltaKg != null ? weightFromKg(weight.deltaKg, resolvedUnits) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('weekly.open')}
      style={{
        padding: 16, borderRadius: theme.radii.xl, backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.cardBorder, gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <MonoLabel color={theme.colors.textSecondary}>{t('weekly.thisWeek').toUpperCase()}</MonoLabel>
        <Icon name="chevron-right" size={16} color={theme.colors.primaryEmphasis} />
      </View>
      {summary?.averageConsumed ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
          <CompactMetric label={t('weekly.average')} value={`${Math.round(summary.averageConsumed.kcal)}`} unit={t('weekly.kcalPerDay')} />
          <CompactMetric label={t('weekly.protein')} value={`${Math.round(summary.averageConsumed.proteinG)}`} unit={t('weekly.gramsPerDay')} />
          <CompactMetric
            label={t('weekly.weight')}
            value={delta == null ? (weight?.latest ? formatWeightFromKg(weight.latest.weightKg, resolvedUnits) : '—') : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
            unit={delta == null && weight?.latest ? massUnit : delta == null ? '' : massUnit}
          />
          <CompactMetric label={t('weekly.records')} value={`${summary.recordedDays}/7`} unit={t('weekly.days')} />
        </View>
      ) : (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted }}>
          {t('weekly.empty')}
        </Text>
      )}
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 12.5, color: theme.colors.primaryEmphasis }}>
        {t('weekly.open')}
      </Text>
    </Pressable>
  );
}

function CompactMetric({ label, value, unit }: { label: string; value: string; unit: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: '50%' }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, letterSpacing: 1.1, color: theme.colors.textFaint }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ marginTop: 3, fontFamily: theme.fonts.uiBold, fontSize: 18, color: theme.colors.textPrimary }}>
        {value}{unit ? <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, color: theme.colors.textMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}
