import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, fonts } from '../../theme/tokens';

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={{ width: '48%', marginBottom: 16 }}>
      <MonoLabel style={{ marginBottom: 4 }}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 28,
            color: '#fff',
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
  const { t } = useTranslation('assessment');
  return (
    <LinearGradient
      colors={['rgba(11,112,249,0.24)', 'rgba(11,112,249,0.04)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        padding: 20,
        borderRadius: 18,
        borderBottomRightRadius: 0,
        borderWidth: 1,
        borderColor: 'rgba(11,112,249,0.4)',
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Metric
          label={t('metrics.weight').toUpperCase()}
          value={weight != null ? weight.toFixed(1) : '—'}
          unit={t('units.kg')}
        />
        <Metric
          label={t('metrics.bodyFat').toUpperCase()}
          value={bodyFat != null ? bodyFat.toFixed(1).replace('.', ',') : '—'}
          unit={t('units.percent')}
        />
        <Metric
          label={t('metrics.leanMass').toUpperCase()}
          value={leanMass != null ? leanMass.toFixed(1) : '—'}
          unit={t('units.kg')}
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
          borderTopColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Icon name="calendar" size={13} color={colors.mute} />
        <MonoLabel>
          {t('summary.lastAssessmentLabel', { date: lastDateLabel }).toUpperCase()}
        </MonoLabel>
      </View>
    </LinearGradient>
  );
}
