import React from 'react';
import { useTranslation } from 'react-i18next';
import { AjInterstitialLayout } from '../../components/onboarding/AjInterstitialLayout';
import { EvolutionCarousel } from '../../components/onboarding/EvolutionCarousel';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * AJ introduces the idea, the existing before/after carousel carries it.
 *
 * The copy keys are unchanged: the design's own interstitial text is marked
 * provisional in the reference sheets, and the prompt is explicit that the
 * shipped copy and assets stay (§4.6). What changed is the arrangement — the
 * headline is now something AJ says, above the carousel, rather than a
 * standalone display heading.
 */
export function EvolutionInterstitialScreen({
  progress,
  onContinue,
}: {
  progress: OnboardingProgress;
  onContinue: () => void;
}) {
  const { t } = useTranslation('onboarding');

  return (
    <AjInterstitialLayout
      progress={progress}
      lines={[
        `${t('interstitials.evolution.titleLine1')} ${t('interstitials.evolution.titleLine2')}`,
        t('interstitials.evolution.intro'),
      ]}
      ctaLabel={t('interstitials.evolution.cta')}
      onContinue={onContinue}
    >
      <EvolutionCarousel />
    </AjInterstitialLayout>
  );
}
