import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

const TICKER_ITEMS: [string, string][] = [
  ['SEQUÊNCIA', '14 DIAS'],
  ['VOLUME SEMANA', '12.4T'],
  ['PR SUPINO', '82.5KG'],
  ['CONSISTÊNCIA', '92%'],
  ['PRÓXIMO NÍVEL', '—12 DIAS'],
];

function Ticker() {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width === 0) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -width,
        duration: 18000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [width, x]);

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={
        onLayout
          ? (e) => onLayout(e.nativeEvent.layout.width)
          : undefined
      }
      style={{ flexDirection: 'row', gap: 36, paddingRight: 36 }}
    >
      {TICKER_ITEMS.map(([l, v], i) => (
        <Text
          key={i}
          style={{
            fontFamily: fonts.mono,
            fontSize: 10,
            letterSpacing: 2,
            color: colors.faint,
          }}
        >
          {l}{' '}
          <Text style={{ color: colors.accentHi, fontFamily: fonts.monoBold }}>{v}</Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        paddingVertical: 8,
        marginBottom: 18,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          transform: [{ translateX: x }],
          paddingLeft: 22,
        }}
      >
        {row((w) => setWidth(w))}
        {row()}
      </Animated.View>
    </View>
  );
}

export function HomeScreen({
  onStart,
  onOpenConsistency,
}: {
  onStart: () => void;
  onOpenConsistency: () => void;
}) {
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* greeting */}
          <View
            style={{
              paddingHorizontal: 22,
              paddingBottom: 18,
              paddingTop: 12,
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <View>
              <MonoLabel>SEG · 03 JUN · SEMANA 04/12</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }}>
                E AÍ,
              </Display>
              <Display size={34}>ARNALDO.</Display>
            </View>
            <LinearGradient
              colors={['#1f82ff', colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: colors.accent,
                shadowOpacity: 0.45,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 0 },
                elevation: 6,
              }}
            >
              <Text style={{ fontFamily: fonts.display, fontSize: 16, color: '#fff' }}>AJ</Text>
            </LinearGradient>
          </View>

          {/* ticker */}
          <Ticker />

          {/* TODAY POSTER */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={['#0a1a55', '#051042', '#04021c']}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16,
                borderBottomRightRadius: 0,
                overflow: 'hidden',
                minHeight: 250,
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.3)',
                padding: 20,
                justifyContent: 'space-between',
              }}
            >
              <HudCorners />
              <OutlineNumber
                size={210}
                style={{ position: 'absolute', bottom: -64, right: -16, opacity: 0.5 }}
              >
                04
              </OutlineNumber>
              <View>
                <Slash>TREINO DE HOJE</Slash>
                <Display size={38} style={{ marginTop: 12 }}>
                  PUSH —
                </Display>
                <Display size={38}>PEITO &amp; OMBRO</Display>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10.5,
                      color: 'rgba(255,255,255,0.65)',
                      letterSpacing: 1,
                    }}
                  >
                    58 MIN · 8 EXERCÍCIOS · ~420 KCAL
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onStart}
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 20,
                  paddingVertical: 15,
                  paddingHorizontal: 26,
                  backgroundColor: '#fff',
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                  borderBottomLeftRadius: 10,
                  borderBottomRightRadius: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  shadowColor: '#fff',
                  shadowOpacity: 0.16,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 8,
                }}
              >
                <Icon name="play" size={13} color="#020010" />
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 15,
                    letterSpacing: 1.5,
                    color: '#020010',
                    textTransform: 'uppercase',
                  }}
                >
                  Iniciar treino
                </Text>
              </Pressable>
            </LinearGradient>
          </View>

          {/* consistency card (tap → monthly calendar) */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <Pressable onPress={onOpenConsistency}>
              <Card style={{ padding: 18 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Slash>CONSISTÊNCIA · SEMANA</Slash>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{
                        fontFamily: fonts.display,
                        fontSize: 22,
                        color: '#fff',
                        textTransform: 'uppercase',
                      }}
                    >
                      4<Text style={{ color: colors.faint, fontSize: 15 }}>/5</Text>
                    </Text>
                    <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.4)" />
                  </View>
                </View>
                <SegBar value={0.8} segs={15} />
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
                  {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => {
                    const states = ['done', 'done', 'done', 'rest', 'done', 'today', 'future'];
                    const s = states[i];
                    const bg =
                      s === 'done'
                        ? 'rgba(11,112,249,0.3)'
                        : s === 'today'
                          ? colors.accent
                          : 'rgba(255,255,255,0.04)';
                    return (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <View
                          style={{
                            height: 34,
                            width: '100%',
                            borderRadius: 8,
                            marginBottom: 5,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: bg,
                            borderWidth: 1,
                            borderColor:
                              s === 'today' ? colors.accentHi : 'rgba(255,255,255,0.06)',
                            shadowColor: s === 'today' ? colors.accent : 'transparent',
                            shadowOpacity: s === 'today' ? 0.6 : 0,
                            shadowRadius: 8,
                            shadowOffset: { width: 0, height: 0 },
                            elevation: s === 'today' ? 4 : 0,
                          }}
                        >
                          {s === 'done' && <Icon name="check" size={13} color="#fff" />}
                          {s === 'today' && <Icon name="bolt" size={13} color="#fff" />}
                          {s === 'rest' && (
                            <Text style={{ fontFamily: fonts.mono, fontSize: 8, color: colors.faint }}>
                              OFF
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.faint }}>
                          {d}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            </Pressable>
          </View>

          {/* twin stats */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16, flexDirection: 'row', gap: 12 }}>
            {[
              { l: 'SEQUÊNCIA', v: '14', u: 'DIAS', icon: 'flame', note: 'recorde pessoal: 21' },
              { l: 'VOLUME', v: '12.4', u: 'TON', icon: 'dumbbell', note: '+8% vs semana passada' },
            ].map((s) => (
              <Card key={s.l} style={{ flex: 1, padding: 16 }}>
                <View
                  style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}
                >
                  <MonoLabel>{s.l}</MonoLabel>
                  <Icon name={s.icon as IconName} size={14} color={colors.accentHi} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 34,
                      color: '#fff',
                      transform: [{ skewX: '-8deg' }],
                    }}
                  >
                    {s.v}
                  </Text>
                  <MonoLabel>{s.u}</MonoLabel>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.mute, marginTop: 6 }}>
                  {s.note}
                </Text>
              </Card>
            ))}
          </View>

          {/* up next */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 18 }}>
            <Slash style={{ marginBottom: 12 }}>PRÓXIMOS TREINOS</Slash>
            {[
              { d: 'QUA', n: 'PULL — Costas & Bíceps', t: '54 min · 7 exercícios' },
              { d: 'SEX', n: 'LEGS — Quadríceps & Glúteos', t: '62 min · 9 exercícios' },
              { d: 'SÁB', n: 'UPPER — Empurrar leve', t: '45 min · 6 exercícios' },
            ].map((w, i) => (
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
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 15,
                    color: 'rgba(255,255,255,0.3)',
                    width: 38,
                    textTransform: 'uppercase',
                  }}
                >
                  {w.d}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                    {w.n}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      color: colors.faint,
                      marginTop: 3,
                      letterSpacing: 1,
                    }}
                  >
                    {w.t}
                  </Text>
                </View>
                <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.35)" />
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
