import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Display } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

type PlanId = 'week' | 'quarter' | 'year';

type PlanRow = {
  id: PlanId;
  title: string;
  note: string;
  price: string;
  best?: boolean;
};

const PLAN_ROWS: PlanRow[] = [
  { id: 'week', title: 'Semanal', note: 'teste grátis de 7 dias', price: 'depois R$ 9,90/sem' },
  { id: 'quarter', title: 'Trimestral', note: 'R$ 117 a cada 3 meses', price: 'R$ 9,00 / sem' },
  { id: 'year', title: 'Anual', note: 'R$ 299/ano', price: 'R$ 5,70 / sem', best: true },
];

export function PaywallScreen({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<PlanId>('year');
  const trialPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(trialPulse, {
          toValue: 1.025,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(trialPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [trialPulse]);

  return (
    <View style={{ flex: 1 }}>
      {/* Bottom-up navy → deeper blue gradient — the only strong bg gradient in the app. */}
      <LinearGradient
        colors={['#020010', '#03061a', '#05122e', '#071f4d']}
        locations={[0, 0.55, 0.82, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Close button — top-left */}
        <Pressable
          onPress={onDone}
          style={{
            position: 'absolute',
            top: 12,
            left: 20,
            zIndex: 5,
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="x" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: 24,
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            <Display size={32}>ESCOLHA SEU PLANO</Display>
            <Text
              style={{
                marginTop: 12,
                fontFamily: fonts.ui,
                fontSize: 14.5,
                lineHeight: 21,
                color: colors.mute,
              }}
            >
              Treine 7x mais inteligente e evolua mais rápido com o método AJ.
            </Text>

            {/* Fixed trial benefit — animated to highlight the offer without acting as a control. */}
            <Animated.View
              style={{
                marginTop: 24,
                borderRadius: 18,
                shadowColor: colors.accent,
                shadowOpacity: 0.38,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 0 },
                elevation: 10,
                transform: [{ scale: trialPulse }],
              }}
            >
              <LinearGradient
                colors={['rgba(11,112,249,0.28)', 'rgba(11,112,249,0.08)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  paddingVertical: 18,
                  paddingHorizontal: 18,
                  alignItems: 'center',
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: colors.accent,
                  overflow: 'hidden',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="sparkles" size={16} color={colors.accentHi} stroke={2} />
                  <Text
                    style={{
                      fontFamily: fonts.monoBold,
                      fontSize: 11,
                      letterSpacing: 1.8,
                      color: colors.accentHi,
                    }}
                  >
                    VOCÊ GANHOU
                  </Text>
                  <Icon name="sparkles" size={16} color={colors.accentHi} stroke={2} />
                </View>
                <Text
                  style={{
                    marginTop: 5,
                    fontFamily: fonts.display,
                    fontSize: 32,
                    lineHeight: 38,
                    letterSpacing: 1,
                    color: '#fff',
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  7 DIAS GRÁTIS
                </Text>
                <Text
                  style={{
                    marginTop: 3,
                    fontFamily: fonts.ui,
                    fontSize: 12.5,
                    color: colors.mute,
                  }}
                >
                  Acesso completo. Cancele quando quiser.
                </Text>
              </LinearGradient>
            </Animated.View>

            {/* Due row */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 4,
                paddingTop: 14,
                paddingBottom: 2,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.monoBold,
                  fontSize: 11.5,
                  letterSpacing: 0.5,
                  color: 'rgba(255,255,255,0.8)',
                }}
              >
                Hoje você paga — R$ 0,00
              </Text>
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: 13,
                  color: colors.accentHi,
                  transform: [{ skewX: '-8deg' }],
                  textTransform: 'uppercase',
                }}
              >
                COBRANÇA EM 7 DIAS
              </Text>
            </View>

            {/* Plan rows */}
            <View style={{ gap: 10, marginTop: 12 }}>
              {PLAN_ROWS.map((r) => (
                <PlanRowButton
                  key={r.id}
                  row={r}
                  selected={plan === r.id}
                  onSelect={() => setPlan(r.id)}
                />
              ))}
            </View>

            {/* Footer links */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 26,
                marginTop: 8,
              }}
            >
              {['Termos', 'Privacidade', 'Restaurar'].map((l) => (
                <Text
                  key={l}
                  style={{
                    fontFamily: fonts.uiMed,
                    fontSize: 12.5,
                    color: 'rgba(255,255,255,0.6)',
                    textDecorationLine: 'underline',
                  }}
                >
                  {l}
                </Text>
              ))}
            </View>

            {/* White CTA — inverts the palette on purpose for max conversion contrast */}
            <Pressable
              onPress={onDone}
              style={{
                marginTop: 80,
                height: 60,
                borderRadius: 18,
                backgroundColor: '#fff',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#ffffff',
                shadowOpacity: 0.18,
                shadowRadius: 36,
                shadowOffset: { width: 0, height: 12 },
                elevation: 12,
              }}
            >
              <Text
                style={{
                  color: '#020010',
                  fontFamily: fonts.display,
                  fontSize: 18,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                COMEÇAR MEUS 7 DIAS GRÁTIS
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function PlanRowButton({
  row,
  selected,
  onSelect,
}: {
  row: PlanRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={{
        position: 'relative',
        paddingVertical: 18,
        paddingHorizontal: 18,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: selected ? 'rgba(11,112,249,0.12)' : 'rgba(255,255,255,0.04)',
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.accent : 'rgba(255,255,255,0.1)',
        shadowColor: selected ? colors.accent : 'transparent',
        shadowOpacity: selected ? 0.28 : 0,
        shadowRadius: selected ? 24 : 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: selected ? 8 : 0,
      }}
    >
      {row.best && (
        <View
          style={{
            position: 'absolute',
            top: -10,
            right: 16,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 7,
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.monoBold,
              fontSize: 9.5,
              letterSpacing: 1,
              color: '#fff',
            }}
          >
            MELHOR VALOR
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 19,
            color: '#fff',
            textTransform: 'uppercase',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {row.title}
        </Text>
        <Text
          style={{
            marginTop: 4,
            fontFamily: fonts.mono,
            fontSize: 10.5,
            letterSpacing: 0.3,
            color: colors.mute,
          }}
        >
          {row.note}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 12.5,
          color: selected ? colors.accentHi : 'rgba(255,255,255,0.7)',
          textAlign: 'right',
        }}
      >
        {row.price}
      </Text>
    </Pressable>
  );
}
