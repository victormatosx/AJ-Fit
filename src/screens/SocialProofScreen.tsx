import React, { useRef } from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { AjInterstitialLayout } from '../components/onboarding/AjInterstitialLayout';
import { SocialProofCarousel } from '../components/onboarding/SocialProofCarousel';
import { useTheme } from '../theme';

/**
 * AJ hands over to other people's results. The testimonial carousel, its copy
 * keys and the privacy reassurance below the CTA are all unchanged (§4.6) —
 * what changed is that the headline is now spoken rather than set as a
 * standalone display heading.
 *
 * The faint radial wash this screen used to draw across its top is gone. It
 * predates the funnel having a mascot at all; now that AJ stands exactly
 * there, it would read as a halo behind him, which the design explicitly
 * rules out.
 */
export function SocialProofScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  // Guards against a fast double-tap firing onDone twice.
  const advancing = useRef(false);

  const handleContinue = () => {
    if (advancing.current) return;
    advancing.current = true;
    onDone();
  };

  return (
    <AjInterstitialLayout
      lines={[
        `${t('socialProof.headlineLine1')} ${t('socialProof.headlineLine2')}`,
        t('socialProof.subtitle'),
      ]}
      ctaLabel={t('socialProof.cta')}
      onContinue={handleContinue}
      footer={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          <Icon name="lock" size={12} color={theme.colors.textFaint} />
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
            {t('socialProof.privacy')}
          </Text>
        </View>
      }
    >
      <SocialProofCarousel />
    </AjInterstitialLayout>
  );
}
