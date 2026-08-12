import { describe, expect, it } from 'vitest';
import type { PACKAGE_TYPE, PurchasesPackage, SubscriptionOption } from 'react-native-purchases';
import {
  findAuthorizedSubscriptionOption,
  resolveAndroidPlanKind,
  resolveApplePurchaseRoute,
  resolveAuthorizedAndroidOffer,
  resolveAuthorizedAppleOfferCode,
  resolvePurchaseRoute,
  subscriptionOptionHasFreeTrial,
  type AuthorizedAndroidOffer,
  type AuthorizedAppleOfferCodes,
} from '../subscriptionOffer';

const PRODUCT_ID = 'ajfit_premium';

const MONTHLY_OFFER: AuthorizedAndroidOffer = { basePlanId: 'monthly', offerId: 'influencer-trial-7d' };
const ANNUAL_OFFER: AuthorizedAndroidOffer = {
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
}: {
  id: string;
  productId?: string;
  storeProductId?: string;
  tags?: string[];
  freePhase?: unknown;
}): SubscriptionOption {
  return {
    id,
    storeProductId: storeProductId ?? storeProductIdFor(productId, id),
    productId,
    tags,
    isBasePlan: !id.includes(':'),
    billingPeriod: null,
    isPrepaid: false,
    fullPricePhase: null,
    freePhase,
    introPhase: null,
    presentedOfferingIdentifier: null,
    presentedOfferingContext: null,
    installmentsInfo: null,
  } as unknown as SubscriptionOption;
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
}: {
  packageType: PACKAGE_TYPE;
  subscriptionOptions: SubscriptionOption[] | null;
  productIdentifier?: string;
}): PurchasesPackage {
  const basePlanId = packageType === 'MONTHLY' ? 'monthly' : 'annual';
  return {
    identifier: packageType === 'MONTHLY' ? '$rc_monthly' : '$rc_annual',
    packageType,
    product: {
      identifier: productIdentifier ?? `${PRODUCT_ID}:${basePlanId}`,
      subscriptionOptions,
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
// FASE iOS-3 — Apple Offer Code routing. Structurally different fixtures
// from the Android section above on purpose: `AuthorizedAppleOfferCodes` is
// a flat string per plan, never a basePlanId/offerId pair, and there is no
// SubscriptionOption catalog to match against.
// ---------------------------------------------------------------------------

const APPLE_OFFER_CODES: AuthorizedAppleOfferCodes = {
  offerCodeMonthly: 'AJFIT7DTRIAL',
  offerCodeAnnual: 'AJFIT7DTRIALANNUAL',
};

describe('resolveAuthorizedAppleOfferCode', () => {
  it('F: selected monthly package resolves the monthly offer code', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAppleOfferCode(pkg, APPLE_OFFER_CODES)).toBe('AJFIT7DTRIAL');
  });

  it('G: selected annual package resolves the annual offer code', () => {
    const pkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAppleOfferCode(pkg, APPLE_OFFER_CODES)).toBe('AJFIT7DTRIALANNUAL');
  });

  it('L (mensal/anual never confused): mensal package never resolves the annual code and vice versa', () => {
    const monthlyPkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const annualPkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAppleOfferCode(monthlyPkg, APPLE_OFFER_CODES)).not.toBe(
      resolveAuthorizedAppleOfferCode(annualPkg, APPLE_OFFER_CODES),
    );
  });

  it('an unrecognized package type never authorizes anything (fail-closed)', () => {
    const pkg = makePackage({ packageType: 'WEEKLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAppleOfferCode(pkg, APPLE_OFFER_CODES)).toBeNull();
  });

  it('K (catálogo sem config Apple falha de forma segura): returns null when there is no apple storeConfig at all', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(resolveAuthorizedAppleOfferCode(pkg, null)).toBeNull();
  });

  it('returns null for the requested plan when only the other plan has a configured code', () => {
    const pkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });
    expect(
      resolveAuthorizedAppleOfferCode(pkg, { offerCodeMonthly: 'AJFIT7DTRIAL', offerCodeAnnual: null }),
    ).toBeNull();
  });
});

describe('resolveApplePurchaseRoute', () => {
  it('A: sem promo aplicado → route package (mesmo com código Apple configurado)', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const route = resolveApplePurchaseRoute(pkg, false, 'AJFIT7DTRIAL');
    expect(route).toEqual({ kind: 'package', package: pkg });
  });

  it('B: promo aplicado + código mensal disponível → offer_redemption com o código exato', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const route = resolveApplePurchaseRoute(pkg, true, 'AJFIT7DTRIAL');
    expect(route).toEqual({ kind: 'offer_redemption', offerCode: 'AJFIT7DTRIAL', package: pkg });
  });

  it('C: promo aplicado + código anual disponível → offer_redemption com o código exato', () => {
    const pkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });
    const route = resolveApplePurchaseRoute(pkg, true, 'AJFIT7DTRIALANNUAL');
    expect(route).toEqual({ kind: 'offer_redemption', offerCode: 'AJFIT7DTRIALANNUAL', package: pkg });
  });

  it('G: promo aplicado + nenhum código autorizado para o plano → blocked (nunca cai para package)', () => {
    const pkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const route = resolveApplePurchaseRoute(pkg, true, null);
    expect(route).toEqual({ kind: 'blocked', reason: 'promo_plan_unavailable' });
  });

  it('H/I: trocar de mensal para anual recalcula a rota do zero, nunca reaproveita o código do outro plano', () => {
    const monthlyPkg = makePackage({ packageType: 'MONTHLY' as PACKAGE_TYPE, subscriptionOptions: [] });
    const annualPkg = makePackage({ packageType: 'ANNUAL' as PACKAGE_TYPE, subscriptionOptions: [] });

    const monthlyRoute = resolveApplePurchaseRoute(
      monthlyPkg,
      true,
      resolveAuthorizedAppleOfferCode(monthlyPkg, APPLE_OFFER_CODES),
    );
    const annualRoute = resolveApplePurchaseRoute(
      annualPkg,
      true,
      resolveAuthorizedAppleOfferCode(annualPkg, APPLE_OFFER_CODES),
    );

    expect(monthlyRoute).toEqual({
      kind: 'offer_redemption',
      offerCode: 'AJFIT7DTRIAL',
      package: monthlyPkg,
    });
    expect(annualRoute).toEqual({
      kind: 'offer_redemption',
      offerCode: 'AJFIT7DTRIALANNUAL',
      package: annualPkg,
    });
    expect(monthlyRoute).not.toEqual(annualRoute);
  });
});

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
