import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import { EvolutionLineChart, type EvolutionPoint } from './EvolutionLineChart';
import { useUnits } from '../../state/UnitsContext';
import { weightFromKg, weightUnit } from '../../units/weightConversions';

// Fixed categorical slots — weight and body fat live on incomparable scales
// (mass vs %), so they're two single-series charts, never one dual-axis chart.
// Validated: node scripts/validate_palette.js "#3987e5,#d95926" --mode dark
// --surface "#020010" (dataviz skill) — passes lightness/chroma/CVD/contrast.
const WEIGHT_COLOR = '#3987e5';
const BODY_FAT_COLOR = '#d95926';

function DeltaChip({
  label,
  value,
  unit,
  goodWhenNegative,
}: {
  label: string;
  value: number | null;
  unit: string;
  goodWhenNegative?: boolean;
}) {
  const { t } = useTranslation('assessment');
  if (value == null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing[1] }}>
        <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.faint }}>—</Text>
      </View>
    );
  }
  const positive = goodWhenNegative ? value <= 0 : value >= 0;
  const sign = value > 0 ? '+' : '';
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing[1] }}>
      <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
      <Text
        style={{
          fontFamily: fonts.uiBold,
          fontSize: 15,
          color: positive ? colors.success : colors.danger,
        }}
      >
        {t('result', { value: `${sign}${value.toFixed(1)}`, unit })}
      </Text>
    </View>
  );
}

export function AssessmentEvolutionCard({
  hasPrevious,
  weightPoints,
  bodyFatPoints,
  weightDelta,
  bodyFatDelta,
  leanMassDelta,
  onViewHistory,
}: {
  hasPrevious: boolean;
  weightPoints: EvolutionPoint[];
  bodyFatPoints: EvolutionPoint[];
  weightDelta: number;
  bodyFatDelta: number | null;
  leanMassDelta: number | null;
  onViewHistory: () => void;
}) {
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  const displayedWeightPoints = weightPoints.map((point) => ({
    ...point,
    value: weightFromKg(point.value, resolvedUnits),
  }));
  return (
    <Card style={{ padding: spacing[4], borderTopLeftRadius: radii.xs }}>
      <View accessible accessibilityLabel={t('accessibility.evolutionCard')}>
      <View style={{ flexDirection: 'row', gap: spacing[4] }}>
        <EvolutionLineChart
          label={t('metrics.weight').toUpperCase()}
          unit={massUnit}
          color={WEIGHT_COLOR}
          points={displayedWeightPoints}
          emptyHint={t('charts.weightEmpty')}
          showEmptyHint={hasPrevious}
        />
        <EvolutionLineChart
          label={t('metrics.bodyFat').toUpperCase()}
          unit={t('units.percent')}
          color={BODY_FAT_COLOR}
          points={bodyFatPoints}
          emptyHint={t('charts.bodyFatEmpty')}
          showEmptyHint={hasPrevious}
        />
      </View>

      <View
        style={{
          marginTop: spacing[4],
          paddingTop: spacing[4],
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <MonoLabel color={colors.textSecondary} style={{ marginBottom: spacing[3] }}>
          {t('evolution.sincePrevious').toUpperCase()}
        </MonoLabel>

        {hasPrevious ? (
          <View style={{ flexDirection: 'row' }}>
            <DeltaChip
              label={t('metrics.weight').toUpperCase()}
              value={weightFromKg(weightDelta, resolvedUnits)}
              unit={massUnit}
              goodWhenNegative
            />
            <DeltaChip
              label={t('metrics.bodyFat').toUpperCase()}
              value={bodyFatDelta}
              unit={t('units.percent')}
              goodWhenNegative
            />
            <DeltaChip
              label={t('metrics.leanMass').toUpperCase()}
              value={
                leanMassDelta != null
                  ? weightFromKg(leanMassDelta, resolvedUnits)
                  : null
              }
              unit={massUnit}
            />
          </View>
        ) : (
          <Text
            style={{
              fontFamily: fonts.ui,
              fontSize: 12.5,
              lineHeight: 18,
              color: colors.mute,
            }}
          >
            {t('evolution.noPreviousMessage')}
          </Text>
        )}
      </View>

      <Pressable
        onPress={onViewHistory}
        accessibilityRole="button"
        accessibilityLabel={t('accessibility.viewHistory')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          minHeight: 44,
          marginTop: spacing[2],
          paddingTop: spacing[3],
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <Text
          style={{
            fontFamily: fonts.mono,
            fontSize: 11,
            letterSpacing: 1,
            color: colors.accentHi,
          }}
        >
          {t('evolution.viewHistoryCta').toUpperCase()}
        </Text>
        <Icon name="chevron-right" size={12} color={colors.accentHi} />
      </Pressable>
      </View>
    </Card>
  );
}
