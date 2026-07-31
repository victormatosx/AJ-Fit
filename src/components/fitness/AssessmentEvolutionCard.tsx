import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, fonts } from '../../theme/tokens';
import { EvolutionLineChart, type EvolutionPoint } from './EvolutionLineChart';

// Fixed categorical slots — weight and body fat live on incomparable scales
// (kg vs %), so they're two single-series charts, never one dual-axis chart.
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
  if (value == null) {
    return (
      <View style={{ flex: 1, alignItems: 'center' }}>
        <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.faint }}>—</Text>
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
          fontFamily: fonts.uiBold,
          fontSize: 15,
          color: positive ? '#22c55e' : '#f0563f',
        }}
      >
        {sign}
        {value.toFixed(1)}
        {unit}
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
  return (
    <Card style={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 18, marginBottom: 16 }}>
        <EvolutionLineChart
          label="PESO"
          unit="kg"
          color={WEIGHT_COLOR}
          points={weightPoints}
          emptyHint="Registre 2+ avaliações para ver o gráfico."
        />
        <EvolutionLineChart
          label="% GORDURA"
          unit="%"
          color={BODY_FAT_COLOR}
          points={bodyFatPoints}
          emptyHint="Sem avaliações com % de gordura suficientes."
        />
      </View>

      {hasPrevious ? (
        <View style={{ flexDirection: 'row' }}>
          <DeltaChip label="PESO" value={weightDelta} unit="kg" goodWhenNegative />
          <DeltaChip label="% GORDURA" value={bodyFatDelta} unit="%" goodWhenNegative />
          <DeltaChip label="MASSA MAGRA" value={leanMassDelta} unit="kg" />
        </View>
      ) : (
        <Text
          style={{
            fontFamily: fonts.ui,
            fontSize: 12.5,
            color: colors.mute,
            textAlign: 'center',
          }}
        >
          Registre uma nova avaliação para começar a acompanhar sua evolução.
        </Text>
      )}

      <Pressable
        onPress={onViewHistory}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 14,
          paddingTop: 14,
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
          VER HISTÓRICO COMPLETO
        </Text>
        <Icon name="chevron-right" size={12} color={colors.accentHi} />
      </Pressable>
    </Card>
  );
}
