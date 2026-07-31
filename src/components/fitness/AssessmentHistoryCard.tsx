import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { colors, fonts } from '../../theme/tokens';

export type AssessmentHistoryRow = {
  id: string;
  date: string;
  weight: number;
  /** null when the assessment has no body-fat estimate (e.g. an imported record without it). */
  bodyFat: number | null;
  bmi: number | null;
  leanMass: number | null;
  fatMass: number | null;
  source: 'guided' | 'imported';
  protocolLabel?: string;
};

function MiniStat({ l, v, u }: { l: string; v: string; u: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 15,
            color: '#fff',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {v}
        </Text>
        {u ? (
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.faint, marginLeft: 1 }}>
            {u}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 8,
          color: colors.faint,
          letterSpacing: 0.5,
          marginTop: 3,
        }}
      >
        {l}
      </Text>
    </View>
  );
}

function HistoryRow({
  entry,
  highlight,
  expanded,
  onToggle,
}: {
  entry: AssessmentHistoryRow;
  highlight: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chevronRot = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronRot, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded, chevronRot]);

  return (
    <View style={{ position: 'relative', paddingLeft: 34, marginBottom: 12 }}>
      <View
        style={{
          position: 'absolute',
          left: 8,
          top: 18,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: highlight ? colors.accent : 'rgba(255,255,255,0.12)',
          borderWidth: 2,
          borderColor: highlight ? colors.accentHi : 'rgba(255,255,255,0.2)',
          shadowColor: highlight ? colors.accent : 'transparent',
          shadowOpacity: highlight ? 0.7 : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
          elevation: highlight ? 4 : 0,
        }}
      />
      <Card style={{ padding: 15 }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MonoLabel color={highlight ? colors.accentHi : colors.faint}>{entry.date}</MonoLabel>
            {entry.source === 'imported' && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 5,
                  backgroundColor: 'rgba(255,255,255,0.07)',
                }}
              >
                <MonoLabel size={8}>IMPORTADO</MonoLabel>
              </View>
            )}
          </View>
          <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1,
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              VER DETALHES
            </Text>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: chevronRot.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '90deg'],
                    }),
                  },
                ],
              }}
            >
              <Icon name="chevron-right" size={12} color="rgba(255,255,255,0.6)" />
            </Animated.View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <MiniStat l="PESO" v={entry.weight.toFixed(1)} u="kg" />
          <MiniStat l="IMC" v={entry.bmi != null ? entry.bmi.toFixed(1) : '—'} u="" />
          <MiniStat l="% GORDURA" v={entry.bodyFat != null ? entry.bodyFat.toFixed(1) : '—'} u="%" />
        </View>
        {expanded && (
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.mute, lineHeight: 20 }}>
              {entry.leanMass != null && entry.fatMass != null
                ? `Massa magra estimada ${entry.leanMass.toFixed(1)}kg · massa gorda ${entry.fatMass.toFixed(1)}kg`
                : 'Massa magra e massa gorda indisponíveis — esta avaliação não possui percentual de gordura'}
              {entry.protocolLabel ? ` · protocolo ${entry.protocolLabel}` : ''}
              {entry.source === 'imported' ? ' · registrado a partir de avaliação profissional' : ''}.
            </Text>
          </View>
        )}
      </Card>
    </View>
  );
}

export function AssessmentHistoryCard({
  entries,
  expandedId,
  onToggle,
}: {
  entries: AssessmentHistoryRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <View style={{ position: 'relative', paddingLeft: 4 }}>
      <View
        style={{
          position: 'absolute',
          left: 15,
          top: 6,
          bottom: 6,
          width: 1.5,
          backgroundColor: 'rgba(11,112,249,0.25)',
        }}
      />
      {entries.map((e, i) => (
        <HistoryRow
          key={e.id}
          entry={e}
          highlight={i === 0}
          expanded={expandedId === e.id}
          onToggle={() => onToggle(e.id)}
        />
      ))}
    </View>
  );
}
