import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Svg, { Path, Line, Defs, LinearGradient as SvgLG, Stop, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

type ProgressView = 'chart' | 'weight' | 'photos';

export function ProgressScreen() {
  const [view, setView] = useState<ProgressView>('chart');

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 }}>
            <Slash style={{ marginBottom: 10 }}>EVOLUÇÃO · ÚLTIMOS 90 DIAS</Slash>
            <Display size={34}>+12% MAIS</Display>
            <Display size={34}>FORTE.</Display>
          </View>

          <View style={{ paddingHorizontal: 22, paddingBottom: 16, flexDirection: 'row', gap: 8 }}>
            {(
              [
                ['chart', 'CARGAS'],
                ['weight', 'PESO'],
                ['photos', 'FOTOS'],
              ] as const
            ).map(([k, l]) => {
              const sel = view === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setView(k)}
                  style={{
                    paddingVertical: 9,
                    paddingHorizontal: 16,
                    borderRadius: 9,
                    backgroundColor: sel ? colors.accent : 'rgba(255,255,255,0.04)',
                    borderWidth: 1,
                    borderColor: sel ? colors.accentHi : 'rgba(255,255,255,0.07)',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      color: sel ? '#fff' : colors.mute,
                    }}
                  >
                    {l}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {view === 'chart' && <LoadChart />}
          {view === 'weight' && <WeightChart />}
          {view === 'photos' && <ProgressPhotos />}

          {/* heatmap */}
          <View style={{ paddingHorizontal: 22, paddingTop: 16 }}>
            <Card style={{ padding: 18 }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}
              >
                <Slash>CALENDÁRIO DE CONSISTÊNCIA</Slash>
                <MonoLabel color={colors.accentHi}>92%</MonoLabel>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {Array.from({ length: 42 }).map((_, i) => {
                  const lvl =
                    [
                      3, 2, 3, 0, 3, 3, 1, 3, 3, 0, 3, 2, 3, 1, 3, 0, 3, 3, 3, 0, 2, 3, 3, 3, 0, 3,
                      3, 1, 0, 3, 2, 3, 3, 0, 3, 3, 3, 0, 3, 3, 3, 2,
                    ][i] ?? 0;
                  const bg =
                    lvl === 0
                      ? 'rgba(255,255,255,0.05)'
                      : lvl === 1
                        ? 'rgba(11,112,249,0.25)'
                        : lvl === 2
                          ? 'rgba(11,112,249,0.55)'
                          : colors.accent;
                  return (
                    <View
                      key={i}
                      style={{
                        width: `${100 / 14 - 1}%`,
                        aspectRatio: 1,
                        borderRadius: 3,
                        backgroundColor: bg,
                      }}
                    />
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <MonoLabel>6 SEMANAS</MonoLabel>
                <MonoLabel>HOJE</MonoLabel>
              </View>
            </Card>
          </View>

          {/* PRs */}
          <View style={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18 }}>
            <Slash style={{ marginBottom: 12 }}>RECORDES RECENTES</Slash>
            {[
              { e: 'Supino Reto', v: '82.5 KG', d: 'há 3 dias', up: '+5kg' },
              { e: 'Agachamento', v: '110 KG', d: 'há 1 semana', up: '+7.5kg' },
              { e: 'Levantamento Terra', v: '140 KG', d: 'há 2 semanas', up: '+10kg' },
            ].map((r, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  marginBottom: 8,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.06)',
                }}
              >
                <Icon name="trophy" size={18} color={colors.accentHi} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>{r.e}</Text>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 9.5,
                      color: colors.faint,
                      letterSpacing: 1,
                      marginTop: 2,
                    }}
                  >
                    {r.d.toUpperCase()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 17,
                      color: '#fff',
                      textTransform: 'uppercase',
                    }}
                  >
                    {r.v}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      color: colors.accentHi,
                    }}
                  >
                    {r.up}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}

function chartPath(pts: number[], min: number, max: number, w: number, h: number, pad: number) {
  return pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - min) / (max - min)) * (h - 2 * pad);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function ChartFrame({
  label,
  big,
  unit,
  delta,
  children,
}: {
  label: string;
  big: string;
  unit: string;
  delta: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: 22 }}>
      <Card style={{ padding: 18 }}>
        <HudCorners />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 12,
          }}
        >
          <View>
            <MonoLabel>{label}</MonoLabel>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: 34,
                  color: '#fff',
                  transform: [{ skewX: '-8deg' }],
                  textTransform: 'uppercase',
                }}
              >
                {big}
              </Text>
              <MonoLabel>{unit}</MonoLabel>
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  color: colors.accentHi,
                  marginLeft: 6,
                }}
              >
                {delta}
              </Text>
            </View>
          </View>
          <MonoLabel>12 SEM</MonoLabel>
        </View>
        {children}
      </Card>
    </View>
  );
}

function LoadChart() {
  const pts = [40, 45, 42, 50, 55, 53, 60, 65, 63, 70, 75, 82];
  const w = 320,
    h = 160,
    pad = 18;
  const path = chartPath(pts, 30, 90, w, h, pad);
  return (
    <ChartFrame label="SUPINO RETO · CARGA MÁX" big="82.5" unit="KG" delta="↑ +25KG">
      <Svg width="100%" height={160} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <SvgLG id="lcFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.accentHi} stopOpacity="0.35" />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </SvgLG>
        </Defs>
        {[0, 1, 2, 3].map((i) => (
          <Line
            key={i}
            x1={pad}
            x2={w - pad}
            y1={pad + (i * (h - 2 * pad)) / 3}
            y2={pad + (i * (h - 2 * pad)) / 3}
            stroke="rgba(255,255,255,0.05)"
          />
        ))}
        <Path d={`${path} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`} fill="url(#lcFill)" />
        <Path d={path} stroke={colors.accentHi} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Circle
          cx={w - pad}
          cy={pad + (1 - (82 - 30) / 60) * (h - 2 * pad)}
          r="5"
          fill="#fff"
          stroke={colors.accent}
          strokeWidth={3}
        />
      </Svg>
    </ChartFrame>
  );
}

function WeightChart() {
  const pts = [82, 81.6, 81.2, 80.8, 80.3, 79.9, 79.5, 79.0, 78.6, 78.2, 78.0, 77.6];
  const w = 320,
    h = 160,
    pad = 18;
  const path = chartPath(pts, 77, 83, w, h, pad);
  return (
    <ChartFrame label="PESO CORPORAL" big="77.6" unit="KG" delta="↓ -4.4KG">
      <Svg width="100%" height={160} viewBox={`0 0 ${w} ${h}`}>
        <Path d={path} stroke={colors.accentHi} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Circle
          cx={w - pad}
          cy={pad + (1 - (77.6 - 77) / 6) * (h - 2 * pad)}
          r="5"
          fill="#fff"
          stroke={colors.accent}
          strokeWidth={3}
        />
      </Svg>
    </ChartFrame>
  );
}

function ProgressPhotos() {
  return (
    <View style={{ paddingHorizontal: 22 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {['SEM 01', 'SEM 04', 'SEM 08', 'SEM 12'].map((l, i) => (
          <View
            key={i}
            style={{
              width: '47%',
              height: 190,
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <HudCorners />
            <Icon name="camera" size={28} color="rgba(255,255,255,0.2)" />
            <View
              style={{
                position: 'absolute',
                top: 12,
                left: 14,
                backgroundColor: 'rgba(2,0,16,0.7)',
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 5,
              }}
            >
              <MonoLabel color="#fff">{l}</MonoLabel>
            </View>
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 12,
        }}
      >
        <Icon name="camera" size={11} color={colors.faint} />
        <MonoLabel>ARRASTE SUAS FOTOS DE PROGRESSO PARA OS QUADROS</MonoLabel>
      </View>
    </View>
  );
}
