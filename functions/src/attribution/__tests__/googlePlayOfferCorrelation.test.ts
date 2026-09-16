import { describe, expect, it } from 'vitest';
import {
  correlateGooglePlayOffer,
  extractGooglePlayOfferCode,
  parseGooglePlayProductId,
} from '../googlePlayOfferCorrelation';
import type { PromoCodeAndroidOfferSnapshot } from '../types';

const ARNALDO_OFFER: PromoCodeAndroidOfferSnapshot = {
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d', offeringIdentifier: null },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual', offeringIdentifier: null },
};

describe('parseGooglePlayProductId', () => {
  it('A: parses a valid monthly product_id', () => {
    expect(parseGooglePlayProductId('ajfit_premium:monthly')).toEqual({
      subscriptionId: 'ajfit_premium',
      basePlanId: 'monthly',
    });
  });

  it('B: parses a valid annual product_id', () => {
    expect(parseGooglePlayProductId('ajfit_premium:annual')).toEqual({
      subscriptionId: 'ajfit_premium',
      basePlanId: 'annual',
    });
  });

  it('C: returns null for undefined/null', () => {
    expect(parseGooglePlayProductId(undefined)).toBeNull();
    expect(parseGooglePlayProductId(null)).toBeNull();
  });

  it('D: returns null when there is no base plan segment', () => {
    expect(parseGooglePlayProductId('ajfit_premium')).toBeNull();
  });

  it('E: returns null for an unexpected format (empty string, extra segments, empty segment)', () => {
    expect(parseGooglePlayProductId('')).toBeNull();
    expect(parseGooglePlayProductId('ajfit_premium:monthly:extra')).toBeNull();
    expect(parseGooglePlayProductId(':monthly')).toBeNull();
    expect(parseGooglePlayProductId('ajfit_premium:')).toBeNull();
    expect(parseGooglePlayProductId(123)).toBeNull();
  });

  it('F: never alters case', () => {
    expect(parseGooglePlayProductId('Ajfit_Premium:Monthly')).toEqual({
      subscriptionId: 'Ajfit_Premium',
      basePlanId: 'Monthly',
    });
  });
});

describe('extractGooglePlayOfferCode', () => {
  it('reads a valid string as-is, without case changes', () => {
    expect(extractGooglePlayOfferCode('influencer-trial-7d')).toBe('influencer-trial-7d');
    expect(extractGooglePlayOfferCode('Influencer-Trial-7D')).toBe('Influencer-Trial-7D');
  });

  it('treats null, undefined, empty string, and non-string as "no proof of an offer"', () => {
    expect(extractGooglePlayOfferCode(null)).toBeNull();
    expect(extractGooglePlayOfferCode(undefined)).toBeNull();
    expect(extractGooglePlayOfferCode('')).toBeNull();
    expect(extractGooglePlayOfferCode(42)).toBeNull();
  });
});

describe('correlateGooglePlayOffer', () => {
  it('G: ARNALDO monthly + offer correta → match', () => {
    expect(correlateGooglePlayOffer('monthly', 'influencer-trial-7d', ARNALDO_OFFER)).toEqual({
      status: 'matched',
      plan: 'monthly',
    });
  });

  it('H: ARNALDO annual + offer correta → match', () => {
    expect(
      correlateGooglePlayOffer('annual', 'influencer-trial-7d-annual', ARNALDO_OFFER),
    ).toEqual({ status: 'matched', plan: 'annual' });
  });

  it('I: basePlan correto + offer null → no match (compra normal)', () => {
    expect(correlateGooglePlayOffer('monthly', null, ARNALDO_OFFER)).toEqual({
      status: 'not_matched',
    });
  });

  it('J: basePlan correto + offer diferente → no match', () => {
    expect(correlateGooglePlayOffer('monthly', 'some-other-offer', ARNALDO_OFFER)).toEqual({
      status: 'not_matched',
    });
  });

  it('K: offer correta + basePlan diferente → no match', () => {
    expect(
      correlateGooglePlayOffer('some-other-plan', 'influencer-trial-7d', ARNALDO_OFFER),
    ).toEqual({ status: 'not_matched' });
  });

  it('L: combinação cruzada mensal/anual → no match (nunca casar offerId de um plano com basePlanId de outro)', () => {
    // monthly basePlanId + annual offerId
    expect(
      correlateGooglePlayOffer('monthly', 'influencer-trial-7d-annual', ARNALDO_OFFER),
    ).toEqual({ status: 'not_matched' });
    // annual basePlanId + monthly offerId
    expect(correlateGooglePlayOffer('annual', 'influencer-trial-7d', ARNALDO_OFFER)).toEqual({
      status: 'not_matched',
    });
  });

  it('M: redemption sem androidOffer (null) → no match', () => {
    expect(correlateGooglePlayOffer('monthly', 'influencer-trial-7d', null)).toEqual({
      status: 'not_matched',
    });
  });

  it('N: redemption parcial (um plano null) → no match para aquele plano', () => {
    const partial: PromoCodeAndroidOfferSnapshot = { monthly: null, annual: ARNALDO_OFFER.annual };
    expect(correlateGooglePlayOffer('monthly', 'influencer-trial-7d', partial)).toEqual({
      status: 'not_matched',
    });
    // annual half still works on its own
    expect(
      correlateGooglePlayOffer('annual', 'influencer-trial-7d-annual', partial),
    ).toEqual({ status: 'matched', plan: 'annual' });
  });

  it('never matches when both basePlanId and offerCode are null', () => {
    expect(correlateGooglePlayOffer(null, null, ARNALDO_OFFER)).toEqual({ status: 'not_matched' });
  });

  // FASE 5.3 — new-style config: offerId is null/absent, coupon only selects
  // the promotional base plan; Google Play/RevenueCat's own automatic offer
  // selection decides whether a trial applied, and that choice is irrelevant
  // to correlation.
  describe('FASE 5.3: new-style (offerId absent) — basePlanId-only correlation', () => {
    const COUPON_DISCOUNT_OFFER: PromoCodeAndroidOfferSnapshot = {
      monthly: { basePlanId: 'monthly-promo', offerId: null, offeringIdentifier: 'coupon_discount' },
      annual: { basePlanId: 'annual-promo', offerId: null, offeringIdentifier: 'coupon_discount' },
    };

    it('O: matches when the real purchase carries the store-selected trial offer code', () => {
      expect(
        correlateGooglePlayOffer('monthly-promo', 'trial-7d-new-subscriber', COUPON_DISCOUNT_OFFER),
      ).toEqual({ status: 'matched', plan: 'monthly' });
    });

    it('P: matches when the real purchase carries NO offer code (user not eligible, bare base plan)', () => {
      expect(correlateGooglePlayOffer('monthly-promo', null, COUPON_DISCOUNT_OFFER)).toEqual({
        status: 'matched',
        plan: 'monthly',
      });
    });

    it('Q: matches the annual base plan the same way, independent of offer code', () => {
      expect(
        correlateGooglePlayOffer('annual-promo', 'trial-7d-new-subscriber', COUPON_DISCOUNT_OFFER),
      ).toEqual({ status: 'matched', plan: 'annual' });
      expect(correlateGooglePlayOffer('annual-promo', null, COUPON_DISCOUNT_OFFER)).toEqual({
        status: 'matched',
        plan: 'annual',
      });
    });

    it('R: still no match for a different base plan entirely', () => {
      expect(correlateGooglePlayOffer('monthly', 'trial-7d-new-subscriber', COUPON_DISCOUNT_OFFER)).toEqual({
        status: 'not_matched',
      });
    });

    it('S: still never matches cross-plan (monthly-promo basePlanId can never satisfy the annual-promo slot)', () => {
      const mixed: PromoCodeAndroidOfferSnapshot = {
        monthly: { basePlanId: 'monthly-promo', offerId: null, offeringIdentifier: 'coupon_discount' },
        annual: null,
      };
      expect(correlateGooglePlayOffer('annual-promo', null, mixed)).toEqual({ status: 'not_matched' });
    });
  });

  describe('legacy (offerId present) regression — unchanged after FASE 5.3', () => {
    it('T: a legacy pair with offerId set still requires the exact offer code, even under the new correlation branch', () => {
      expect(correlateGooglePlayOffer('monthly', null, ARNALDO_OFFER)).toEqual({ status: 'not_matched' });
      expect(correlateGooglePlayOffer('monthly', 'trial-7d-new-subscriber', ARNALDO_OFFER)).toEqual({
        status: 'not_matched',
      });
      expect(correlateGooglePlayOffer('monthly', 'influencer-trial-7d', ARNALDO_OFFER)).toEqual({
        status: 'matched',
        plan: 'monthly',
      });
    });

    it('U: a redemption mixing one legacy plan and one new-style plan correlates each independently', () => {
      const mixed: PromoCodeAndroidOfferSnapshot = {
        monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d', offeringIdentifier: null },
        annual: { basePlanId: 'annual-promo', offerId: null, offeringIdentifier: 'coupon_discount' },
      };
      expect(correlateGooglePlayOffer('monthly', null, mixed)).toEqual({ status: 'not_matched' });
      expect(correlateGooglePlayOffer('monthly', 'influencer-trial-7d', mixed)).toEqual({
        status: 'matched',
        plan: 'monthly',
      });
      expect(correlateGooglePlayOffer('annual-promo', null, mixed)).toEqual({
        status: 'matched',
        plan: 'annual',
      });
      expect(correlateGooglePlayOffer('annual-promo', 'trial-7d-new-subscriber', mixed)).toEqual({
        status: 'matched',
        plan: 'annual',
      });
    });
  });

  describe('FASE 5.7: offeringIdentifier is a client-side concern only — never read by correlation', () => {
    it('V: matches identically regardless of which offeringIdentifier (or none) is on the snapshot — the webhook event never carries it', () => {
      const withOffering: PromoCodeAndroidOfferSnapshot = {
        monthly: { basePlanId: 'monthly-promo', offerId: null, offeringIdentifier: 'coupon_discount' },
        annual: null,
      };
      const withDifferentOffering: PromoCodeAndroidOfferSnapshot = {
        monthly: { basePlanId: 'monthly-promo', offerId: null, offeringIdentifier: 'some_other_offering' },
        annual: null,
      };
      expect(correlateGooglePlayOffer('monthly-promo', 'trial-7d-new-subscriber', withOffering)).toEqual({
        status: 'matched',
        plan: 'monthly',
      });
      expect(correlateGooglePlayOffer('monthly-promo', 'trial-7d-new-subscriber', withDifferentOffering)).toEqual({
        status: 'matched',
        plan: 'monthly',
      });
    });
  });
});
