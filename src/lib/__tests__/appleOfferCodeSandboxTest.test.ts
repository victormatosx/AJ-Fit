import { describe, expect, it } from 'vitest';
import type { PACKAGE_TYPE, PurchasesPackage } from 'react-native-purchases';
import {
  applyAppleOfferCodeSandboxOverride,
  computeAppleOfferCodeSandboxTestEnabled,
} from '../appleOfferCodeSandboxTest';
import { resolveApplePurchaseRoute, type ApplePurchaseRoute } from '../subscriptionOffer';

/**
 * FASE iOS-4 — the Sandbox-only bypass that lets a real Apple Offer Code
 * (one of the 10 single-use Sandbox Codes for "Influencer Trial 7D") be
 * redeemed via `Purchases.presentCodeRedemptionSheet()` even though
 * `promoCodes/ARNALDO.appleOfferCodeMonthly` is still `null` (deliberately —
 * no Custom Code exists yet). These tests prove the fail-closed truth table:
 * every axis (dev bundle, explicit flag, plan recognized, promo applied)
 * must independently hold, and Android is never touched by this module at
 * all (it doesn't import/export anything Android-specific).
 */

function makePackage(packageType: PACKAGE_TYPE): PurchasesPackage {
  return {
    identifier: packageType === 'MONTHLY' ? '$rc_monthly' : packageType === 'ANNUAL' ? '$rc_annual' : '$rc_other',
    packageType,
    product: { identifier: 'ajfit_premium:monthly', subscriptionOptions: null },
  } as unknown as PurchasesPackage;
}

const MONTHLY_PKG = makePackage('MONTHLY' as PACKAGE_TYPE);
const ANNUAL_PKG = makePackage('ANNUAL' as PACKAGE_TYPE);
const WEEKLY_PKG = makePackage('WEEKLY' as PACKAGE_TYPE); // unrecognized by resolveAndroidPlanKind

const BLOCKED_ROUTE: ApplePurchaseRoute = { kind: 'blocked', reason: 'promo_plan_unavailable' };

describe('computeAppleOfferCodeSandboxTestEnabled', () => {
  it('1: production bundle (isDevBundle=false) + flag=true → disabled (production never bypasses)', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(false, 'true')).toBe(false);
  });

  it('2: dev bundle + flag explicitly "false" → disabled', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(true, 'false')).toBe(false);
  });

  it('3: dev bundle + flag absent (undefined) → disabled (absence is never enabled)', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(true, undefined)).toBe(false);
  });

  it('4: dev bundle + flag with an invalid/near-miss value → disabled (no truthy-string leniency)', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(true, 'TRUE')).toBe(false);
    expect(computeAppleOfferCodeSandboxTestEnabled(true, '1')).toBe(false);
    expect(computeAppleOfferCodeSandboxTestEnabled(true, 'yes')).toBe(false);
    expect(computeAppleOfferCodeSandboxTestEnabled(true, '')).toBe(false);
  });

  it('5: dev bundle + flag exactly "true" → enabled', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(true, 'true')).toBe(true);
  });

  it('production bundle + flag absent → disabled (both axes off)', () => {
    expect(computeAppleOfferCodeSandboxTestEnabled(false, undefined)).toBe(false);
  });
});

describe('applyAppleOfferCodeSandboxOverride', () => {
  it('1/2/3/4: sandboxTestEnabled=false (any reason) leaves a blocked route blocked', () => {
    const result = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, BLOCKED_ROUTE, {
      sandboxTestEnabled: false,
      promoApplied: true,
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('5: sandbox enabled + promo applied + monthly + appleOfferCodeMonthly null (blocked route) → sandbox_offer_redemption', () => {
    const result = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, BLOCKED_ROUTE, {
      sandboxTestEnabled: true,
      promoApplied: true,
    });
    expect(result).toEqual({ kind: 'sandbox_offer_redemption', package: MONTHLY_PKG });
  });

  it('5 (annual mirror): same override applies for the annual plan', () => {
    const result = applyAppleOfferCodeSandboxOverride(ANNUAL_PKG, BLOCKED_ROUTE, {
      sandboxTestEnabled: true,
      promoApplied: true,
    });
    expect(result).toEqual({ kind: 'sandbox_offer_redemption', package: ANNUAL_PKG });
  });

  it('6: sandbox enabled but the package type is unrecognized (never MONTHLY/ANNUAL) → stays blocked', () => {
    const result = applyAppleOfferCodeSandboxOverride(WEEKLY_PKG, BLOCKED_ROUTE, {
      sandboxTestEnabled: true,
      promoApplied: true,
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('7: sandbox enabled but no promo applied → the bypass is never reachable, even against a contrived blocked route', () => {
    const result = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, BLOCKED_ROUTE, {
      sandboxTestEnabled: true,
      promoApplied: false,
    });
    expect(result).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('9: a REAL authorized Apple offer code (offer_redemption route) is never touched by the override, sandbox flag or not', () => {
    const realRoute: ApplePurchaseRoute = {
      kind: 'offer_redemption',
      offerCode: 'AJFIT7DTRIAL',
      package: MONTHLY_PKG,
    };
    const enabled = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, realRoute, {
      sandboxTestEnabled: true,
      promoApplied: true,
    });
    const disabled = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, realRoute, {
      sandboxTestEnabled: false,
      promoApplied: true,
    });
    expect(enabled).toEqual(realRoute);
    expect(disabled).toEqual(realRoute);
  });

  it('sandbox enabled + promo NOT applied → resolveApplePurchaseRoute itself already returns "package", and the override leaves that untouched too', () => {
    const packageRoute = resolveApplePurchaseRoute(MONTHLY_PKG, false, null);
    const result = applyAppleOfferCodeSandboxOverride(MONTHLY_PKG, packageRoute, {
      sandboxTestEnabled: true,
      promoApplied: false,
    });
    expect(result).toEqual({ kind: 'package', package: MONTHLY_PKG });
  });

  it('never invents a blocked reason other than promo_plan_unavailable to override (e.g. promo_not_found from the Android union is a different type entirely — compile-time guaranteed, this just documents it)', () => {
    // ApplePurchaseRoute['blocked'] only ever has reason 'promo_plan_unavailable' —
    // unlike Android's PurchaseRoute, which has promo_not_found/promo_ambiguous/promo_no_options too.
    // This test exists to make that invariant explicit for future readers.
    expect(BLOCKED_ROUTE.reason).toBe('promo_plan_unavailable');
  });
});
