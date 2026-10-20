import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const planReady = read('screens/PlanReadyScreen.tsx');
const paywall = read('screens/PaywallScreen.tsx');

/** Counting call sites only makes sense over code — a prose mention is not one. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PREMATURE_COMMERCIAL_PROMISE =
  /comece gr[aá]tis|7\s*(dias|days|días).*(gr[aá]tis|free|gratis)|sem cobran[cç]a|no charge|sin cargo/i;

describe('pre-Paywall commercial communication boundary', () => {
  it('keeps PlanReady neutral while preserving the existing continuation action', () => {
    expect(planReady).not.toMatch(PREMATURE_COMMERCIAL_PROMISE);

    // The CTA still does exactly one thing: run the caller's `onContinue`.
    // It is no longer wired straight into `onPress` because the approved
    // design defers the call behind AJ's exit animation, so the guarantee
    // moved from the JSX onto the single handler that owns the call:
    expect(planReady).toContain('onPress={handleContinue}');
    // ...it can only fire once, however fast the button is tapped...
    expect(planReady).toContain('if (continuedRef.current) return;');
    expect(planReady).toContain('continuedRef.current = true;');
    // ...and nothing else on the screen reaches the prop. Four references in
    // the code itself: the destructured prop, its type, the immediate path and
    // the deferred one — all four inside `handleContinue` or its signature.
    expect(stripComments(planReady).match(/\bonContinue\b/g) ?? []).toHaveLength(4);
    expect(planReady).not.toMatch(/onPress=\{\(\)\s*=>\s*onContinue/);
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
