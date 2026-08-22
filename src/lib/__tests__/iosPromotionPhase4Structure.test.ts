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
    const navigator = app.indexOf('<RootNavigator />');
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

  it('connects the Fase 4 catalog resolver to the late Fase 5 purchase intent', () => {
    expect(paywall).toContain('resolveIOSPromotionalCatalog');
    expect(paywall).toContain('authorizePromoPurchase');
    const purchaseHandler = paywall.slice(
      paywall.indexOf('const handlePurchase'),
      paywall.indexOf('const handleRestore'),
    );
    expect(purchaseHandler).toContain('executeIOSPromoPurchase');
    expect(purchaseHandler).toContain('actionInFlight.current = true');
  });

  it('FASE 6 removes the legacy Apple Offer Code path while preserving the global listener', () => {
    expect(paywall).not.toContain('redeemAppleOfferCode');
    expect(revenueCatService).not.toContain('presentCodeRedemptionSheet');
    expect(subscriptionContext).toContain('attachCustomerInfoListener');
    expect(subscriptionContext).toContain('NativeAppState.addEventListener');
  });

  it('keeps Premium authority exclusively on CustomerInfo entitlement', () => {
    expect(subscriptionContext).toContain(
      'Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID])',
    );
    expect(subscriptionContext).not.toContain('iosPromotion');
  });
});
