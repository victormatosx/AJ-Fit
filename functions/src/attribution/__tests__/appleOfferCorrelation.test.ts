import { describe, expect, it } from 'vitest';
import { correlateAppleOffer } from '../appleOfferCorrelation';
import type { PromoCodeAppleCorrelationSnapshot } from '../types';

// FASE iOS-6 — real evidence (a captured RevenueCat webhook for a real Apple
// Sandbox Offer Code redemption, docs/13's FASE iOS-5 section) proved
// `event.offer_code` carries the App Store Connect Offer's reference/name
// (e.g. "Influencer Trial 7D"), and `product_id` is a flat SKU
// (`ajfit_premium_monthly`) — so `correlateAppleOffer` now performs a real,
// deterministic match on BOTH fields against the SAME plan's authorized
// config, mirroring `googlePlayOfferCorrelation.test.ts`'s structure.

const ARNALDO_APPLE_CORRELATION: PromoCodeAppleCorrelationSnapshot = {
  monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
  annual: null,
};

const ARNALDO_APPLE_CORRELATION_BOTH_PLANS: PromoCodeAppleCorrelationSnapshot = {
  monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
  annual: { productId: 'ajfit_premium_annual', offerReference: 'Influencer Trial 7D Annual' },
};

describe('correlateAppleOffer', () => {
  it('A: APP_STORE + monthly productId + exact offer reference → matched, monthly', () => {
    expect(
      correlateAppleOffer('ajfit_premium_monthly', 'Influencer Trial 7D', ARNALDO_APPLE_CORRELATION),
    ).toEqual({ status: 'matched', plan: 'monthly' });
  });

  it('B: correct productId but a DIFFERENT offer reference → not_matched', () => {
    expect(
      correlateAppleOffer('ajfit_premium_monthly', 'Some Other Offer', ARNALDO_APPLE_CORRELATION),
    ).toEqual({ status: 'not_matched' });
  });

  it('C: offerCode null (event field absent) → not_matched (mirrors correlateGooglePlayOffer\'s treatment of a missing offer_code)', () => {
    expect(correlateAppleOffer('ajfit_premium_monthly', null, ARNALDO_APPLE_CORRELATION)).toEqual({
      status: 'not_matched',
    });
  });

  it('D: correct offer reference but a DIFFERENT/wrong productId → not_matched', () => {
    expect(
      correlateAppleOffer('ajfit_premium_annual', 'Influencer Trial 7D', ARNALDO_APPLE_CORRELATION),
    ).toEqual({ status: 'not_matched' });
  });

  it('E: annual requested, but no annual Apple correlation configured (ARNALDO fixture) → fail-closed, never matched', () => {
    const result = correlateAppleOffer(
      'ajfit_premium_annual',
      'Influencer Trial 7D Annual',
      ARNALDO_APPLE_CORRELATION,
    );
    expect(result.status).not.toBe('matched');
    expect(result).toEqual({ status: 'not_matched' });
  });

  it('F: annual WITH a real, correctly configured pair → matched, annual', () => {
    expect(
      correlateAppleOffer(
        'ajfit_premium_annual',
        'Influencer Trial 7D Annual',
        ARNALDO_APPLE_CORRELATION_BOTH_PLANS,
      ),
    ).toEqual({ status: 'matched', plan: 'annual' });
  });

  it('monthly and annual are never confused: a monthly offer reference under the annual productId never matches', () => {
    expect(
      correlateAppleOffer(
        'ajfit_premium_annual',
        'Influencer Trial 7D', // this is the MONTHLY offer reference
        ARNALDO_APPLE_CORRELATION_BOTH_PLANS,
      ),
    ).toEqual({ status: 'not_matched' });
  });

  it('the annual offer reference under the monthly productId never matches either', () => {
    expect(
      correlateAppleOffer(
        'ajfit_premium_monthly',
        'Influencer Trial 7D Annual', // this is the ANNUAL offer reference
        ARNALDO_APPLE_CORRELATION_BOTH_PLANS,
      ),
    ).toEqual({ status: 'not_matched' });
  });

  it('returns unsupported (not not_matched) when no Apple correlation config was ever stored for this redemption at all', () => {
    expect(correlateAppleOffer('ajfit_premium_monthly', 'Influencer Trial 7D', null)).toEqual({
      status: 'unsupported',
    });
  });

  it('productId null (event field absent) → not_matched, same treatment as a missing offerCode', () => {
    expect(correlateAppleOffer(null, 'Influencer Trial 7D', ARNALDO_APPLE_CORRELATION)).toEqual({
      status: 'not_matched',
    });
  });

  it('never treats a coincidental offer-reference-only match as proof without the matching productId', () => {
    // Same offerReference as configured, but for a productId that belongs
    // to no configured plan at all.
    expect(
      correlateAppleOffer('com.someother.app.monthly', 'Influencer Trial 7D', ARNALDO_APPLE_CORRELATION),
    ).toEqual({ status: 'not_matched' });
  });

  it('never returns matched for any input when the stored config is null, no matter how compelling the input looks', () => {
    const allInputs: Array<[string | null, string | null]> = [
      [null, null],
      [null, 'Influencer Trial 7D'],
      ['ajfit_premium_monthly', null],
      ['ajfit_premium_monthly', 'Influencer Trial 7D'],
      ['ajfit_premium_annual', 'Influencer Trial 7D Annual'],
      ['', ''],
    ];
    for (const [productId, offerCode] of allInputs) {
      expect(correlateAppleOffer(productId, offerCode, null).status).toBe('unsupported');
    }
  });
});
