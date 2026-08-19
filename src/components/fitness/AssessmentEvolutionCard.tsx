import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';
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
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  if (value == null) {
    return (
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 15, color: theme.colors.textFaint }}>—</Text>
      </View>
    );
  }
  const positive = goodWhenNegative ? value <= 0 : value >= 0;
  const sign = value > 0 ? '+' : '';
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
      <Text
        style={{
          fontFamily: theme.fonts.uiBold,
          fontSize: 15,
          color: positive ? theme.colors.success : theme.colors.danger,
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
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  const displayedWeightPoints = weightPoints.map((point) => ({
    ...point,
    value: weightFromKg(point.value, resolvedUnits),
  }));
  return (
    <Card style={{ padding: 16 }}>
      <View accessible accessibilityLabel={t('accessibility.evolutionCard')}>
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
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
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            color: theme.colors.textMuted,
            textAlign: 'center',
          }}
        >
          {t('evolution.noPreviousMessage')}
        </Text>
      )}

      <Pressable
        onPress={onViewHistory}
        accessibilityRole="button"
        accessibilityLabel={t('accessibility.viewHistory')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: theme.colors.sheetDivider,
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 11,
            letterSpacing: 1,
            color: theme.colors.primaryEmphasis,
          }}
        >
          {t('evolution.viewHistoryCta').toUpperCase()}
        </Text>
        <Icon name="chevron-right" size={12} color={theme.colors.primaryEmphasis} />
      </Pressable>
      </View>
    </Card>
  );
}
