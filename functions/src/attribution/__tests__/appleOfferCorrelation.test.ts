import { describe, expect, it } from 'vitest';
import { correlateAppleOffer } from '../appleOfferCorrelation';
import type { PromoCodeAppleOfferSnapshot } from '../types';

// FASE iOS-1 — `correlateAppleOffer` is deliberately a placeholder: no
// confirmed, deterministic mapping exists yet between a real RevenueCat
// APP_STORE webhook event and "this transaction used offer code X" (see the
// module's doc comment for the full evidence trail). Every one of these
// tests asserts the SAME thing from different angles: the function must
// NEVER return `matched`, no matter how compelling the input looks —
// including a coincidental exact string match, which would be the most
// tempting case to "accidentally" treat as proof.

const CONFIGURED_OFFER: PromoCodeAppleOfferSnapshot = {
  offerCodeMonthly: 'ARNALDO7DMONTHLY',
  offerCodeAnnual: 'ARNALDO7DANNUAL',
};

describe('correlateAppleOffer (pure, FASE iOS-1 placeholder)', () => {
  it('returns unsupported when appleOffer snapshot is null (no config ever stored for this redemption)', () => {
    expect(correlateAppleOffer(null, null)).toEqual({ status: 'unsupported' });
    expect(correlateAppleOffer('ARNALDO7DMONTHLY', null)).toEqual({ status: 'unsupported' });
  });

  it('returns unsupported when the event carries no offer_code at all', () => {
    expect(correlateAppleOffer(null, CONFIGURED_OFFER)).toEqual({ status: 'unsupported' });
  });

  it('returns unsupported even when offerCode EXACTLY equals the configured monthly code — coincidence is not proof', () => {
    expect(correlateAppleOffer('ARNALDO7DMONTHLY', CONFIGURED_OFFER)).toEqual({ status: 'unsupported' });
  });

  it('returns unsupported even when offerCode EXACTLY equals the configured annual code', () => {
    expect(correlateAppleOffer('ARNALDO7DANNUAL', CONFIGURED_OFFER)).toEqual({ status: 'unsupported' });
  });

  it('returns unsupported for a completely unrelated offerCode', () => {
    expect(correlateAppleOffer('some-other-store-string', CONFIGURED_OFFER)).toEqual({
      status: 'unsupported',
    });
  });

  it('never returns matched — no input combination flips this function to matched (no time/order dependence: the signature itself carries no timestamp)', () => {
    const allInputs: Array<[string | null, PromoCodeAppleOfferSnapshot | null]> = [
      [null, null],
      [null, CONFIGURED_OFFER],
      ['ARNALDO7DMONTHLY', null],
      ['ARNALDO7DMONTHLY', CONFIGURED_OFFER],
      ['ARNALDO7DANNUAL', CONFIGURED_OFFER],
      ['', CONFIGURED_OFFER],
    ];
    for (const [offerCode, appleOffer] of allInputs) {
      expect(correlateAppleOffer(offerCode, appleOffer).status).not.toBe('matched');
    }
  });
});
