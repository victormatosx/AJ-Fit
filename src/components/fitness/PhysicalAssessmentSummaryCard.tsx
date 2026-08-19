import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsContext';
import {
  formatWeightFromKg,
  weightUnit,
} from '../../units/weightConversions';

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: '48%', marginBottom: 16 }}>
      <MonoLabel style={{ marginBottom: 4 }}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: theme.fonts.display,
            fontSize: 28,
            color: theme.colors.textPrimary,
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {value}
        </Text>
        {unit ? <MonoLabel>{unit}</MonoLabel> : null}
      </View>
    </View>
  );
}

export function PhysicalAssessmentSummaryCard({
  weight,
  bodyFat,
  leanMass,
  bmi,
  lastDateLabel,
}: {
  weight: number | null;
  bodyFat: number | null;
  leanMass: number | null;
  bmi: number | null;
  lastDateLabel: string;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  return (
    <LinearGradient
      colors={theme.gradients.accentWash}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        padding: 20,
        borderRadius: 18,
        borderBottomRightRadius: 0,
        borderWidth: 1,
        borderColor: theme.colors.primaryBorderMuted,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Metric
          label={t('metrics.weight').toUpperCase()}
          value={weight != null ? formatWeightFromKg(weight, resolvedUnits) : '—'}
          unit={massUnit}
        />
        <Metric
          label={t('metrics.bodyFat').toUpperCase()}
          value={bodyFat != null ? bodyFat.toFixed(1).replace('.', ',') : '—'}
          unit={t('units.percent')}
        />
        <Metric
          label={t('metrics.leanMass').toUpperCase()}
          value={leanMass != null ? formatWeightFromKg(leanMass, resolvedUnits) : '—'}
          unit={massUnit}
        />
        <Metric
          label={t('metrics.bmi').toUpperCase()}
          value={bmi != null ? bmi.toFixed(1) : '—'}
          unit=""
        />
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: theme.colors.divider,
        }}
      >
        <Icon name="calendar" size={13} color={theme.colors.textMuted} />
        <MonoLabel>
          {t('summary.lastAssessmentLabel', { date: lastDateLabel }).toUpperCase()}
        </MonoLabel>
      </View>
    </LinearGradient>
  );
}
