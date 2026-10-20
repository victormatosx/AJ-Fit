import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const paywall = read('screens/PaywallScreen.tsx');
const subscriptionContext = read('state/SubscriptionContext.tsx');
const revenueCatService = read('services/revenueCatService.ts');
const subscriptionOffer = read('lib/subscriptionOffer.ts');
const promoProvider = read('state/PromoCodeContext.tsx');
const promoService = read('services/promoCodeService.ts');

describe('FASE 6 — retired Apple Offer Code client path stays absent', () => {
  it('has no legacy route, context operation, service operation, or native sheet call', () => {
    const productionSources = [paywall, subscriptionContext, revenueCatService, subscriptionOffer];
    for (const source of productionSources) {
      expect(source).not.toContain('offer_redemption');
      expect(source).not.toContain('resolveApplePurchaseRoute');
      expect(source).not.toContain('redeemAppleOfferCode');
      expect(source).not.toContain('redeemOfferCode');
      expect(source).not.toContain('presentCodeRedemptionSheet');
      expect(source).not.toContain('awaitCustomerInfoUpdate');
    }
  });

  it('does not transport the legacy iOS storeConfig into client promo state', () => {
    expect(promoProvider).not.toContain('storeConfig.ios');
    expect(paywall).not.toContain('appleStoreConfig');
  });

  it('keeps the retired iOS storeConfig field absent from the wire contract', () => {
    expect(promoService).not.toContain('PromoCodeAppleStoreConfig');
    expect(promoService).not.toContain('storeConfig?.ios');
  });

  it('preserves both legitimate CustomerInfo synchronization paths', () => {
    expect(subscriptionContext).toContain('addCustomerInfoListener(listener)');
    expect(subscriptionContext).toContain("NativeAppState.addEventListener('change'");
    expect(subscriptionContext).toContain('refreshCustomerInfo()');
  });

  it('preserves normal package, authorized iOS Promo SKU, and Android option purchases', () => {
    expect(paywall).toContain("effectiveRoute.kind === 'ios_promo_package'");
    expect(paywall).toContain('executeIOSPromoPurchase');
    expect(paywall).toContain('await purchase(effectiveRoute.package)');
    expect(paywall).toContain('await purchaseOption(effectiveRoute.option)');
    // The purchase button's label is still i18n and still falls back to the
    // shared continue action. It moved off `CtaText` with the acquisition
    // redesign (the Paywall no longer uses the app-wide gradient CTA); the
    // label itself is pinned in `paywallRedesignStructure.test.ts`.
    expect(paywall).toContain("t('actions.continue')");
    expect(paywall).toContain('label={purchaseLabel}');
  });
});
