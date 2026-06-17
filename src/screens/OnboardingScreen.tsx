import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash } from '../components/ui/Display';
import { SegBar } from '../components/ui/SegBar';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

const ONBOARD = [
  {
    n: '01',
    tag: 'EVOLUÇÃO FÍSICA',
    lines: ['SEU CORPO', 'É O SEU', 'PROJETO.'],
    body: 'Cada treino registrado. Cada carga calculada. Evolução que você vê — e sente.',
  },
  {
    n: '02',
    tag: 'PERFORMANCE',
    lines: ['DADOS DE', 'ATLETA.', 'SEM ACHISMO.'],
    body: 'Volume, intensidade e recuperação monitorados como num centro de alto rendimento.',
  },
  {
    n: '03',
    tag: 'CONSISTÊNCIA',
    lines: ['SEM', 'DESCULPAS.', 'SÓ RESULTADO.'],
    body: 'O método AJ se adapta à sua rotina — e não te deixa parar.',
  },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const d = ONBOARD[step];
  const next = () => (step < 2 ? setStep(step + 1) : onDone());

  return (
    <ScreenBg>
      <OutlineNumber
        size={320}
        style={{ position: 'absolute', top: -30, right: -34, opacity: 0.55 }}
      >
        {d.n}
      </OutlineNumber>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -120,
          left: -200,
          width: 380,
          height: 380,
          borderRadius: 190,
          backgroundColor: 'rgba(11,112,249,0.18)',
        }}
      />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            paddingHorizontal: 28,
            paddingTop: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <View style={{ flex: 1 }}>
            <SegBar value={(step + 1) / 3} segs={12} />
          </View>
          <Pressable onPress={onDone}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 2,
                color: 'rgba(255,255,255,0.5)',
              }}
            >
              PULAR
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            paddingHorizontal: 28,
            paddingBottom: 36,
          }}
        >
          <Slash style={{ marginBottom: 16 }}>{d.tag}</Slash>
          {d.lines.map((l, i) => (
            <Display
              key={i}
              size={52}
              color={i === 1 ? colors.accentHi : '#fff'}
            >
              {l}
            </Display>
          ))}
          <Text
            style={{
              marginTop: 18,
              marginBottom: 28,
              color: colors.mute,
              fontFamily: fonts.ui,
              fontSize: 15,
              lineHeight: 22,
              maxWidth: 300,
            }}
          >
            {d.body}
          </Text>

          <CtaButton onPress={next}>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {step < 2 ? 'Continuar' : 'Montar meu plano'}
            </Text>
            <Icon name="arrow-right" size={18} color="#fff" />
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
