import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { AJMark } from '../components/ui/AJMark';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';
import { useAppState } from '../state/AppState';

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

export function PlanReadyScreen({ onContinue }: { onContinue: () => void }) {
  const { quiz } = useAppState();
  const goalLabel = GOAL_LABELS[quiz.goal || ''] || 'HIPERTROFIA';
  const levelLabel = LEVEL_LABELS[quiz.level || ''] || 'INTERMEDIÁRIO';
  const days = quiz.days || 4;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 30 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <Slash style={{ marginBottom: 12 }}>PLANO COMPILADO</Slash>
            <Display size={40}>SEU PLANO</Display>
            <Display size={40}>ESTÁ PRONTO.</Display>
          </View>

          {/* Athlete card */}
          <LinearGradient
            colors={['#081240', '#04021c']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(11,112,249,0.35)',
              shadowColor: colors.accent,
              shadowOpacity: 0.2,
              shadowRadius: 20,
            }}
          >
            <HudCorners />
            <OutlineNumber
              size={190}
              style={{
                position: 'absolute',
                bottom: -50,
                right: -16,
                opacity: 0.45,
              }}
            >
              AJ
            </OutlineNumber>

            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View>
                  <MonoLabel>FICHA AJ · Nº 0001</MonoLabel>
                  <Display size={26} style={{ marginTop: 8 }}>
                    PROGRAMA
                  </Display>
                  <Display size={26}>{goalLabel}</Display>
                </View>
                <AJMark size={42} glow={false} />
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginVertical: 20 }}>
                {[
                  { l: 'DIAS/SEM', v: String(days) },
                  { l: 'CICLO', v: '12 SEM' },
                  { l: 'NÍVEL', v: levelLabel.slice(0, 5) },
                ].map((s) => (
                  <View
                    key={s.l}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: 'center',
                      backgroundColor: 'rgba(255,255,255,0.045)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <Text style={{ fontFamily: fonts.display, fontSize: 20, color: '#fff' }}>
                      {s.v}
                    </Text>
                    <MonoLabel style={{ marginTop: 4, fontSize: 8.5 }}>{s.l}</MonoLabel>
                  </View>
                ))}
              </View>

              <MonoLabel style={{ marginBottom: 8 }}>SPLIT SEMANAL</MonoLabel>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {['PUSH', 'PULL', 'LEGS', 'OFF', 'UPPER', 'LOWER', 'OFF'].map((s, i) => {
                  const on = s !== 'OFF';
                  return (
                    <View
                      key={i}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        alignItems: 'center',
                        borderRadius: 7,
                        backgroundColor: on ? 'rgba(11,112,249,0.22)' : 'rgba(255,255,255,0.03)',
                        borderWidth: 1,
                        borderColor: on ? 'rgba(11,112,249,0.5)' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.faint }}>
                        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'][i]}
                      </Text>
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 9.5,
                          marginTop: 3,
                          color: on ? colors.accentHi : 'rgba(255,255,255,0.25)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {s}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </LinearGradient>

          {/* Projection */}
          <Card style={{ padding: 18, marginTop: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <MonoLabel>PROJEÇÃO · 12 SEMANAS</MonoLabel>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 36,
                      color: colors.accentHi,
                      transform: [{ skewX: '-8deg' }],
                    }}
                  >
                    +6,2
                  </Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.mute }}>
                    kg de massa magra estimada
                  </Text>
                </View>
              </View>
            </View>
            <SegBar value={0.78} segs={16} style={{ marginTop: 14 }} />
            <MonoLabel style={{ marginTop: 8 }}>
              POTENCIAL DE EVOLUÇÃO: <Text style={{ color: colors.accentHi }}>ALTO</Text>
            </MonoLabel>
          </Card>

          <CtaButton onPress={onContinue} style={{ marginTop: 22 }}>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              Criar minha conta
            </Text>
            <Icon name="arrow-right" size={18} color="#fff" />
          </CtaButton>

          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              letterSpacing: 2,
              color: colors.faint,
              textAlign: 'center',
              marginTop: 12,
            }}
          >
            7 DIAS GRÁTIS · CANCELE QUANDO QUISER
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
