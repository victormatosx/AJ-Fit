import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLG, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { AJMark } from '../components/ui/AJMark';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { HudCorners } from '../components/ui/Card';
import { colors, fonts } from '../theme/tokens';

const LOG_LINES = [
  { t: 'perfil biomecânico lido', d: 'idade · altura · peso' },
  { t: 'volume semanal calibrado', d: 'nível × frequência' },
  { t: 'padrões de movimento definidos', d: 'compostos + acessórios' },
  { t: 'split otimizado p/ recuperação', d: 'push · pull · legs · upper' },
  { t: 'cargas iniciais estimadas', d: 'progressão linear 12 sem' },
  { t: 'plano AJ compilado', d: 'pronto para execução' },
];

export function AnalyzingScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(id);
          return 100;
        }
        return p + 1;
      });
    }, 52);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      const t = setTimeout(onDone, 700);
      return () => clearTimeout(t);
    }
  }, [progress]);

  const visible = Math.floor((progress / 100) * LOG_LINES.length);

  const R = 76;
  const STROKE = 9;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - progress / 100);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36 }}>
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <AJMark size={52} glow={false} />
          </View>

          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <View style={{ width: 184, height: 184 }}>
              <Svg
                width={184}
                height={184}
                viewBox="0 0 184 184"
                style={{ transform: [{ rotate: '-90deg' }] }}
              >
                <Defs>
                  <SvgLG id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={colors.accentHi} />
                    <Stop offset="100%" stopColor={colors.accent} />
                  </SvgLG>
                </Defs>
                <Circle
                  cx="92"
                  cy="92"
                  r={R}
                  fill="none"
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth={STROKE}
                />
                <Circle
                  cx="92"
                  cy="92"
                  r={R}
                  fill="none"
                  stroke="url(#ringGrad)"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${C}`}
                  strokeDashoffset={offset}
                />
              </Svg>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 52,
                    color: '#fff',
                    transform: [{ skewX: '-8deg' }],
                    textShadowColor: 'rgba(11,112,249,0.6)',
                    textShadowRadius: 15,
                    textShadowOffset: { width: 0, height: 0 },
                  }}
                >
                  {progress}
                  <Text style={{ fontSize: 22, color: colors.accentHi }}>%</Text>
                </Text>
                <MonoLabel style={{ marginTop: 6 }}>COMPILANDO</MonoLabel>
              </View>
            </View>
          </View>

          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <Display size={32}>MONTANDO</Display>
            <Display size={32}>SEU PLANO</Display>
          </View>

          <View
            style={{
              flex: 1,
              borderRadius: 14,
              padding: 16,
              backgroundColor: '#05031e',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
            }}
          >
            <HudCorners />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(255,255,255,0.07)',
                marginBottom: 12,
              }}
            >
              <MonoLabel>AJ.ENGINE v2.0</MonoLabel>
              <MonoLabel color={colors.accentHi}>RUNNING</MonoLabel>
            </View>
            {LOG_LINES.map((l, i) => {
              const done = i < visible;
              const active = i === visible;
              if (!done && !active) {
                return (
                  <Text
                    key={i}
                    style={{
                      paddingVertical: 7,
                      fontFamily: fonts.mono,
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.18)',
                    }}
                  >
                    · aguardando…
                  </Text>
                );
              }
              return (
                <View
                  key={i}
                  style={{
                    paddingVertical: 7,
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    gap: 10,
                  }}
                >
                  <Text
                    style={{
                      color: done ? colors.accentHi : '#fff',
                      fontFamily: fonts.mono,
                      fontSize: 12,
                      minWidth: 14,
                    }}
                  >
                    {done ? '✓' : '▌'}
                  </Text>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: '#fff' }}>{l.t}</Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: colors.faint }}>
                      {l.d}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
