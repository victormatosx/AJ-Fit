import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Text as SvgText,
  Defs,
  RadialGradient,
  Stop,
  Rect,
} from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../components/ui/Display';
import { SegBar } from '../components/ui/SegBar';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

// Fixed step contract — three slides, always in this order. Text comes from
// `onboarding:slides.stepN.*` via i18n. Renaming a step here breaks its
// translation lookup — keep in sync with resources/*/onboarding.json.
const ONBOARD_STEPS = ['step1', 'step2', 'step3'] as const;

export function OnboardingScreen({
  onDone,
  onLogin,
}: {
  onDone: () => void;
  onLogin: () => void;
}) {
  const { t } = useTranslation(['onboarding', 'common']);
  const [step, setStep] = useState(0);
  const next = () => (step < 2 ? setStep(step + 1) : onDone());

  const stepKey = ONBOARD_STEPS[step];
  const d = useMemo(
    () => ({
      n: String(step + 1).padStart(2, '0'),
      tag: t(`onboarding:slides.${stepKey}.tag`).toUpperCase(),
      lines: [
        t(`onboarding:slides.${stepKey}.line1`).toUpperCase(),
        t(`onboarding:slides.${stepKey}.line2`).toUpperCase(),
        t(`onboarding:slides.${stepKey}.line3`).toUpperCase(),
      ],
      body: t(`onboarding:slides.${stepKey}.body`),
    }),
    [step, stepKey, t],
  );

  // Outlined number anchored to the top-right corner — sized so both digits
  // are visible and only a small slice of the second digit is cropped by
  // the right edge of the screen.
  const outlineFontSize = 380;
  const outlineSvgW = 440;
  const outlineSvgH = 340;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: 'hidden' }}>
      {/* Bottom-left blue radial glow */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -260,
          bottom: -280,
          width: 560,
          height: 560,
        }}
      >
        <Svg width={560} height={560}>
          <Defs>
            <RadialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#0b70f9" stopOpacity="0.55" />
              <Stop offset="45%" stopColor="#0b70f9" stopOpacity="0.18" />
              <Stop offset="100%" stopColor="#0b70f9" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="560" height="560" fill="url(#blueGlow)" />
        </Svg>
      </View>

      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 14, right: -36 }}
      >
        <Svg width={outlineSvgW} height={outlineSvgH}>
          <SvgText
            x={outlineSvgW}
            y={outlineSvgH * 0.85}
            fontFamily={fonts.display}
            fontSize={outlineFontSize}
            textAnchor="end"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.5}
            fill="none"
          >
            {d.n}
          </SvgText>
        </Svg>
      </View>

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
              {t('onboarding:actions.skip').toUpperCase()}
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
              {step < 2
                ? t('common:actions.continue')
                : t('onboarding:actions.buildPlan')}
            </Text>
            <Icon name="arrow-right" size={18} color="#fff" />
          </CtaButton>

          <Pressable
            onPress={onLogin}
            style={{ alignSelf: 'center', marginTop: 20 }}
          >
            <Text
              style={{
                fontFamily: fonts.ui,
                fontSize: 14,
                color: colors.mute,
              }}
            >
              {t('onboarding:footer.hasAccount')}{' '}
              <Text style={{ color: colors.accentHi, fontFamily: fonts.ui }}>
                {t('onboarding:footer.login')}
              </Text>
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
