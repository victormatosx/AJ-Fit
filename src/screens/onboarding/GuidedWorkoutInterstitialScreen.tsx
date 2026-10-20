import React from 'react';
import { useTranslation } from 'react-i18next';
import { AjInterstitialLayout } from '../../components/onboarding/AjInterstitialLayout';
import { GuidedWorkoutCarousel } from '../../components/onboarding/GuidedWorkoutCarousel';
import type { OnboardingProgress } from '../../onboarding/useOnboardingFunnel';

/**
 * Product-demo interstitial: an auto-advancing carousel of three short demo
 * clips (`video-01/02/03.mp4`) *is* the pitch — see `GuidedWorkoutCarousel`
 * for the playback/preload architecture (`onboardingVideoPreload.ts`), which
 * this redesign does not touch. AJ introduces it from above the frame; the
 * body line that used to sit under the carousel is now his second line.
 */
export function GuidedWorkoutInterstitialScreen({
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
        `${t('interstitials.guidedWorkout.titleLine1')} ${t('interstitials.guidedWorkout.titleLine2')}`,
        t('interstitials.guidedWorkout.body'),
      ]}
      ctaLabel={t('interstitials.guidedWorkout.cta')}
      onContinue={onContinue}
    >
      <GuidedWorkoutCarousel />
    </AjInterstitialLayout>
  );
}
