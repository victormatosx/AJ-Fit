import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Svg, { Path, Line, Defs, LinearGradient as SvgLG, Stop, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';
import { useUnits } from '../state/UnitsContext';
import {
  formatWeightFromKg,
  weightFromKg,
  weightUnit,
} from '../units/weightConversions';
import {
  formatWorkoutLoadFromKg,
  workoutLoadUnit,
} from '../units/workoutLoadConversions';

type ProgressView = 'chart' | 'weight' | 'photos';

export function ProgressScreen() {
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const [view, setView] = useState<ProgressView>('chart');
  const tabs: Array<[ProgressView, string]> = [
    ['chart', t('progress.tabs.loads')],
    ['weight', t('progress.tabs.weight')],
    ['photos', t('progress.tabs.photos')],
  ];
  const loadUnit = workoutLoadUnit(resolvedUnits);
  const records = [
    {
      exercise: t('progress.records.benchPress'),
      value: t('progress.records.value', {
        value: formatWorkoutLoadFromKg(82.5, resolvedUnits),
        unit: loadUnit,
      }),
      date: t('progress.records.daysAgo', { count: 3 }),
      gain: t('progress.records.gain', {
        value: formatWorkoutLoadFromKg(5, resolvedUnits),
        unit: loadUnit,
      }),
    },
    {
      exercise: t('progress.records.squat'),
      value: t('progress.records.value', {
        value: formatWorkoutLoadFromKg(110, resolvedUnits),
        unit: loadUnit,
      }),
      date: t('progress.records.weekAgo', { count: 1 }),
      gain: t('progress.records.gain', {
        value: formatWorkoutLoadFromKg(7.5, resolvedUnits),
        unit: loadUnit,
      }),
    },
    {
      exercise: t('progress.records.deadlift'),
      value: t('progress.records.value', {
        value: formatWorkoutLoadFromKg(140, resolvedUnits),
        unit: loadUnit,
      }),
      date: t('progress.records.weekAgo', { count: 2 }),
      gain: t('progress.records.gain', {
        value: formatWorkoutLoadFromKg(10, resolvedUnits),
        unit: loadUnit,
      }),
    },
  ];

  const pageHeader = (
    <>
      <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 }}>
        <Slash style={{ marginBottom: 10 }}>{t('progress.header.period').toUpperCase()}</Slash>
        <Display size={34}>{t('progress.header.highlightLine1').toUpperCase()}</Display>
        <Display size={34}>{t('progress.header.highlightLine2').toUpperCase()}</Display>
      </View>

      <View style={{ paddingHorizontal: 22, paddingBottom: 16, flexDirection: 'row', gap: 8 }}>
        {tabs.map(([k, l]) => {
          const sel = view === k;
          return (
            <Pressable
              key={k}
              onPress={() => setView(k)}
              accessibilityRole="tab"
              accessibilityLabel={t('progress.accessibility.selectTab', { tab: l })}
              accessibilityState={{ selected: sel }}
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
    </>
  );

  const pageFooter = (
    <>
      {/* heatmap */}
      <View style={{ paddingHorizontal: 22, paddingTop: 16 }}>
        <Card style={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Slash>{t('progress.heatmap.title').toUpperCase()}</Slash>
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
            <MonoLabel>{t('progress.heatmap.period').toUpperCase()}</MonoLabel>
            <MonoLabel>{t('progress.heatmap.today').toUpperCase()}</MonoLabel>
          </View>
        </Card>
      </View>

      {/* PRs */}
      <View style={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18 }}>
        <Slash style={{ marginBottom: 12 }}>{t('progress.records.title').toUpperCase()}</Slash>
        {records.map((record, i) => (
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
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                {record.exercise}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 9.5,
                  color: colors.faint,
                  letterSpacing: 1,
                  marginTop: 2,
                }}
              >
                {record.date.toUpperCase()}
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
                {record.value}
              </Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.accentHi }}>
                {record.gain}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {view === 'photos' ? (
          <ProgressPhotosScreen pageHeader={pageHeader} pageFooter={pageFooter} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {pageHeader}
            {view === 'chart' && <LoadChart />}
            {view === 'weight' && <WeightChart />}
            {pageFooter}
          </ScrollView>
        )}
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
  const { t } = useTranslation('home');
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
          <MonoLabel>{t('progress.charts.period').toUpperCase()}</MonoLabel>
        </View>
        {children}
      </Card>
    </View>
  );
}

function LoadChart() {
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const pointsKg = [40, 45, 42, 50, 55, 53, 60, 65, 63, 70, 75, 82];
  const pts = pointsKg.map((value) => weightFromKg(value, resolvedUnits));
  const min = weightFromKg(30, resolvedUnits);
  const max = weightFromKg(90, resolvedUnits);
  const unit = workoutLoadUnit(resolvedUnits);
  const w = 320,
    h = 160,
    pad = 18;
  const path = chartPath(pts, min, max, w, h, pad);
  return (
    <ChartFrame
      label={t('progress.charts.loadTitle').toUpperCase()}
      big={formatWorkoutLoadFromKg(82.5, resolvedUnits)}
      unit={unit.toUpperCase()}
      delta={t('progress.charts.delta', {
        direction: '↑',
        value: `+${formatWorkoutLoadFromKg(25, resolvedUnits)}`,
        unit,
      })}
    >
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
          cy={pad + (1 - (pts[pts.length - 1] - min) / (max - min)) * (h - 2 * pad)}
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
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const pointsKg = [82, 81.6, 81.2, 80.8, 80.3, 79.9, 79.5, 79.0, 78.6, 78.2, 78.0, 77.6];
  const pts = pointsKg.map((value) => weightFromKg(value, resolvedUnits));
  const w = 320,
    h = 160,
    pad = 18;
  const min = weightFromKg(77, resolvedUnits);
  const max = weightFromKg(83, resolvedUnits);
  const latest = pts[pts.length - 1];
  const unit = weightUnit(resolvedUnits);
  const path = chartPath(pts, min, max, w, h, pad);
  return (
    <ChartFrame
      label={t('progress.charts.weightTitle').toUpperCase()}
      big={formatWeightFromKg(77.6, resolvedUnits)}
      unit={unit.toUpperCase()}
      delta={t('progress.charts.delta', {
        direction: '↓',
        value: formatWeightFromKg(-4.4, resolvedUnits),
        unit,
      })}
    >
      <Svg width="100%" height={160} viewBox={`0 0 ${w} ${h}`}>
        <Path d={path} stroke={colors.accentHi} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Circle
          cx={w - pad}
          cy={pad + (1 - (latest - min) / (max - min)) * (h - 2 * pad)}
          r="5"
          fill="#fff"
          stroke={colors.accent}
          strokeWidth={3}
        />
      </Svg>
    </ChartFrame>
  );
}
