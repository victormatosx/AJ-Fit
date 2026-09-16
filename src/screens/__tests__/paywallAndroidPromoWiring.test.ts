import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-inspection suite (no React renderer in this Node-only vitest
 * config — same constraint documented in `paywallDevOverride.test.ts`).
 * FASE 6.3: confirms the Paywall wires the Android 'new'-shape resolution
 * (`subscriptionOffer.ts`) correctly — behavioral coverage of the
 * resolution/route functions themselves lives in
 * `src/lib/__tests__/subscriptionOfferMatching.test.ts`.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const PAYWALL_SOURCE = readFileSync('src/screens/PaywallScreen.tsx', 'utf8');
const SUBSCRIPTION_OFFER_SOURCE = readFileSync('src/lib/subscriptionOffer.ts', 'utf8');
const PROMO_CODE_STATE_SOURCE = readFileSync('src/lib/promoCodeState.ts', 'utf8');
const PROMO_CODE_SERVICE_SOURCE = readFileSync('src/services/promoCodeService.ts', 'utf8');

// Doc comments legitimately mention example values like "monthly-promo" for
// illustration — item 6's "never hardcode" concern is about PRODUCTION
// LOGIC, not prose. Strip comments before scanning for literals, same as
// `paywallDevOverride.test.ts`'s CODE constant.
const PAYWALL_CODE = stripComments(PAYWALL_SOURCE);
const SUBSCRIPTION_OFFER_CODE = stripComments(SUBSCRIPTION_OFFER_SOURCE);
const PROMO_CODE_STATE_CODE = stripComments(PROMO_CODE_STATE_SOURCE);
const PROMO_CODE_SERVICE_CODE = stripComments(PROMO_CODE_SERVICE_SOURCE);

describe('Paywall Android FASE 6.3 wiring', () => {
  it('imports the FASE 6.3 resolution functions from subscriptionOffer.ts', () => {
    expect(PAYWALL_SOURCE).toContain('resolveAndroidPurchaseRoute');
    expect(PAYWALL_SOURCE).toContain('applyAndroidPromoPackageOverrides');
  });

  it('no longer calls the legacy-only resolvePurchaseRoute directly — only resolveAndroidPurchaseRoute (which wraps it internally)', () => {
    expect(PAYWALL_SOURCE).not.toMatch(/[^\w]resolvePurchaseRoute\(/);
  });

  it('purchaseRoute passes `offerings` into resolveAndroidPurchaseRoute — the NEW shape cannot resolve without the live catalog', () => {
    expect(PAYWALL_SOURCE).toMatch(
      /resolveAndroidPurchaseRoute\(\s*selectedPackage,\s*promoApplied,\s*authorizedOffer,\s*offerings,?\s*\)/,
    );
  });

  it('the displayed package list is overridden for Android via applyAndroidPromoPackageOverrides, not left as the standard catalog unconditionally', () => {
    expect(PAYWALL_SOURCE).toMatch(
      /applyAndroidPromoPackageOverrides\(\s*standardPackages,\s*offerings,\s*promoState\.applied\.androidStoreConfig,?\s*\)/,
    );
  });

  it('never hardcodes coupon_discount/monthly-promo/annual-promo/trial-7d-new-subscriber anywhere in client purchase logic', () => {
    for (const forbidden of [
      'coupon_discount',
      'monthly-promo',
      'annual-promo',
      'trial-7d-new-subscriber',
    ]) {
      expect(PAYWALL_CODE).not.toContain(forbidden);
      expect(SUBSCRIPTION_OFFER_CODE).not.toContain(forbidden);
      expect(PROMO_CODE_STATE_CODE).not.toContain(forbidden);
      expect(PROMO_CODE_SERVICE_CODE).not.toContain(forbidden);
    }
  });

  it('resolveAndroidNewOfferPackage never reads offerings.current', () => {
    const fn = SUBSCRIPTION_OFFER_SOURCE.slice(
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function resolveAndroidNewOfferPackage'),
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function resolveAndroidPurchaseRoute'),
    );
    expect(fn).not.toContain('offerings?.current');
    expect(fn).not.toContain('offerings.current');
    expect(fn).toContain('offerings?.all');
  });

  it('resolveAndroidPurchaseRoute never falls back to `pkg` for the NEW shape — every non-resolved outcome is `blocked`', () => {
    const fn = SUBSCRIPTION_OFFER_SOURCE.slice(
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function resolveAndroidPurchaseRoute'),
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function applyAndroidPromoPackageOverrides'),
    );
    // The only `package: pkg` in this function must be the `!promoApplied`
    // early return (no promo at all) — never inside the 'new' branch.
    const newBranch = fn.slice(fn.indexOf("authorizedOffer.kind === 'new'"));
    expect(newBranch).not.toContain('package: pkg');
  });

  it('never selects a SubscriptionOption manually for the NEW shape — no purchaseSubscriptionOption call in that branch', () => {
    const fn = SUBSCRIPTION_OFFER_SOURCE.slice(
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function resolveAndroidPurchaseRoute'),
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function applyAndroidPromoPackageOverrides'),
    );
    expect(fn).not.toContain('purchaseSubscriptionOption');
    expect(fn).not.toContain('SubscriptionOption');
  });

  it('applyAndroidPromoPackageOverrides never blocks/throws on resolution failure — degrades to the standard package for display only', () => {
    const fn = SUBSCRIPTION_OFFER_SOURCE.slice(
      SUBSCRIPTION_OFFER_SOURCE.indexOf('export function applyAndroidPromoPackageOverrides'),
    );
    expect(fn).toContain("resolution.status === 'resolved' ? resolution.package : pkg");
  });
});
