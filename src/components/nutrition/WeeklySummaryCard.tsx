import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
import type { NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../nutrition/weekly';
import { Icon } from '../ui/Icon';
import { NU, NuCap } from './NuKit';
import { SkeletonBlock } from './NutritionPrimitives';

export function WeeklySummaryCard({
  summary, weight, loading, onPress,
}: {
  summary: NutritionWeeklySummary | null;
  weight: NutritionWeeklyWeightSummary | null;
  loading: boolean;
  onPress: () => void;
}) {
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
        padding: 16, borderRadius: 16, backgroundColor: NU.surfaceSubtle,
        borderWidth: 1, borderColor: NU.hairline, gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <NuCap>{t('weekly.thisWeek')}</NuCap>
        <Icon name="chevron-right" size={15} color={NU.blueHi} />
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
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13, lineHeight: 19, color: NU.faint }}>
          {t('weekly.empty')}
        </Text>
      )}
      <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12.5, color: NU.blueHi }}>
        {t('weekly.open')}
      </Text>
    </Pressable>
  );
}

function CompactMetric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={{ width: '50%' }}>
      <NuCap>{label}</NuCap>
      <Text style={{ marginTop: 3, fontFamily: 'Archivo_700Bold', fontSize: 18, color: NU.white }}>
        {value}{unit ? <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 11, color: NU.faint }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}
