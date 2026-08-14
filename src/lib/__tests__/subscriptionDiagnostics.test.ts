import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { executeIOSPromoPurchase, type IOSPromoPurchaseAttempt } from '../iosPromoPurchase';
import {
  logSubscriptionDiagnostic,
  logSubscriptionPurchaseOutcome,
  normalizeIntroEligibilityForDiagnostic,
} from '../subscriptionDiagnostics';

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const paywallSource = read('screens/PaywallScreen.tsx');
const promoPurchaseSource = read('lib/iosPromoPurchase.ts');
const expiresAt = '2030-01-01T00:10:00.000Z';

function customerInfo(premiumActive: boolean): CustomerInfo {
  return {
    entitlements: {
      active: premiumActive ? { premium: {} } : {},
    },
  } as unknown as CustomerInfo;
}

function promoAttempt(plan: 'monthly' | 'annual'): IOSPromoPurchaseAttempt {
  const expectedProductId = `ajfit_premium_${plan}_promo`;
  return {
    plan,
    authorization: {
      offeringIdentifier: 'promo_7d',
      monthlyProductId: 'ajfit_premium_monthly_promo',
      annualProductId: 'ajfit_premium_annual_promo',
    },
    package: {
      identifier: plan === 'monthly' ? '$rc_monthly' : '$rc_annual',
      packageType: plan === 'monthly' ? 'MONTHLY' : 'ANNUAL',
      product: { identifier: expectedProductId },
    } as PurchasesPackage,
  };
}

function diagnosticEvents(spy: { mock: { calls: unknown[][] } }): Array<{ event: string }> {
  return spy.mock.calls
    .filter(
      (call) =>
        typeof call[0] === 'string' && call[0].startsWith('[subscription:diagnostic] '),
    )
    .map((call) => call[1] as { event: string });
}

afterEach(() => vi.restoreAllMocks());

describe('sanitized subscription diagnostics', () => {
  it.each(['monthly', 'annual'] as const)(
    'observes standard %s without creating a promo intent event',
    (plan) => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      logSubscriptionDiagnostic({
        event: 'subscription_purchase_route_resolved',
        route: 'standard',
        plan,
      });
      logSubscriptionDiagnostic({
        event: 'subscription_purchase_started',
        route: 'standard',
        plan,
      });

      expect(diagnosticEvents(info).map(({ event }) => event)).toEqual([
        'subscription_purchase_route_resolved',
        'subscription_purchase_started',
      ]);
      expect(diagnosticEvents(info)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'promo_purchase_intent_authorized' }),
        ]),
      );
    },
  );

  it.each(['monthly', 'annual'] as const)(
    'observes promo %s in route, eligibility, intent, SDK start and result order',
    async (plan) => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const attempt = promoAttempt(plan);
      const expectedProductId = attempt.package.product.identifier;
      const outcome = { status: 'purchased' as const, customerInfo: customerInfo(true) };

      logSubscriptionDiagnostic({
        event: 'subscription_purchase_route_resolved',
        route: 'promo',
        plan,
      });
      logSubscriptionDiagnostic({
        event: 'subscription_intro_eligibility',
        plan,
        eligibility: 'eligible',
        hasValidFreeIntro: true,
      });
      const execution = await executeIOSPromoPurchase({
        attempt,
        authorize: vi.fn().mockResolvedValue({
          status: 'authorized',
          response: {
            authorized: true,
            purchaseIntent: {
              plan,
              offeringIdentifier: 'promo_7d',
              expectedProductId,
              status: 'purchase_pending',
              expiresAt,
            },
          },
        }),
        purchase: vi.fn().mockResolvedValue(outcome),
        isCurrent: () => true,
        now: () => Date.parse(expiresAt) - 1,
      });
      expect(execution).toEqual({ status: 'purchased', result: outcome });
      logSubscriptionPurchaseOutcome({ route: 'promo', plan }, outcome, 'premium');

      expect(diagnosticEvents(info).map(({ event }) => event)).toEqual([
        'subscription_purchase_route_resolved',
        'subscription_intro_eligibility',
        'promo_purchase_intent_authorized',
        'subscription_purchase_started',
        'subscription_purchase_completed',
      ]);
    },
  );

  it('logs cancellation without completion or a parallel Premium state', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logSubscriptionPurchaseOutcome(
      { route: 'standard', plan: 'monthly' },
      { status: 'cancelled' },
      'premium',
    );
    const events = diagnosticEvents(info);
    expect(events).toEqual([
      { event: 'subscription_purchase_cancelled', route: 'standard', plan: 'monthly' },
    ]);
    expect(JSON.stringify(events)).not.toContain('premiumActive');
  });

  it.each([
    [true, 'network_error'],
    [false, 'store_error'],
  ] as const)('logs only a symbolic failure category (offline=%s)', (offline, errorCategory) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logSubscriptionPurchaseOutcome(
      { route: 'promo', plan: 'annual' },
      { status: 'error', offline },
      'premium',
    );
    expect(diagnosticEvents(info)).toEqual([
      {
        event: 'subscription_purchase_failed',
        route: 'promo',
        plan: 'annual',
        errorCategory,
      },
    ]);
  });

  it.each([true, false])(
    'derives completed premiumActive=%s only from returned CustomerInfo',
    (premiumActive) => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      logSubscriptionPurchaseOutcome(
        { route: 'promo', plan: 'monthly' },
        { status: 'purchased', customerInfo: customerInfo(premiumActive) },
        'premium',
      );
      expect(diagnosticEvents(info)).toEqual([
        {
          event: 'subscription_purchase_completed',
          route: 'promo',
          plan: 'monthly',
          premiumActive,
        },
      ]);
    },
  );

  it('normalizes every eligibility state without exposing StoreKit data', () => {
    expect(normalizeIntroEligibilityForDiagnostic({ status: 'eligible' })).toBe('eligible');
    expect(normalizeIntroEligibilityForDiagnostic({ status: 'ineligible' })).toBe('ineligible');
    expect(normalizeIntroEligibilityForDiagnostic({ status: 'unknown' })).toBe('unknown');
    expect(normalizeIntroEligibilityForDiagnostic({ status: 'no_intro_offer' })).toBe(
      'no_intro_offer_exists',
    );
    expect(normalizeIntroEligibilityForDiagnostic({ status: 'error' })).toBe('error');
  });

  it('uses allowlisted payloads and never transports forbidden identifiers', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_completed',
      route: 'promo',
      plan: 'annual',
      premiumActive: true,
    });
    const payload = diagnosticEvents(info)[0] as unknown as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'event',
      'plan',
      'premiumActive',
      'route',
    ]);
    for (const forbidden of [
      'uid',
      'email',
      'coupon',
      'code',
      'receipt',
      'token',
      'customerInfo',
      'offeringIdentifier',
      'productId',
      'subscriptionOption',
      'offerToken',
    ]) expect(payload).not.toHaveProperty(forbidden);
  });

  it('cannot interrupt the purchase even if the console implementation throws', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console unavailable');
    });
    const attempt = promoAttempt('monthly');
    const purchase = vi.fn().mockResolvedValue({ status: 'cancelled' });
    const result = await executeIOSPromoPurchase({
      attempt,
      authorize: vi.fn().mockResolvedValue({
        status: 'authorized',
        response: {
          authorized: true,
          purchaseIntent: {
            plan: 'monthly',
            offeringIdentifier: 'promo_7d',
            expectedProductId: attempt.package.product.identifier,
            status: 'purchase_pending',
            expiresAt,
          },
        },
      }),
      purchase,
      isCurrent: () => true,
      now: () => Date.parse(expiresAt) - 1,
    });
    expect(result.status).toBe('purchased');
    expect(purchase).toHaveBeenCalledOnce();
  });

  it('keeps production call sites on the existing iOS flow only', () => {
    for (const event of [
      'subscription_purchase_route_resolved',
      'subscription_intro_eligibility',
      'promo_purchase_intent_failed',
    ]) expect(paywallSource).toContain(event);
    expect(paywallSource).toContain('logSubscriptionPurchaseOutcome');
    expect(paywallSource).toContain("Platform.OS !== 'ios'");
    expect(promoPurchaseSource).toContain('promo_purchase_intent_authorized');
    expect(promoPurchaseSource).toContain('subscription_purchase_started');
  });
});
