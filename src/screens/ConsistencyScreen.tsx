import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

type Status = 'done' | 'today' | 'missed' | 'pending' | 'rest' | 'restFuture';

const MONTH = 'JULHO';
const YEAR = 2026;
const DAYS = 31;
const FIRST_WD = 2; // 0=Dom … mês começa numa terça
const TODAY = 16;
const MISSED = [9];

function isTraining(d: number) {
  const wd = (FIRST_WD + d - 1) % 7;
  return [1, 2, 4, 5, 6].includes(wd); // Seg, Ter, Qui, Sex, Sáb
}

function statusOf(d: number): Status {
  if (d === TODAY) return 'today';
  if (d < TODAY) return isTraining(d) ? (MISSED.includes(d) ? 'missed' : 'done') : 'rest';
  return isTraining(d) ? 'pending' : 'restFuture';
}

type CellStyle = {
  background: string | { colors: readonly [string, string] };
  border: string;
  color: string;
};

function cellStyleFor(s: Status): CellStyle {
  switch (s) {
    case 'done':
      return {
        background: 'rgba(11,112,249,0.28)',
        border: 'rgba(11,112,249,0.5)',
        color: '#fff',
      };
    case 'today':
      return {
        background: { colors: ['#1f82ff', '#0b70f9'] as const },
        border: '#7db4ff',
        color: '#fff',
      };
    case 'missed':
      return {
        background: 'rgba(255,80,80,0.1)',
        border: 'rgba(255,90,90,0.4)',
        color: '#ff9a9a',
      };
    case 'pending':
      return {
        background: 'rgba(255,255,255,0.03)',
        border: 'rgba(11,112,249,0.55)',
        color: '#7db4ff',
      };
    case 'rest':
      return { background: 'transparent', border: 'transparent', color: 'rgba(255,255,255,0.28)' };
    default:
      return { background: 'transparent', border: 'transparent', color: 'rgba(255,255,255,0.35)' };
  }
}

function DayCell({ d }: { d: number }) {
  const s = statusOf(d);
  const cs = cellStyleFor(s);
  const dashed = s === 'pending';
  const isGradient = typeof cs.background !== 'string';

  const inner = (
    <>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 13,
          color: cs.color,
        }}
      >
        {d}
      </Text>
      {s === 'done' && (
        <View
          style={{
            position: 'absolute',
            bottom: 3,
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#7db4ff',
          }}
        />
      )}
    </>
  );

  const commonWrap = {
    aspectRatio: 1 as const,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    position: 'relative' as const,
    borderWidth: cs.border === 'transparent' ? 0 : 1,
    borderColor: cs.border,
    borderStyle: (dashed ? 'dashed' : 'solid') as 'dashed' | 'solid',
  };

  if (isGradient) {
    const grad = (cs.background as { colors: readonly [string, string] }).colors;
    return (
      <LinearGradient
        colors={grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          commonWrap,
          {
            shadowColor: colors.accent,
            shadowOpacity: 0.7,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          },
        ]}
      >
        {inner}
      </LinearGradient>
    );
  }

  return (
    <View style={[commonWrap, { backgroundColor: cs.background as string }]}>{inner}</View>
  );
}

function LegendChip({ status, label }: { status: Status; label: string }) {
  const cs = cellStyleFor(status);
  const isGradient = typeof cs.background !== 'string';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      {isGradient ? (
        <LinearGradient
          colors={(cs.background as { colors: readonly [string, string] }).colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            borderWidth: cs.border === 'transparent' ? 0 : 1,
            borderColor: cs.border,
          }}
        />
      ) : (
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            backgroundColor: cs.background as string,
            borderWidth: cs.border === 'transparent' ? 0 : 1,
            borderColor: cs.border,
            borderStyle: status === 'pending' ? 'dashed' : 'solid',
          }}
        />
      )}
      <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.mute }}>{label}</Text>
    </View>
  );
}

export function ConsistencyScreen({ onBack }: { onBack: () => void }) {
  const daysLeft = DAYS - TODAY;
  let doneCount = 0;
  let pendingCount = 0;
  for (let d = 1; d <= DAYS; d++) {
    const s = statusOf(d);
    if (s === 'done') doneCount++;
    if (s === 'pending') pendingCount++;
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < FIRST_WD; i++) cells.push(null);
  for (let d = 1; d <= DAYS; d++) cells.push(d);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingBottom: 8,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            onPress={onBack}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>CONSISTÊNCIA MENSAL</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <Display size={34}>
            {MONTH} {YEAR}
          </Display>

          <LinearGradient
            colors={['rgba(11,112,249,0.22)', 'rgba(11,112,249,0.04)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginTop: 16,
              padding: 18,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: 'rgba(11,112,249,0.4)',
            }}
          >
            <MonoLabel>FALTA PARA FECHAR O MÊS</MonoLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 20,
                marginTop: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 46,
                    color: '#fff',
                    lineHeight: 46,
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {daysLeft}
                </Text>
                <MonoLabel>DIAS</MonoLabel>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 6,
                  paddingBottom: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 30,
                    color: '#7db4ff',
                    lineHeight: 30,
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {pendingCount}
                </Text>
                <MonoLabel>TREINOS</MonoLabel>
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <SegBar value={TODAY / DAYS} segs={DAYS} />
            </View>
            <MonoLabel style={{ marginTop: 8 }}>
              DIA {TODAY} DE {DAYS} · {doneCount} TREINOS FEITOS
            </MonoLabel>
          </LinearGradient>

          <Card style={{ marginTop: 14, padding: 16 }}>
            <View
              style={{
                flexDirection: 'row',
                marginBottom: 8,
              }}
            >
              {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 9,
                      color: colors.faint,
                      letterSpacing: 1,
                    }}
                  >
                    {w}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, i) => (
                <View key={i} style={{ width: `${100 / 7}%`, padding: 3 }}>
                  {d === null ? <View style={{ aspectRatio: 1 }} /> : <DayCell d={d} />}
                </View>
              ))}
            </View>
          </Card>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 14,
              marginTop: 16,
              paddingHorizontal: 4,
            }}
          >
            <LegendChip status="done" label="Treino feito" />
            <LegendChip status="today" label="Hoje" />
            <LegendChip status="pending" label="A fazer" />
            <LegendChip status="missed" label="Perdido" />
            <LegendChip status="rest" label="Descanso" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
