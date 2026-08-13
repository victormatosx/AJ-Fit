import { describe, expect, it } from 'vitest';
import type {
  PACKAGE_TYPE,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';
import {
  resolveIOSOfferingRoute,
  resolveIOSPromotionalCatalog,
  resolveIOSSubscriptionPackage,
  type IOSSubscriptionPlan,
} from '../subscriptionOffer';
import type { IOSPromotionAuthorization } from '../promoCodeState';

function makePackage(
  packageType: PACKAGE_TYPE,
  productId: string,
  identifier = `$rc_${String(packageType).toLowerCase()}`,
): PurchasesPackage {
  return {
    identifier,
    packageType,
    product: { identifier: productId },
  } as PurchasesPackage;
}

function makeOffering(identifier: string, packages: PurchasesPackage[]): PurchasesOffering {
  return { identifier, availablePackages: packages } as PurchasesOffering;
}

function makeOfferings({
  current,
  others = [],
}: {
  current: PurchasesOffering | null;
  others?: PurchasesOffering[];
}): PurchasesOfferings {
  return {
    current,
    all: Object.fromEntries(
      [...(current ? [current] : []), ...others].map((offering) => [offering.identifier, offering]),
    ),
  } as PurchasesOfferings;
}

const normalMonthly = makePackage('MONTHLY' as PACKAGE_TYPE, 'monthly_normal');
const normalAnnual = makePackage('ANNUAL' as PACKAGE_TYPE, 'annual_normal');
const promoMonthly = makePackage('MONTHLY' as PACKAGE_TYPE, 'monthly_promo');
const promoAnnual = makePackage('ANNUAL' as PACKAGE_TYPE, 'annual_promo');
const current = makeOffering('externally_current', [normalMonthly, normalAnnual]);
const promo = makeOffering('promo_7d', [promoMonthly, promoAnnual]);
const offerings = makeOfferings({ current, others: [promo] });

const authorization: IOSPromotionAuthorization = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'monthly_promo',
  annualProductId: 'annual_promo',
};

function resolvePromo(
  catalog: PurchasesOfferings,
  plan: IOSSubscriptionPlan,
  auth: unknown = authorization,
) {
  return resolveIOSSubscriptionPackage(catalog, resolveIOSOfferingRoute(auth), plan);
}

describe('iOS Offering route authority', () => {
  it('null means standard; promoApplied and coupon text are structurally absent from the API', () => {
    const unrelatedUiState = { promoApplied: true, couponCode: 'ARNALDO' };
    expect(unrelatedUiState.promoApplied).toBe(true);
    expect(unrelatedUiState.couponCode).toBe('ARNALDO');
    expect(resolveIOSOfferingRoute(null)).toEqual({ kind: 'standard' });
    expect(resolveIOSSubscriptionPackage(offerings, resolveIOSOfferingRoute(null), 'monthly')).toEqual({
      status: 'resolved',
      route: { kind: 'standard' },
      offering: current,
      package: normalMonthly,
    });
  });

  it('a complete backend authorization creates the explicit promotional route', () => {
    expect(resolveIOSOfferingRoute(authorization)).toEqual({
      kind: 'promotional',
      authorization,
    });
  });

  it.each([
    ['undefined', undefined],
    ['partial', { offeringIdentifier: 'promo_7d', monthlyProductId: 'monthly_promo' }],
    ['blank', { ...authorization, annualProductId: '' }],
    ['whitespace', { ...authorization, offeringIdentifier: ' promo_7d ' }],
    ['wrong type', { ...authorization, monthlyProductId: 7 }],
    ['extra key', { ...authorization, source: 'coupon' }],
  ])('%s authorization is blocked, never standard/promotional', (_label, malformed) => {
    expect(resolveIOSOfferingRoute(malformed)).toEqual({
      kind: 'blocked',
      reason: 'promo_authorization_invalid',
    });
  });
});

describe('standard iOS package resolution', () => {
  it.each([
    ['monthly', normalMonthly],
    ['annual', normalAnnual],
  ] as const)('resolves %s from offerings.current without hardcoding default', (plan, expected) => {
    const result = resolveIOSSubscriptionPackage(offerings, { kind: 'standard' }, plan);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.offering).toBe(current);
      expect(result.package).toBe(expected);
      expect(result.package.product.identifier).not.toContain('_promo');
    }
  });
});

describe('promotional iOS package resolution', () => {
  it('resolves monthly and annual as one coherent promotional catalog', () => {
    expect(resolveIOSPromotionalCatalog(offerings, resolveIOSOfferingRoute(authorization))).toEqual({
      status: 'resolved',
      route: { kind: 'promotional', authorization },
      offering: promo,
      monthlyPackage: promoMonthly,
      annualPackage: promoAnnual,
    });
  });

  it('rejects the entire promotional catalog when either plan is missing', () => {
    expect(
      resolveIOSPromotionalCatalog(
        makeOfferings({ current, others: [makeOffering('promo_7d', [promoMonthly])] }),
        resolveIOSOfferingRoute(authorization),
      ),
    ).toEqual({ status: 'error', reason: 'promo_package_missing' });
  });

  it.each([
    ['monthly', promoMonthly],
    ['annual', promoAnnual],
  ] as const)('resolves %s only when packageType and product identifier both match', (plan, expected) => {
    const result = resolvePromo(offerings, plan);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.offering).toBe(promo);
      expect(result.package).toBe(expected);
    }
  });

  it('uses the backend identifier dynamically, not promo_7d', () => {
    const specialMonthly = makePackage('MONTHLY' as PACKAGE_TYPE, 'special_monthly');
    const special = makeOffering('special_promo_test', [
      specialMonthly,
      makePackage('ANNUAL' as PACKAGE_TYPE, 'special_annual'),
    ]);
    const specialAuthorization: IOSPromotionAuthorization = {
      offeringIdentifier: 'special_promo_test',
      monthlyProductId: 'special_monthly',
      annualProductId: 'special_annual',
    };
    const result = resolvePromo(makeOfferings({ current, others: [special] }), 'monthly', specialAuthorization);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.offering).toBe(special);
      expect(result.package).toBe(specialMonthly);
    }
  });

  it('missing authorized Offering fails closed, never falls back to Current', () => {
    expect(resolvePromo(makeOfferings({ current }), 'monthly')).toEqual({
      status: 'error',
      reason: 'promo_offering_missing',
    });
  });

  it.each([
    ['monthly', [promoAnnual]],
    ['annual', [promoMonthly]],
  ] as const)('missing %s package fails closed', (plan, packages) => {
    expect(resolvePromo(makeOfferings({ current, others: [makeOffering('promo_7d', [...packages])] }), plan)).toEqual({
      status: 'error',
      reason: 'promo_package_missing',
    });
  });

  it.each([
    ['monthly', makePackage('MONTHLY' as PACKAGE_TYPE, 'monthly_normal')],
    ['annual', makePackage('ANNUAL' as PACKAGE_TYPE, 'annual_normal')],
  ] as const)('a %s Product ID mismatch fails closed', (plan, mismatchedPackage) => {
    const otherPlanPackage = plan === 'monthly' ? promoAnnual : promoMonthly;
    expect(
      resolvePromo(
        makeOfferings({ current, others: [makeOffering('promo_7d', [mismatchedPackage, otherPlanPackage])] }),
        plan,
      ),
    ).toEqual({ status: 'error', reason: 'promo_product_mismatch' });
  });

  it.each([
    ['monthly', 'monthly_promo', 'ANNUAL'],
    ['annual', 'annual_promo', 'MONTHLY'],
  ] as const)('a %s Product ID under the wrong packageType fails closed', (plan, productId, wrongType) => {
    const wrong = makePackage(wrongType as PACKAGE_TYPE, productId);
    expect(resolvePromo(makeOfferings({ current, others: [makeOffering('promo_7d', [wrong])] }), plan)).toEqual({
      status: 'error',
      reason: 'promo_package_type_mismatch',
    });
  });

  it('never guesses when duplicate exact promotional packages exist', () => {
    const duplicate = makePackage('MONTHLY' as PACKAGE_TYPE, 'monthly_promo', 'duplicate');
    expect(
      resolvePromo(makeOfferings({ current, others: [makeOffering('promo_7d', [promoMonthly, duplicate])] }), 'monthly'),
    ).toEqual({ status: 'error', reason: 'promo_package_ambiguous' });
  });
});
