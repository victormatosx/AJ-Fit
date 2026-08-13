import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, Animated, Easing, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLG,
  Path,
  Stop,
} from 'react-native-svg';
import { Slash, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts, displayLineHeight } from '../theme/tokens';
import { useAppState } from '../state/AppState';
import { useUnits } from '../state/UnitsContext';
import { formatWeightFromKg, weightUnit } from '../units/weightConversions';

const GOAL_LABELS: Record<string, string> = {
  hyper: 'HIPERTROFIA',
  cut: 'EMAGRECIMENTO',
  perf: 'PERFORMANCE',
  def: 'DEFINIÇÃO',
  recon: 'RECONDICIONAMENTO',
};
const LEVEL_LABELS: Record<string, string> = {
  beg: 'INICIANTE',
  int: 'INTERMEDIÁRIO',
  adv: 'AVANÇADO',
  elite: 'ELITE',
};
const PROGRAM_NAMES: Record<string, string> = {
  hyper: 'AJ HYPER',
  cut: 'AJ SHRED',
  perf: 'AJ POWER',
  def: 'AJ SHAPE',
  recon: 'AJ RESET',
};

const SPLIT = ['PUSH', 'PULL', 'LEGS', 'OFF', 'UPPER', 'LOWER', 'OFF'] as const;
const DAY_LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] as const;

// Capitalize first letter, rest lowercase — matches the mock's subtitle format.
const cap = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

export function PlanReadyScreen({ onContinue }: { onContinue: () => void }) {
  const { quiz } = useAppState();
  const { resolvedUnits } = useUnits();
  const goalKey = quiz.goal || 'hyper';
  const levelKey = quiz.level || 'int';
  const days = quiz.days || 4;

  const programName = PROGRAM_NAMES[goalKey] || 'AJ HYPER';
  const goalLabel = GOAL_LABELS[goalKey] || 'HIPERTROFIA';
  const levelLabel = LEVEL_LABELS[levelKey] || 'INTERMEDIÁRIO';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 26,
            paddingTop: 40,
            paddingBottom: 30,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. HEADER ── */}
          <RiseIn delay={0}>
            <Slash style={{ marginBottom: 14 }}>SEU PLANO ESTÁ PRONTO</Slash>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 44,
                lineHeight: displayLineHeight(44),
                letterSpacing: 0.5,
                color: '#fff',
                textTransform: 'uppercase',
                transform: [{ skewX: '-8deg' }],
              }}
            >
              {programName}
            </Text>
            <Text
              style={{
                marginTop: 12,
                fontFamily: fonts.ui,
                fontSize: 14.5,
                lineHeight: 21,
                color: colors.mute,
              }}
            >
              {cap(goalLabel)} · {cap(levelLabel)} · {days}x por semana
            </Text>
          </RiseIn>

          {/* ── 2. WEEKLY SPLIT ── */}
          <RiseIn delay={80} style={{ marginTop: 30 }}>
            <Slash style={{ marginBottom: 14 }}>DIVISÃO SEMANAL</Slash>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {SPLIT.map((s, i) => {
                const on = s !== 'OFF';
                return (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      paddingHorizontal: 2,
                      alignItems: 'center',
                      borderRadius: 10,
                      backgroundColor: on ? 'rgba(11,112,249,0.14)' : 'transparent',
                      borderWidth: 1,
                      borderColor: on ? 'rgba(11,112,249,0.4)' : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.mono,
                        fontSize: 8.5,
                        letterSpacing: 1,
                        color: colors.faint,
                      }}
                    >
                      {DAY_LETTERS[i]}
                    </Text>
                    <Text
                      style={{
                        marginTop: 5,
                        fontFamily: fonts.display,
                        fontSize: 11,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: on ? colors.accentHi : 'rgba(255,255,255,0.25)',
                        transform: [{ skewX: '-8deg' }],
                      }}
                    >
                      {on ? s : '·'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </RiseIn>

          {/* ── 3. PROJECTION LINE CHART ── */}
          <RiseIn delay={160} style={{ marginTop: 30 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <Slash>PROJEÇÃO · 12 SEMANAS</Slash>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 30,
                    color: colors.accentHi,
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  +{formatWeightFromKg(6.2, resolvedUnits).replace('.', ',')}
                </Text>
                <MonoLabel>{weightUnit(resolvedUnits).toUpperCase()} MAGRA</MonoLabel>
              </View>
            </View>
            <ProjectionChart />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginTop: 8,
              }}
            >
              <MonoLabel>SEM 01</MonoLabel>
              <MonoLabel>SEM 12</MonoLabel>
            </View>
          </RiseIn>

          <View style={{ flex: 1, minHeight: 20 }} />

          {/* ── 4. KEY METRICS ── */}
          <RiseIn delay={200} style={{ marginTop: 30 }}>
            <View
              style={{
                flexDirection: 'row',
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }}
            >
              {[
                { v: String(days), l: 'DIAS/SEM' },
                { v: '12', l: 'SEMANAS' },
                { v: '48', l: 'TREINOS' },
              ].map((s, i) => (
                <View
                  key={s.l}
                  style={{
                    flex: 1,
                    paddingVertical: 18,
                    paddingHorizontal: 4,
                    alignItems: 'center',
                    borderLeftWidth: i ? 1 : 0,
                    borderLeftColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 30,
                      color: '#fff',
                      transform: [{ skewX: '-8deg' }],
                    }}
                  >
                    {s.v}
                  </Text>
                  <MonoLabel style={{ marginTop: 6 }}>{s.l}</MonoLabel>
                </View>
              ))}
            </View>
          </RiseIn>

          {/* ── 5. STRONG CTA ── */}
          <RiseIn delay={280} style={{ marginTop: 24 }}>
            <Pressable
              onPress={onContinue}
              style={{
                position: 'relative',
                width: '100%',
                overflow: 'hidden',
                paddingVertical: 20,
                paddingHorizontal: 22,
                borderRadius: 16,
                backgroundColor: colors.accent,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                shadowColor: colors.accent,
                shadowOpacity: 0.55,
                shadowRadius: 44,
                shadowOffset: { width: 0, height: 14 },
                elevation: 16,
              }}
            >
              {/* Inset top highlight — mirrors inset 0 1px 0 rgba(255,255,255,0.4) */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: 'rgba(255,255,255,0.4)',
                }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 24,
                    letterSpacing: 1,
                    color: '#fff',
                    textTransform: 'uppercase',
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  CRIAR MINHA CONTA
                </Text>
                <Text
                  style={{
                    marginTop: 5,
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    letterSpacing: 1,
                    color: 'rgba(255,255,255,0.85)',
                  }}
                >
                  CONTINUAR
                </Text>
              </View>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.35)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="arrow-right" size={20} color="#fff" stroke={2.2} />
              </View>
            </Pressable>
            <MonoLabel style={{ textAlign: 'center', marginTop: 14 }}>
              VEJA AS OPÇÕES DISPONÍVEIS NA PRÓXIMA ETAPA
            </MonoLabel>
          </RiseIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Line chart mirroring the SVG in the mock ─────────────────
function ProjectionChart() {
  const W = 300;
  const H = 96;
  const PAD = 6;
  const pts = [0, 0.8, 1.7, 2.4, 3.3, 4.1, 4.7, 5.4, 6.2];
  const maxV = 6.2;
  const coords = pts.map((v, i) => {
    const x = PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - (v / maxV) * (H - 2 * PAD);
    return [x, y] as const;
  });
  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
    .join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `${line} L ${last[0].toFixed(1)} ${H} L ${first[0].toFixed(1)} ${H} Z`;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <SvgLG id="planFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colors.accent} stopOpacity="0.32" />
          <Stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
        </SvgLG>
        <SvgLG id="planLine" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor={colors.accent} />
          <Stop offset="100%" stopColor={colors.accentHi} />
        </SvgLG>
      </Defs>
      <Path d={area} fill="url(#planFill)" />
      {/* Fake drop-shadow: wider low-opacity twin underneath the line */}
      <Path
        d={line}
        fill="none"
        stroke={colors.accent}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.45}
      />
      <Path
        d={line}
        fill="none"
        stroke="url(#planLine)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={last[0]}
        cy={last[1]}
        r={4.5}
        fill="#fff"
        stroke={colors.accent}
        strokeWidth={2.5}
      />
    </Svg>
  );
}

// ── Cascading rise-in wrapper ──────────────────────────────
function RiseIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 600,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, delay]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return (
    <Animated.View style={[style, { opacity: anim, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
