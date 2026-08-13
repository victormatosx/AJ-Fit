import { describe, expect, it } from 'vitest';
import type { PurchasesIntroPrice, PurchasesPackage } from 'react-native-purchases';
import {
  resolveIOSIntroOfferPresentation,
  resolveIOSPromoPurchaseReadiness,
  type IOSIntroEligibilityState,
} from '../iosIntroOffer';

function pkg(introPrice: PurchasesIntroPrice | null): PurchasesPackage {
  return {
    identifier: '$rc_monthly',
    packageType: 'MONTHLY',
    product: {
      identifier: 'monthly_promo',
      priceString: 'R$ 39,90',
      subscriptionPeriod: 'P1M',
      introPrice,
    },
  } as PurchasesPackage;
}

const freeTrial = {
  price: 0,
  priceString: 'R$ 0,00',
  cycles: 1,
  period: 'P7D',
  periodUnit: 'DAY',
  periodNumberOfUnits: 7,
} as PurchasesIntroPrice;

describe('iOS Introductory Offer presentation', () => {
  it('derives a free trial only from zero-price StoreProduct intro data plus eligible', () => {
    const result = resolveIOSIntroOfferPresentation(pkg(freeTrial), { status: 'eligible' });
    expect(result).toEqual({
      kind: 'free_trial',
      terms: {
        duration: { count: 7, unit: 'day' },
        introductoryPrice: 0,
        introductoryPriceString: 'R$ 0,00',
        renewalPriceString: 'R$ 39,90',
        renewalPeriod: 'P1M',
      },
    });
    expect(resolveIOSPromoPurchaseReadiness(result)).toEqual({
      status: 'ready',
      terms: 'free_trial',
    });
  });

  it.each<IOSIntroEligibilityState>([
    { status: 'idle' },
    { status: 'checking' },
    { status: 'unknown' },
    { status: 'error' },
  ])('never presents trial for $status', (eligibility) => {
    const result = resolveIOSIntroOfferPresentation(pkg(freeTrial), eligibility);
    expect(result.kind).not.toBe('free_trial');
    expect(resolveIOSPromoPurchaseReadiness(result).status).toBe('blocked');
  });

  it('ineligible hides trial and safely allows only the product regular price', () => {
    const result = resolveIOSIntroOfferPresentation(pkg(freeTrial), { status: 'ineligible' });
    expect(result).toEqual({ kind: 'standard', reason: 'ineligible' });
    expect(resolveIOSPromoPurchaseReadiness(result)).toEqual({
      status: 'ready',
      terms: 'regular_price',
    });
  });

  it('NO_INTRO_OFFER_EXISTS never promises trial and blocks a promo catalog that requires intro', () => {
    const result = resolveIOSIntroOfferPresentation(pkg(freeTrial), {
      status: 'no_intro_offer',
    });
    expect(result).toEqual({ kind: 'standard', reason: 'no_intro_offer' });
    expect(resolveIOSPromoPurchaseReadiness(result)).toEqual({
      status: 'blocked',
      reason: 'intro_configuration',
    });
  });

  it('derives duration from StoreKit cycles, periodNumberOfUnits and periodUnit', () => {
    const result = resolveIOSIntroOfferPresentation(
      pkg({ ...freeTrial, cycles: 2, periodNumberOfUnits: 3, periodUnit: 'WEEK' }),
      { status: 'eligible' },
    );

    expect(result).toMatchObject({
      kind: 'free_trial',
      terms: { duration: { count: 6, unit: 'week' } },
    });
  });

  it('missing intro data is a blocked configuration inconsistency', () => {
    const result = resolveIOSIntroOfferPresentation(pkg(null), { status: 'eligible' });
    expect(result).toEqual({ kind: 'configuration_error', reason: 'intro_missing' });
    expect(resolveIOSPromoPurchaseReadiness(result).status).toBe('blocked');
  });

  it('paid introductory pricing is never described as a free trial', () => {
    const result = resolveIOSIntroOfferPresentation(
      pkg({ ...freeTrial, price: 9.9, priceString: 'R$ 9,90' }),
      { status: 'eligible' },
    );
    expect(result).toEqual({ kind: 'configuration_error', reason: 'intro_not_free_trial' });
  });

  it('rejects malformed duration rather than inventing seven days from identifiers', () => {
    const result = resolveIOSIntroOfferPresentation(
      pkg({ ...freeTrial, cycles: 0 }),
      { status: 'eligible' },
    );
    expect(result).toEqual({ kind: 'configuration_error', reason: 'intro_invalid' });
  });
});
