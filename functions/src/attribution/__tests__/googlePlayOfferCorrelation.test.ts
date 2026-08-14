import { describe, expect, it } from 'vitest';
import {
  correlateGooglePlayOffer,
  extractGooglePlayOfferCode,
  parseGooglePlayProductId,
} from '../googlePlayOfferCorrelation';
import type { PromoCodeAndroidOfferSnapshot } from '../types';

const ARNALDO_OFFER: PromoCodeAndroidOfferSnapshot = {
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
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
});
