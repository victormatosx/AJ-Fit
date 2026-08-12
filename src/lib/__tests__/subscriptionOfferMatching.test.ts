import { describe, expect, it } from 'vitest';
import type { PACKAGE_TYPE, PurchasesPackage, SubscriptionOption } from 'react-native-purchases';
import {
  findAuthorizedSubscriptionOption,
  resolveAndroidPlanKind,
  resolveAuthorizedAndroidOffer,
  resolvePurchaseRoute,
  subscriptionOptionHasFreeTrial,
  type AuthorizedAndroidOffer,
} from '../subscriptionOffer';

const PRODUCT_ID = 'ajfit_premium';

const MONTHLY_OFFER: AuthorizedAndroidOffer = { basePlanId: 'monthly', offerId: 'influencer-trial-7d' };
const ANNUAL_OFFER: AuthorizedAndroidOffer = {
  basePlanId: 'annual',
  offerId: 'influencer-trial-7d-annual',
};

function makeOption({
  id,
  productId = PRODUCT_ID,
  tags = [],
  freePhase = null,
}: {
  id: string;
  productId?: string;
  tags?: string[];
  freePhase?: unknown;
}): SubscriptionOption {
  return {
    id,
    storeProductId: `${productId}:${id}`,
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

function makePackage({
  packageType,
  subscriptionOptions,
  productIdentifier = PRODUCT_ID,
}: {
  packageType: PACKAGE_TYPE;
  subscriptionOptions: SubscriptionOption[] | null;
  productIdentifier?: string;
}): PurchasesPackage {
  return {
    identifier: packageType === 'MONTHLY' ? '$rc_monthly' : '$rc_annual',
    packageType,
    product: {
      identifier: productIdentifier,
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

  it('rejects an id match whose productId does not belong to this package (defense-in-depth)', () => {
    const foreignProductOption = makeOption({
      id: 'monthly:influencer-trial-7d',
      productId: 'some_other_product',
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
