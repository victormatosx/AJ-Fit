import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paywall = read('screens/PaywallScreen.tsx');
const promoService = read('services/promoCodeService.ts');
const subscriptionContext = read('state/SubscriptionContext.tsx');
const attributionSync = read('../functions/src/attribution/attributionSync.ts');
const subscriptionSync = read('../functions/src/billing/subscriptionSync.ts');

describe('FASE 5 iOS promotional purchase boundaries', () => {
  const purchaseHandler = paywall.slice(
    paywall.indexOf('const handlePurchase'),
    paywall.indexOf('const handleRestore'),
  );

  it('authorizes only inside the tap handler and sends only plan', () => {
    expect(purchaseHandler).toContain('authorize: authorizePromoPurchase');
    expect((paywall.match(/authorizePromoPurchase/g) ?? []).length).toBe(2);
    expect(promoService).toContain('authorizePromoPurchaseCallable({ plan })');
    expect(promoService).not.toMatch(/authorizePromoPurchaseCallable\(\{[^}]*uid/);
    expect(promoService).not.toMatch(/authorizePromoPurchaseCallable\(\{[^}]*product/);
  });

  it('acquires the existing local lock before any authorization await', () => {
    expect(purchaseHandler.indexOf('actionInFlight.current = true')).toBeGreaterThan(-1);
    expect(purchaseHandler.indexOf('actionInFlight.current = true')).toBeLessThan(
      purchaseHandler.indexOf('executeIOSPromoPurchase'),
    );
  });

  it('new iOS promo branch cannot reach Apple Offer Code redemption', () => {
    const promoBranch = purchaseHandler.slice(
      purchaseHandler.indexOf("effectiveRoute.kind === 'ios_promo_package'"),
      purchaseHandler.indexOf('} else {', purchaseHandler.indexOf("effectiveRoute.kind === 'ios_promo_package'")),
    );
    expect(promoBranch).toContain('executeIOSPromoPurchase');
    expect(promoBranch).not.toContain('redeemAppleOfferCode');
    expect(paywall).toContain('redeemAppleOfferCode');
  });

  it('uses scoped eligibility and never derives trial from names or authorization', () => {
    expect(paywall).toContain('checkIOSIntroEligibility(productIds)');
    expect(paywall).toContain('iosEligibilitySnapshot.scopeKey === eligibilityScopeKey');
    const introModel = read('lib/iosIntroOffer.ts');
    expect(introModel).toContain('pkg.product.introPrice');
    expect(introModel).toContain('intro.price !== 0');
    expect(introModel).not.toMatch(/promo_7d|ARNALDO|_promo/);
  });

  it('preserves CustomerInfo authority and does not add client-side intent consumption', () => {
    expect(subscriptionContext).toContain(
      'Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID])',
    );
    expect(paywall).not.toMatch(/lockedAt|trialStartedAt|convertedAt|purchase_confirmed/);
  });

  it('keeps backend correlation and subscription sync untouched by the app phase', () => {
    expect(attributionSync).toContain('correlateApplePromoPurchaseIntent');
    expect(subscriptionSync.length).toBeGreaterThan(1000);
  });
});
