import React from 'react';
import { useTranslation } from 'react-i18next';
import { AjInterstitialLayout } from '../../components/onboarding/AjInterstitialLayout';
import { AjFitProgressCarousel } from '../../components/onboarding/AjFitProgressCarousel';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * The AJ Fit product itself — shown through a 3D circular carousel of
 * screenshots — is the pitch here, not a list of feature cards. See
 * `AjFitProgressCarousel` for the carousel mechanics; the two headline lines
 * are now spoken by AJ above it, which is the only thing this step's redesign
 * changed. Copy keys and the carousel are untouched.
 */
export function AjFitProgressInterstitialScreen({
  name,
  progress,
  onContinue,
}: {
  name: string | null;
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');

  return (
    <AjInterstitialLayout
      progress={progress}
      lines={[
        name
          ? t('interstitials.ajFitProgress.titleLine1', { name })
          : t('interstitials.ajFitProgress.titleLine1NoName'),
        t('interstitials.ajFitProgress.titleLine2'),
      ]}
      ctaLabel={t('interstitials.ajFitProgress.cta')}
      onContinue={onContinue}
    >
      <AjFitProgressCarousel />
    </AjInterstitialLayout>
  );
}
