import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const app = read('../App.tsx');
const paywall = read('screens/PaywallScreen.tsx');
const promoProvider = read('state/PromoCodeContext.tsx');
const subscriptionContext = read('state/SubscriptionContext.tsx');
const revenueCatService = read('services/revenueCatService.ts');

describe('FASE 4 iOS promotional architecture boundaries', () => {
  it('keeps promo state above RootNavigator, so Paywall remount does not discard it', () => {
    const providerOpen = app.indexOf('<PromoCodeProvider>');
    const navigator = app.indexOf('{fontsLoaded && i18nReady ? <RootNavigator />');
    const providerClose = app.indexOf('</PromoCodeProvider>');
    expect(providerOpen).toBeGreaterThan(-1);
    expect(providerOpen).toBeLessThan(navigator);
    expect(navigator).toBeLessThan(providerClose);
  });

  it('uses memory + identity scoping, never global persistent storage', () => {
    expect(promoProvider).toContain("dispatch({ type: 'identity-changed', uid, generation })");
    expect(promoProvider).toContain('stateRef.current.uid !== attemptUid');
    expect(promoProvider).not.toMatch(/AsyncStorage|SecureStore|localStorage/);
  });

  it('prepares catalog resolution but does not connect the promo SKU to purchase yet', () => {
    expect(paywall).toContain('resolveIOSSubscriptionPackage');
    expect(paywall).not.toContain('authorizePromoPurchase');
    const purchaseHandler = paywall.slice(
      paywall.indexOf('const handlePurchase'),
      paywall.indexOf('const handleRestore'),
    );
    expect(purchaseHandler).not.toContain('iosCatalogResolution');
    expect(purchaseHandler).not.toContain('resolveIOSSubscriptionPackage');
  });

  it('preserves the legacy Apple Offer Code path', () => {
    expect(paywall).toContain('redeemAppleOfferCode');
    expect(revenueCatService).toContain('Purchases.presentCodeRedemptionSheet()');
  });

  it('keeps Premium authority exclusively on CustomerInfo entitlement', () => {
    expect(subscriptionContext).toContain(
      'Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID])',
    );
    expect(subscriptionContext).not.toContain('iosPromotion');
  });
});
