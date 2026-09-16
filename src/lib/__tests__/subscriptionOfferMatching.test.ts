import { describe, expect, it } from 'vitest';
import type {
  CustomerInfo,
  PACKAGE_TYPE,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
  SubscriptionOption,
} from 'react-native-purchases';
import {
  applyAndroidPromoPackageOverrides,
  classifyPurchaseResult,
  findAuthorizedSubscriptionOption,
  packagePriceString,
  resolveAndroidNewOfferPackage,
  resolveAndroidPlanKind,
  resolveAndroidPurchaseRoute,
  resolveAndroidTrialSignal,
  resolveAuthorizedAndroidOffer,
  resolvePurchaseRoute,
  subscriptionOptionHasFreeTrial,
  type AuthorizedAndroidOffer,
} from '../subscriptionOffer';

const PRODUCT_ID = 'ajfit_premium';

const MONTHLY_OFFER: AuthorizedAndroidOffer = {
  kind: 'legacy',
  basePlanId: 'monthly',
  offerId: 'influencer-trial-7d',
};
const ANNUAL_OFFER: AuthorizedAndroidOffer = {
  kind: 'legacy',
  basePlanId: 'annual',
  offerId: 'influencer-trial-7d-annual',
};

/**
 * FASE 4C.4E — `storeProductId` is `subId:basePlanId` per the installed SDK's
 * typings, confirmed against a real Android device (Fase 4C.4D): candidates
 * reported `productId: "ajfit_premium"` (the bare subId) while
 * `pkg.product.identifier` for a Google Play base-plan product is
 * `"ajfit_premium:monthly"`/`"ajfit_premium:annual"` (`subId:basePlanId`).
 * `id` may itself be `basePlanId` or `basePlanId:offerId` — this only takes
 * the basePlanId half, so a mocked offer option's `storeProductId` never
 * accidentally includes the offerId segment (the real SDK never does either).
 */
function storeProductIdFor(productId: string, optionId: string): string {
  return `${productId}:${optionId.split(':')[0]}`;
}

function makeOption({
  id,
  productId = PRODUCT_ID,
  storeProductId,
  tags = [],
  freePhase = null,
  fullPricePhase = null,
}: {
  id: string;
  productId?: string;
  storeProductId?: string;
  tags?: string[];
  freePhase?: unknown;
  fullPricePhase?: unknown;
}): SubscriptionOption {
  return {
    id,
    storeProductId: storeProductId ?? storeProductIdFor(productId, id),
    productId,
    tags,
    isBasePlan: !id.includes(':'),
    billingPeriod: null,
    isPrepaid: false,
    fullPricePhase,
    freePhase,
    introPhase: null,
    presentedOfferingIdentifier: null,
    presentedOfferingContext: null,
    installmentsInfo: null,
  } as unknown as SubscriptionOption;
}

/** FASE 6.4 — a base-plan option's own recurring-price pricing phase, as `SubscriptionOption.fullPricePhase` documents it. */
function makeFullPricePhase(formatted: string): unknown {
  return { price: { formatted, amountMicros: 0, currencyCode: 'BRL' } };
}

/**
 * FASE 4C.4E — `productIdentifier` now defaults to `subId:basePlanId`
 * (`"ajfit_premium:monthly"`/`"ajfit_premium:annual"`), matching the real
 * device value for `pkg.product.identifier`, instead of the bare `subId`
 * constant used pre-4C.4E — that bare default was IDENTICAL on both the
 * package and the option's `productId` in every pre-4C.4E test, which is
 * exactly why the production bug (comparing `productId` against
 * `pkg.product.identifier`) went undetected by the unit suite despite being
 * wrong on a real device.
 */
function makePackage({
  packageType,
  subscriptionOptions,
  productIdentifier,
  priceString = 'R$ 0,00 (product.priceString, not the source of truth for FASE 6.4)',
}: {
  packageType: PACKAGE_TYPE;
  subscriptionOptions: SubscriptionOption[] | null;
  productIdentifier?: string;
  priceString?: string;
}): PurchasesPackage {
  const basePlanId = packageType === 'MONTHLY' ? 'monthly' : 'annual';
  return {
    identifier: packageType === 'MONTHLY' ? '$rc_monthly' : '$rc_annual',
    packageType,
    product: {
      identifier: productIdentifier ?? `${PRODUCT_ID}:${basePlanId}`,
      subscriptionOptions,
      priceString,
    },
  } as unknown as PurchasesPackage;
}

describe('findAuthorizedSubscriptionOption', () => {
  it('M: finds the exact monthly option by id equality', () => {
    const monthlyOption = makeOption({ id: 'monthly:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly' }), monthlyOption],
    });

    const result = findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER);

    expect(result).toEqual({ status: 'match', option: monthlyOption });
  });

  it('N: finds the exact annual option by id equality', () => {
    const annualOption = makeOption({ id: 'annual:influencer-trial-7d-annual' });
    const pkg = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'annual' }), annualOption],
    });

    const result = findAuthorizedSubscriptionOption(pkg, ANNUAL_OFFER);

    expect(result).toEqual({ status: 'match', option: annualOption });
  });

  it('O: returns not_found for zero matches', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly' })],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });

  it("FASE 6.2: a 'new'-shape offer fails closed to not_found — never guessed/forced through the legacy id match, never falls back to standard", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      // Even if a SubscriptionOption happens to exist with an id equal to
      // just the basePlanId, a 'new'-shape offer must never be routed
      // through this function at all — resolving it is Offering/Package
      // work (FASE 6.3), not a SubscriptionOption lookup.
      subscriptionOptions: [makeOption({ id: 'monthly-promo' })],
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: 'coupon_discount',
    };

    expect(findAuthorizedSubscriptionOption(pkg, newOffer)).toEqual({ status: 'not_found' });
  });

  it('P: returns ambiguous (fail-closed) for more than one match', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [
        makeOption({ id: 'monthly:influencer-trial-7d' }),
        makeOption({ id: 'monthly:influencer-trial-7d' }),
      ],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({
      status: 'ambiguous',
      matchCount: 2,
    });
  });

  it('Q: returns no_options when subscriptionOptions is null (iOS shape, or unresolved product)', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: null });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'no_options' });
  });

  it('R: returns no_options for an empty subscriptionOptions array', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'no_options' });
  });

  it('S: still finds the option when its tags include rc-ignore-offer — never filtered out', () => {
    const taggedOption = makeOption({
      id: 'monthly:influencer-trial-7d',
      tags: ['rc-ignore-offer'],
    });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [taggedOption],
    });

    const result = findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER);

    expect(result).toEqual({ status: 'match', option: taggedOption });
  });

  it('T: a different option with the same offerId SUFFIX under a different base plan is never selected', () => {
    // Same offerId text, but a DIFFERENT basePlanId — id equality must
    // reject this; only a naive `.endsWith(':influencer-trial-7d')` would
    // wrongly accept it.
    const wrongBasePlanOption = makeOption({ id: 'some-other-plan:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [wrongBasePlanOption],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });

  it('returns not_found when authorized is null (no code applied)', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly:influencer-trial-7d' })],
    });

    expect(findAuthorizedSubscriptionOption(pkg, null)).toEqual({ status: 'not_found' });
  });

  it('FASE 4C.4E: rejects an id match whose storeProductId does not belong to this package (defense-in-depth, corrected field)', () => {
    // Pre-4C.4E this compared `option.productId` (bare subId, e.g.
    // "ajfit_premium" — never scoped to a base plan) against
    // `pkg.product.identifier` ("ajfit_premium:monthly") — a comparison that
    // could NEVER be true for a real device, which is the root cause fixed
    // in this phase. This scenario itself (an option whose `storeProductId`
    // belongs to a different product) is not something the SDK's own
    // `subscriptionOptions` contract documents as achievable — every element
    // already structurally belongs to `pkg.product` by construction — so
    // this test exists purely to lock in the corrected defense-in-depth
    // field, not because a real `pkg.product.subscriptionOptions` payload
    // could plausibly contain this.
    const foreignProductOption = makeOption({
      id: 'monthly:influencer-trial-7d',
      storeProductId: 'some_other_product:monthly',
    });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [foreignProductOption],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });
});

describe('subscriptionOptionHasFreeTrial', () => {
  it('reports true only when freePhase is present — a UX signal, not authorization', () => {
    expect(subscriptionOptionHasFreeTrial(makeOption({ id: 'monthly:x', freePhase: {} }))).toBe(true);
    expect(subscriptionOptionHasFreeTrial(makeOption({ id: 'monthly:x', freePhase: null }))).toBe(
      false,
    );
  });
});

describe('resolveAndroidPlanKind', () => {
  it('maps MONTHLY/ANNUAL packageType to the corresponding plan kind', () => {
    expect(
      resolveAndroidPlanKind(makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] })),
    ).toBe('monthly');
    expect(
      resolveAndroidPlanKind(makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] })),
    ).toBe('annual');
  });

  it('L: fail-closed — any other packageType maps to null, never a guess', () => {
    expect(
      resolveAndroidPlanKind(makePackage({ packageType: 'WEEKLY' as PACKAGE_TYPE, subscriptionOptions: [] })),
    ).toBeNull();
    expect(
      resolveAndroidPlanKind(makePackage({ packageType: 'LIFETIME' as PACKAGE_TYPE, subscriptionOptions: [] })),
    ).toBeNull();
  });
});

describe('resolveAuthorizedAndroidOffer', () => {
  it('J: selected monthly package resolves the monthly config', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const result = resolveAuthorizedAndroidOffer(pkg, { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER });
    expect(result).toEqual(MONTHLY_OFFER);
  });

  it('K: selected annual package resolves the annual config', () => {
    const pkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });
    const result = resolveAuthorizedAndroidOffer(pkg, { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER });
    expect(result).toEqual(ANNUAL_OFFER);
  });

  it('L: an unrecognized package type never authorizes anything (fail-closed)', () => {
    const pkg = makePackage({ packageType: 'WEEKLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const result = resolveAuthorizedAndroidOffer(pkg, { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER });
    expect(result).toBeNull();
  });

  it('returns null when there is no android storeConfig at all', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAndroidOffer(pkg, null)).toBeNull();
  });
});

// Fase 4C.3 — purchase routing (§4/§6/§22).
describe('resolvePurchaseRoute', () => {
  it('A: sem promo aplicado → route package', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly:influencer-trial-7d' })],
    });

    const route = resolvePurchaseRoute(pkg, false, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'package', package: pkg });
  });

  it('B: promo aplicado + match mensal → subscription_option mensal', () => {
    const monthlyOption = makeOption({ id: 'monthly:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [monthlyOption],
    });

    const route = resolvePurchaseRoute(pkg, true, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'subscription_option', option: monthlyOption });
  });

  it('C: promo aplicado + match anual → subscription_option anual', () => {
    const annualOption = makeOption({ id: 'annual:influencer-trial-7d-annual' });
    const pkg = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [annualOption],
    });

    const route = resolvePurchaseRoute(pkg, true, ANNUAL_OFFER);

    expect(route).toEqual({ kind: 'subscription_option', option: annualOption });
  });

  it("FASE 6.2: promo aplicado + offer 'new'-shape → blocked (nunca cai para package standard, resolução ainda não implementada)", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly-promo' })],
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: 'coupon_discount',
    };

    const route = resolvePurchaseRoute(pkg, true, newOffer);

    expect(route).toEqual({ kind: 'blocked', reason: 'promo_not_found' });
  });

  it('D: promo aplicado + not_found → blocked (nunca cai para package)', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly' })],
    });

    const route = resolvePurchaseRoute(pkg, true, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'blocked', reason: 'promo_not_found' });
  });

  it('E: promo aplicado + ambiguous → blocked', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [
        makeOption({ id: 'monthly:influencer-trial-7d' }),
        makeOption({ id: 'monthly:influencer-trial-7d' }),
      ],
    });

    const route = resolvePurchaseRoute(pkg, true, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'blocked', reason: 'promo_ambiguous' });
  });

  it('F: promo aplicado + no_options → blocked', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: null });

    const route = resolvePurchaseRoute(pkg, true, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'blocked', reason: 'promo_no_options' });
  });

  it('G: promo aplicado + configuração do plano null → blocked, distinto de not_found', () => {
    const pkg = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'annual:influencer-trial-7d-annual' })],
    });

    // authorizedOffer null representa "esse plano não tem config alguma" —
    // já resolvido por resolveAuthorizedAndroidOffer antes de chegar aqui.
    const route = resolvePurchaseRoute(pkg, true, null);

    expect(route).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('H/I: a option mensal nunca é usada para compra anual, e vice-versa (via resolveAuthorizedAndroidOffer)', () => {
    const monthlyOption = makeOption({ id: 'monthly:influencer-trial-7d' });
    const annualOption = makeOption({ id: 'annual:influencer-trial-7d-annual' });
    const androidStoreConfig = { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER };

    const monthlyPkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [monthlyOption, annualOption],
    });
    const annualPkg = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [monthlyOption, annualOption],
    });

    const monthlyRoute = resolvePurchaseRoute(
      monthlyPkg,
      true,
      resolveAuthorizedAndroidOffer(monthlyPkg, androidStoreConfig),
    );
    const annualRoute = resolvePurchaseRoute(
      annualPkg,
      true,
      resolveAuthorizedAndroidOffer(annualPkg, androidStoreConfig),
    );

    expect(monthlyRoute).toEqual({ kind: 'subscription_option', option: monthlyOption });
    expect(annualRoute).toEqual({ kind: 'subscription_option', option: annualOption });
    // Trocar de plano recalcula do zero — nunca reaproveita a option do outro plano.
    expect(monthlyRoute).not.toEqual(annualRoute);
  });

  it('rc-ignore-offer não impede o roteamento explícito (AC)', () => {
    const taggedOption = makeOption({
      id: 'monthly:influencer-trial-7d',
      tags: ['rc-ignore-offer'],
    });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [taggedOption],
    });

    const route = resolvePurchaseRoute(pkg, true, MONTHLY_OFFER);

    expect(route).toEqual({ kind: 'subscription_option', option: taggedOption });
  });
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FASE 4C.4E — regression suite pinned to the exact candidate shape captured
// from a real Android device via [RC_OFFER_DEBUG_4C4D] (Fase 4C.4D smoke
// test): `productId: "ajfit_premium"` (bare subId), `tags: ["rc-ignore-offer"]`,
// `id: "monthly:influencer-trial-7d"` / `"annual:influencer-trial-7d-annual"`.
// Proves the fix to `findAuthorizedSubscriptionOption`'s defense-in-depth
// check (`storeProductId` instead of `productId` — see that function's doc
// comment in subscriptionOffer.ts for the full root-cause writeup).
// ---------------------------------------------------------------------------
describe('findAuthorizedSubscriptionOption — Fase 4C.4E device-proven fix', () => {
  it('A: mensal — device-captured payload shape matches', () => {
    const monthlyOffer = makeOption({
      id: 'monthly:influencer-trial-7d',
      tags: ['rc-ignore-offer'],
      freePhase: { billingPeriod: { iso8601: 'P1W' } },
    });
    const monthlyBase = makeOption({ id: 'monthly' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [monthlyBase, monthlyOffer],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({
      status: 'match',
      option: monthlyOffer,
    });
  });

  it('B: anual — device-captured payload shape matches', () => {
    const annualOffer = makeOption({
      id: 'annual:influencer-trial-7d-annual',
      tags: ['rc-ignore-offer'],
      freePhase: { billingPeriod: { iso8601: 'P1W' } },
    });
    const pkg = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'annual' }), annualOffer],
    });

    expect(findAuthorizedSubscriptionOption(pkg, ANNUAL_OFFER)).toEqual({
      status: 'match',
      option: annualOffer,
    });
  });

  it('C: offerId correto sob basePlan errado => not_found', () => {
    const wrongBasePlan = makeOption({ id: 'some-other-plan:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [wrongBasePlan],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });

  it('D: basePlan correto com offerId errado => not_found', () => {
    const wrongOffer = makeOption({ id: 'monthly:some-other-offer' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [wrongOffer],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });

  it('E: somente o base plan normal presente (sem oferta) => not_found', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeOption({ id: 'monthly' })],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'not_found' });
  });

  it('F: subscriptionOptions null => no_options', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: null });
    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'no_options' });
  });

  it('G: subscriptionOptions [] => no_options', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({ status: 'no_options' });
  });

  it('H: duas options com a MESMA identidade autorizada => ambiguous, nunca escolhe a primeira', () => {
    const first = makeOption({ id: 'monthly:influencer-trial-7d' });
    const second = makeOption({ id: 'monthly:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [first, second],
    });

    const result = findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER);
    expect(result).toEqual({ status: 'ambiguous', matchCount: 2 });
    expect(result).not.toEqual({ status: 'match', option: first });
  });

  it('I: tags = ["rc-ignore-offer"] não impede o match explícito', () => {
    const taggedOption = makeOption({
      id: 'monthly:influencer-trial-7d',
      tags: ['rc-ignore-offer'],
    });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [taggedOption],
    });

    expect(findAuthorizedSubscriptionOption(pkg, MONTHLY_OFFER)).toEqual({
      status: 'match',
      option: taggedOption,
    });
  });

  // Item J (option de outro produto injetada artificialmente) é coberto pelo
  // teste "FASE 4C.4E: rejects an id match whose storeProductId does not
  // belong to this package" acima, no describe `findAuthorizedSubscriptionOption`
  // — inclui a análise de por que esse cenário não é alcançável via o
  // contrato real do SDK, mantido apenas como defesa em profundidade.
});

/**
 * `classifyPurchaseResult` is the shared purchase authority boundary:
 * only `CustomerInfo.entitlements.active[entitlementId]` can grant Premium.
 */
describe('classifyPurchaseResult — CustomerInfo remains the sole Premium authority', () => {
  const ENTITLEMENT_ID = 'premium';

  function makeCustomerInfo(activeEntitlementIds: string[]): CustomerInfo {
    const active = Object.fromEntries(activeEntitlementIds.map((id) => [id, {} as never]));
    return {
      entitlements: { active, all: active },
    } as unknown as CustomerInfo;
  }

  it('a completed purchase without an active entitlement never yields premium', () => {
    const outcome = { status: 'purchased' as const, customerInfo: makeCustomerInfo([]) };
    expect(classifyPurchaseResult(outcome, ENTITLEMENT_ID)).toBe('missing-entitlement');
  });

  it('12: only an active `premium` entitlement in CustomerInfo yields premium, regardless of how it was reached', () => {
    const outcome = { status: 'purchased' as const, customerInfo: makeCustomerInfo([ENTITLEMENT_ID]) };
    expect(classifyPurchaseResult(outcome, ENTITLEMENT_ID)).toBe('premium');
  });

  it('an active entitlement OTHER than `premium` never counts as premium', () => {
    const outcome = { status: 'purchased' as const, customerInfo: makeCustomerInfo(['some_other_entitlement']) };
    expect(classifyPurchaseResult(outcome, ENTITLEMENT_ID)).toBe('missing-entitlement');
  });

  it('a cancelled purchase is classified as cancelled, never premium', () => {
    expect(classifyPurchaseResult({ status: 'cancelled' }, ENTITLEMENT_ID)).toBe('cancelled');
  });

  it('14: a RevenueCat/SDK error is classified as error, never premium', () => {
    expect(classifyPurchaseResult({ status: 'error' }, ENTITLEMENT_ID)).toBe('error');
  });
});

/**
 * FASE 6 keeps Android's authorized SubscriptionOption path unchanged while
 * the retired Apple client route is removed.
 */
describe('Android routing remains isolated and fail-closed', () => {
  it('resolvePurchaseRoute for Android keeps failing closed on a missing offer, regardless of anything Apple-related', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const result = resolvePurchaseRoute(pkg, true, null);
    expect(result).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('resolveAuthorizedAndroidOffer still selects only the requested Android plan', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAndroidOffer(pkg, { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER })).toEqual(
      MONTHLY_OFFER,
    );
  });

  it.each([
    ['monthly', 'MONTHLY', MONTHLY_OFFER, 'monthly:influencer-trial-7d'],
    ['annual', 'ANNUAL', ANNUAL_OFFER, 'annual:influencer-trial-7d-annual'],
  ] as const)(
    'FASE 9: %s keeps the same exact Android option with or without iOS-only state',
    (_plan, packageType, authorizedOffer, optionId) => {
      const option = makeOption({ id: optionId });
      const pkg = makePackage({
        packageType: packageType as PACKAGE_TYPE,
        subscriptionOptions: [option],
      });
      const androidStoreConfig = { monthly: MONTHLY_OFFER, annual: ANNUAL_OFFER };
      const mixedPlatformState = {
        androidStoreConfig,
        iosPromotion: {
          offeringIdentifier: 'promo_7d',
          monthlyProductId: 'ajfit_premium_monthly_promo',
          annualProductId: 'ajfit_premium_annual_promo',
        },
        purchaseIntent: {
          status: 'purchase_pending',
          expectedProductId: 'ajfit_premium_monthly_promo',
        },
      };

      const withoutIOSState = resolvePurchaseRoute(
        pkg,
        true,
        resolveAuthorizedAndroidOffer(pkg, androidStoreConfig),
      );
      const withIOSState = resolvePurchaseRoute(
        pkg,
        true,
        resolveAuthorizedAndroidOffer(pkg, mixedPlatformState.androidStoreConfig),
      );

      expect(resolveAuthorizedAndroidOffer(pkg, mixedPlatformState.androidStoreConfig)).toEqual(
        authorizedOffer,
      );
      expect(withIOSState).toEqual(withoutIOSState);
      expect(withIOSState).toEqual({ kind: 'subscription_option', option });
      expect(JSON.stringify(withIOSState)).not.toContain('_promo');
    },
  );

  it.each(['MONTHLY', 'ANNUAL'] as const)(
    'FASE 9: standard Android %s remains a package purchase when no promo is applied',
    (packageType) => {
      const pkg = makePackage({
        packageType: packageType as PACKAGE_TYPE,
        subscriptionOptions: [makeOption({ id: packageType.toLowerCase() })],
      });

      expect(resolvePurchaseRoute(pkg, false, null)).toEqual({ kind: 'package', package: pkg });
    },
  );
});

// ---------------------------------------------------------------------------
// FASE 6.3 — Android 'new'-shape (offeringIdentifier) resolution, route, and
// Paywall display-override tests. Mirrors the iOS resolution tests
// (`iosOfferingResolution.test.ts`) in spirit: pure functions, no fallback
// to `offerings.current`/the standard package ever asserted as acceptable.
// ---------------------------------------------------------------------------

function makeOffering(identifier: string, availablePackages: PurchasesPackage[]): PurchasesOffering {
  return { identifier, availablePackages } as unknown as PurchasesOffering;
}

function makeOfferings(
  all: Record<string, PurchasesOffering>,
  current: PurchasesOffering | null = null,
): PurchasesOfferings {
  return { all, current } as unknown as PurchasesOfferings;
}

/** A base-plan option: `trial-7d-new-subscriber` is what RevenueCat/Google Play would pick automatically for an eligible user — never selected manually by this client. */
function makeBasePlanOption(
  basePlanId: string,
  freePhase: unknown = null,
  fullPricePhase: unknown = null,
): SubscriptionOption {
  return makeOption({ id: basePlanId, freePhase, fullPricePhase });
}

const COUPON_DISCOUNT_OFFERING_ID = 'coupon_discount';

describe('resolveAndroidNewOfferPackage', () => {
  it('resolves the exact package by basePlanId within the exact offeringIdentifier — never offerings.current', () => {
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [
        makeBasePlanOption('monthly-promo'),
        makeOption({ id: 'monthly-promo:trial-7d-new-subscriber' }),
      ],
    });
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const offerings = makeOfferings(
      { [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoPackage]) },
      makeOffering('default', [standardPackage]), // current — must never be searched
    );

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({
      status: 'resolved',
      offering: offerings.all[COUPON_DISCOUNT_OFFERING_ID],
      package: promoPackage,
    });
  });

  it('resolves the annual promo package the same way', () => {
    const annualPromo = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:annual-promo',
      subscriptionOptions: [makeBasePlanOption('annual-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [annualPromo]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'annual-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({
      status: 'resolved',
      offering: offerings.all[COUPON_DISCOUNT_OFFERING_ID],
      package: annualPromo,
    });
  });

  it('blocked: offering does not exist — never falls back to offerings.current', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const offerings = makeOfferings({}, makeOffering('default', [standardPackage]));

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_offering_missing' });
  });

  it('blocked: offering exists but the authorized basePlan does not', () => {
    const wrongPlanPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly',
      subscriptionOptions: [makeBasePlanOption('monthly')], // not "monthly-promo"
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [wrongPlanPackage]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_package_missing' });
  });

  it('blocked: offering containing BOTH standard and promo packages still resolves only the exact basePlan match', () => {
    const standardInSameOffering = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly',
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [
        standardInSameOffering,
        promoPackage,
      ]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({
      status: 'resolved',
      offering: offerings.all[COUPON_DISCOUNT_OFFERING_ID],
      package: promoPackage,
    });
  });

  it('blocked: ambiguous catalog — two packages both claim the same basePlanId', () => {
    const dup1 = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const dup2 = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium_alt:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [dup1, dup2]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_package_ambiguous' });
  });

  it('blocked: a package with no subscriptionOptions at all never matches', () => {
    const malformed = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: null,
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [malformed]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_package_missing' });
  });

  it('never mistakes an OFFER suboption (basePlanId:offerId, isBasePlan=false) for the base plan itself', () => {
    const pkgWithOnlyOfferSuboption = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      // Only the offer suboption exists here, not the base plan option —
      // isBasePlan is false because the id contains ':'.
      subscriptionOptions: [makeOption({ id: 'monthly-promo:trial-7d-new-subscriber' })],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [pkgWithOnlyOfferSuboption]),
    });

    const result = resolveAndroidNewOfferPackage(offerings, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_package_missing' });
  });

  it('null offerings never resolves — no crash, fails closed', () => {
    const result = resolveAndroidNewOfferPackage(null, {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    });

    expect(result).toEqual({ status: 'error', reason: 'promo_offering_missing' });
  });
});

describe('resolveAndroidPurchaseRoute', () => {
  it('no promo applied → package route, exactly like resolvePurchaseRoute', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    expect(resolveAndroidPurchaseRoute(pkg, false, null, null)).toEqual({
      kind: 'package',
      package: pkg,
    });
  });

  it('LEGACY offer delegates verbatim to resolvePurchaseRoute (option match)', () => {
    const monthlyOption = makeOption({ id: 'monthly:influencer-trial-7d' });
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [monthlyOption],
    });

    const route = resolveAndroidPurchaseRoute(pkg, true, MONTHLY_OFFER, null);

    expect(route).toEqual({ kind: 'subscription_option', option: monthlyOption });
  });

  it('LEGACY offer still blocks on not_found — offerings param is irrelevant to this shape', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    expect(resolveAndroidPurchaseRoute(pkg, true, MONTHLY_OFFER, null)).toEqual({
      kind: 'blocked',
      reason: 'promo_not_found',
    });
  });

  it('NEW offer, eligible user (Store selects the trial suboption automatically) → package route with the RESOLVED promo package, never the standard one', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [
        makeBasePlanOption('monthly-promo'),
        // The trial suboption exists on the product — the CLIENT never
        // selects it; purchasePackage lets RevenueCat/Google Play do that.
        makeOption({
          id: 'monthly-promo:trial-7d-new-subscriber',
          freePhase: { billingPeriod: { iso8601: 'P7D' } },
        }),
      ],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoPackage]),
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };

    const route = resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings);

    expect(route).toEqual({ kind: 'package', package: promoPackage });
    expect(route.kind === 'package' && route.package).not.toBe(standardPackage);
  });

  it('NEW offer, ineligible user — resolution is identical regardless of Store eligibility (client never checks eligibility itself)', () => {
    // Ineligible users still purchase the SAME package/base plan; only the
    // Store's automatic offer selection differs at purchase time, which is
    // entirely outside this client's resolution logic.
    const promoPackage = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:annual-promo',
      subscriptionOptions: [makeBasePlanOption('annual-promo')], // no trial suboption at all
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoPackage]),
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'annual-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };
    const standardPackage = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('annual')],
    });

    const route = resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings);

    expect(route).toEqual({ kind: 'package', package: promoPackage });
  });

  it('NEW offer, offering missing → blocked, never falls back to the standard package', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const offerings = makeOfferings({});
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };

    expect(resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings)).toEqual({
      kind: 'blocked',
      reason: 'promo_offering_missing',
    });
  });

  it('NEW offer, basePlan missing in the (existing) offering → blocked', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, []),
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };

    expect(resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings)).toEqual({
      kind: 'blocked',
      reason: 'promo_package_missing',
    });
  });

  it('NEW offer, ambiguous catalog → blocked', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const dup1 = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'a:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const dup2 = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'b:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [dup1, dup2]),
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };

    expect(resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings)).toEqual({
      kind: 'blocked',
      reason: 'promo_package_ambiguous',
    });
  });

  it('never selects a SubscriptionOption manually for the NEW shape — route is always "package", never "subscription_option"', () => {
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [
        makeBasePlanOption('monthly-promo'),
        makeOption({ id: 'monthly-promo:trial-7d-new-subscriber' }),
      ],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoPackage]),
    });
    const newOffer: AuthorizedAndroidOffer = {
      kind: 'new',
      basePlanId: 'monthly-promo',
      offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID,
    };
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    const route = resolveAndroidPurchaseRoute(standardPackage, true, newOffer, offerings);

    expect(route.kind).toBe('package');
  });
});

describe('applyAndroidPromoPackageOverrides', () => {
  it('null androidStoreConfig → returns standardPackages unchanged', () => {
    const standardPackages = [
      makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [makeBasePlanOption('monthly')] }),
    ];

    expect(applyAndroidPromoPackageOverrides(standardPackages, null, null)).toBe(standardPackages);
  });

  it('substitutes ONLY the plan with a resolved NEW-shape authorization, leaves the other plan (unconfigured) untouched', () => {
    const standardMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const standardAnnual = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('annual')],
    });
    const promoMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoMonthly]),
    });

    const result = applyAndroidPromoPackageOverrides(
      [standardMonthly, standardAnnual],
      offerings,
      {
        monthly: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID },
        annual: null,
      },
    );

    expect(result).toEqual([promoMonthly, standardAnnual]);
  });

  it('substitutes both plans when both are resolved NEW-shape authorizations', () => {
    const standardMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const standardAnnual = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('annual')],
    });
    const promoMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [makeBasePlanOption('monthly-promo')],
    });
    const promoAnnual = makePackage({
      packageType: 'ANNUAL' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:annual-promo',
      subscriptionOptions: [makeBasePlanOption('annual-promo')],
    });
    const offerings = makeOfferings({
      [COUPON_DISCOUNT_OFFERING_ID]: makeOffering(COUPON_DISCOUNT_OFFERING_ID, [promoMonthly, promoAnnual]),
    });

    const result = applyAndroidPromoPackageOverrides(
      [standardMonthly, standardAnnual],
      offerings,
      {
        monthly: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID },
        annual: { kind: 'new', basePlanId: 'annual-promo', offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID },
      },
    );

    expect(result).toEqual([promoMonthly, promoAnnual]);
  });

  it('LEGACY-shape plan is never touched by the override (kept as the standard package)', () => {
    const standardMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    const result = applyAndroidPromoPackageOverrides([standardMonthly], null, {
      monthly: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
      annual: null,
    });

    expect(result).toEqual([standardMonthly]);
  });

  it('resolution failure degrades to the standard package for DISPLAY only — never throws, never blanks the list', () => {
    const standardMonthly = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });
    const offerings = makeOfferings({}); // coupon_discount missing entirely

    const result = applyAndroidPromoPackageOverrides([standardMonthly], offerings, {
      monthly: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: COUPON_DISCOUNT_OFFERING_ID },
      annual: null,
    });

    expect(result).toEqual([standardMonthly]);
  });
});

// ---------------------------------------------------------------------------
// FASE 6.4 — Android trial signal (rule 3) and real-price display (rule 2/8).
// Trial is computed identically for standard and promotional packages, never
// derived from whether a coupon is applied — and price always comes from a
// real SDK-reported pricing phase, never a computed percentage.
// ---------------------------------------------------------------------------

describe('resolveAndroidTrialSignal', () => {
  it("'none' when the base plan has no linked offer at all", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    expect(resolveAndroidTrialSignal(pkg)).toBe('none');
  });

  it("'possible' when an offer suboption on the SAME base plan carries a free trial phase — computed the same way for a STANDARD package (no coupon involved)", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [
        makeBasePlanOption('monthly'),
        makeOption({ id: 'monthly:trial-7d-new-subscriber', freePhase: { billingPeriod: { iso8601: 'P7D' } } }),
      ],
    });

    expect(resolveAndroidTrialSignal(pkg)).toBe('possible');
  });

  it("'possible' identically for a PROMOTIONAL package — the signal never depends on the coupon, only on the package's own subscriptionOptions", () => {
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      subscriptionOptions: [
        makeBasePlanOption('monthly-promo'),
        makeOption({
          id: 'monthly-promo:trial-7d-new-subscriber',
          freePhase: { billingPeriod: { iso8601: 'P7D' } },
        }),
      ],
    });

    expect(resolveAndroidTrialSignal(promoPackage)).toBe('possible');
  });

  it("'none' when subscriptionOptions is null (defensive — never throws)", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: null,
    });

    expect(resolveAndroidTrialSignal(pkg)).toBe('none');
  });

  it("never treats the base plan option ITSELF as a trial signal, even if (incorrectly) it had a freePhase — only offer suboptions (!isBasePlan) count", () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly', { billingPeriod: { iso8601: 'P7D' } })],
    });

    expect(resolveAndroidTrialSignal(pkg)).toBe('none');
  });
});

describe('packagePriceString — Android base-plan real price (FASE 6.4)', () => {
  it('reads the price from the BASE PLAN SubscriptionOption.fullPricePhase, never product.priceString, when subscriptionOptions exist', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      priceString: 'R$ 0,00', // what product.priceString would show if defaultOption were the trial offer
      subscriptionOptions: [
        makeBasePlanOption('monthly', undefined, makeFullPricePhase('R$ 39,90')),
        makeOption({ id: 'monthly:trial-7d-new-subscriber', freePhase: { billingPeriod: { iso8601: 'P7D' } } }),
      ],
    });

    expect(packagePriceString(pkg)).toBe('R$ 39,90');
  });

  it('falls back to product.priceString when there is no base-plan option at all (iOS — subscriptionOptions is always null there)', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      priceString: 'US$ 9.99',
      subscriptionOptions: null,
    });

    expect(packagePriceString(pkg)).toBe('US$ 9.99');
  });

  it('falls back to product.priceString when the base-plan option has no fullPricePhase set', () => {
    const pkg = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      priceString: 'R$ 39,90',
      subscriptionOptions: [makeBasePlanOption('monthly')],
    });

    expect(packagePriceString(pkg)).toBe('R$ 39,90');
  });

  it('never computes a promotional price as a percentage of the standard price — reads the promo package own fullPricePhase verbatim', () => {
    const standardPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      subscriptionOptions: [makeBasePlanOption('monthly', undefined, makeFullPricePhase('R$ 39,90'))],
    });
    const promoPackage = makePackage({
      packageType: 'MONTHLY' as PACKAGE_TYPE,
      productIdentifier: 'ajfit_premium:monthly-promo',
      // Deliberately NOT 90% of R$ 39,90 (R$ 35,91) — a real, independently
      // configured Store price, proving this is read, never derived.
      subscriptionOptions: [makeBasePlanOption('monthly-promo', undefined, makeFullPricePhase('R$ 24,90'))],
    });

    expect(packagePriceString(standardPackage)).toBe('R$ 39,90');
    expect(packagePriceString(promoPackage)).toBe('R$ 24,90');
    expect(packagePriceString(promoPackage)).not.toBe('R$ 35,91');
  });
});
