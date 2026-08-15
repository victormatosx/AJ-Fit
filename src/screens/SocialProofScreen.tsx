import React, { useRef } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../components/ui/Display';
import { CtaButton } from '../components/ui/CtaButton';
import { Icon } from '../components/ui/Icon';
import { SocialProofCarousel } from '../components/onboarding/SocialProofCarousel';
import { colors, fonts, sizes, spacing } from '../theme/tokens';

export function SocialProofScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('onboarding');
  // Guards against a fast double-tap firing onDone twice.
  const advancing = useRef(false);

  const handleContinue = () => {
    if (advancing.current) return;
    advancing.current = true;
    onDone();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, overflow: 'hidden' }}>
      {/* Extremely subtle top glow — mirrors the faint radial wash already
          used on OnboardingScreen, toned down so it reads as texture, not glow. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: -180, left: '50%', marginLeft: -220, width: 440, height: 380 }}
      >
        <Svg width={440} height={380}>
          <Defs>
            <RadialGradient id="socialProofGlow" cx="50%" cy="10%" r="60%">
              <Stop offset="0%" stopColor={colors.accent} stopOpacity="0.16" />
              <Stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="440" height="380" fill="url(#socialProofGlow)" />
        </Svg>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[3],
            paddingBottom: spacing[3],
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <Slash>{t('socialProof.eyebrow')}</Slash>

            <View style={{ alignItems: 'center', marginTop: spacing[1.5] }}>
              <Display size={22} skew={false} style={{ textAlign: 'center' }}>
                {t('socialProof.headlineLine1')}
              </Display>
              <Display size={22} skew={false} color={colors.accentHi} style={{ textAlign: 'center' }}>
                {t('socialProof.headlineLine2')}
              </Display>
            </View>

            <Text
              style={{
                marginTop: spacing[1.5],
                fontFamily: fonts.ui,
                fontSize: 12.5,
                lineHeight: 17,
                color: colors.mute,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              {t('socialProof.subtitle')}
            </Text>
          </View>

          <View style={{ flex: 1, marginTop: spacing[3] }}>
            <SocialProofCarousel />
          </View>

          <CtaButton
            onPress={handleContinue}
            accessibilityLabel={t('socialProof.accessibility.continue')}
            style={{ marginTop: spacing[3] }}
          >
            {t('socialProof.cta')}
          </CtaButton>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: spacing[2],
            }}
          >
            <Icon name="lock" size={12} color={colors.faint} />
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>
              {t('socialProof.privacy')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
