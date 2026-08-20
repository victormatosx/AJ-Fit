import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import {
  colors,
  displayLineHeight,
  fonts,
  gradients,
  radii,
  spacing,
} from '../../theme/tokens';
import { useUnits } from '../../state/UnitsContext';
import {
  formatWeightFromKg,
  weightUnit,
} from '../../units/weightConversions';

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={{ width: '48%', paddingVertical: spacing[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 30,
            lineHeight: displayLineHeight(30),
            color: colors.text,
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {value}
        </Text>
        {unit ? <MonoLabel>{unit}</MonoLabel> : null}
      </View>
      <MonoLabel style={{ marginTop: -spacing[1] }}>{label}</MonoLabel>
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
  const { t } = useTranslation('assessment');
  const { resolvedUnits } = useUnits();
  const massUnit = weightUnit(resolvedUnits);
  return (
    <LinearGradient
      accessible
      accessibilityLabel={t('summary.lastAssessmentLabel', { date: lastDateLabel })}
      colors={gradients.accentWash}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        paddingHorizontal: spacing[5],
        paddingTop: spacing[4],
        paddingBottom: spacing[2],
        borderRadius: radii.xxl,
        borderBottomRightRadius: 0,
        borderWidth: 1,
        borderColor: colors.accent,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: spacing[2],
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <MonoLabel color={colors.accentHi}>{t('summary.currentState').toUpperCase()}</MonoLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
          <Icon name="calendar" size={12} color={colors.faint} />
          <MonoLabel size={9}>{lastDateLabel}</MonoLabel>
        </View>
      </View>
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
    </LinearGradient>
  );
}
