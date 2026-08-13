import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const planReady = read('screens/PlanReadyScreen.tsx');
const paywall = read('screens/PaywallScreen.tsx');

const PREMATURE_COMMERCIAL_PROMISE =
  /comece gr[aá]tis|7\s*(dias|days|días).*(gr[aá]tis|free|gratis)|sem cobran[cç]a|no charge|sin cargo/i;

describe('pre-Paywall commercial communication boundary', () => {
  it('keeps PlanReady neutral while preserving the existing continuation action', () => {
    expect(planReady).not.toMatch(PREMATURE_COMMERCIAL_PROMISE);
    expect(planReady).toContain('onPress={onContinue}');
  });

  it('keeps RevenueCat, promotion and intro eligibility out of PlanReady', () => {
    for (const forbiddenDependency of [
      'react-native-purchases',
      'checkTrialOrIntroductoryPriceEligibility',
      'iosPromotion',
      'promoApplied',
    ]) expect(planReady).not.toContain(forbiddenDependency);
  });

  it('keeps the Paywall as the surface that derives real introductory terms', () => {
    expect(paywall).toContain('resolveIOSIntroOfferPresentation');
    expect(paywall).toContain("presentation.kind === 'free_trial'");
    expect(paywall).toContain("presentation.kind === 'standard'");
    expect(paywall).toContain("presentation.kind === 'checking'");
    expect(paywall).toContain("presentation.kind === 'configuration_error'");
  });
});
