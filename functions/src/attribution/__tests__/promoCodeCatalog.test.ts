import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const docMock = vi.hoisted(() => vi.fn());
const collectionMock = vi.hoisted(() => vi.fn(() => ({ doc: docMock })));

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { collection: collectionMock },
  auth: {},
}));

import {
  lookupPromoCode,
  parsePromoCodeDocument,
  resolveAndroidOfferPair,
} from '../promoCodeCatalog';

const CREATED_AT = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));

function validRawDocument(overrides: Record<string, unknown> = {}) {
  return {
    code: 'ARNALDO',
    active: true,
    startsAt: null,
    endsAt: null,
    influencerId: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    androidBasePlanIdMonthly: 'monthly',
    androidOfferIdMonthly: 'influencer-trial-7d',
    androidBasePlanIdAnnual: 'annual',
    androidOfferIdAnnual: 'influencer-trial-7d-annual',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    createdBy: 'admin-uid',
    notes: null,
    ...overrides,
  };
}

/** FASE 1 — what any pre-Fase-1 raw document above normalizes to once parsed. */
const NORMALIZED_IOS_PROMOTION_FIELD = {
  iosPromotion: null,
};

/**
 * FASE 5.7 — `validRawDocument()` deliberately omits
 * `androidOfferingIdentifierMonthly`/`androidOfferingIdentifierAnnual`
 * entirely (simulating every real `promoCodes` document written before this
 * phase, including ARNALDO) — this is what that absence normalizes to.
 */
const NORMALIZED_ANDROID_OFFERING_IDENTIFIER_FIELDS = {
  androidOfferingIdentifierMonthly: null,
  androidOfferingIdentifierAnnual: null,
};

describe('parsePromoCodeDocument', () => {
  it('accepts a fully valid document', () => {
    expect(parsePromoCodeDocument(validRawDocument())).toEqual({
      ...validRawDocument(),
      ...NORMALIZED_IOS_PROMOTION_FIELD,
      ...NORMALIZED_ANDROID_OFFERING_IDENTIFIER_FIELDS,
    });
  });

  it('FASE 8: tolerates and ignores every historical Apple Offer Code field', () => {
    const raw = validRawDocument({
      appleOfferCodeMonthly: 'ARNALDO7DMONTHLY',
      appleOfferCodeAnnual: null,
      appleProductIdMonthly: 'ajfit_premium_monthly',
      appleOfferReferenceMonthly: 'Influencer Trial 7D',
      appleProductIdAnnual: null,
      appleOfferReferenceAnnual: null,
    });
    const parsed = parsePromoCodeDocument(raw);
    expect(parsed).toEqual({
      ...validRawDocument(),
      iosPromotion: null,
      ...NORMALIZED_ANDROID_OFFERING_IDENTIFIER_FIELDS,
    });
    expect(parsed).not.toHaveProperty('appleOfferCodeMonthly');
    expect(parsed).not.toHaveProperty('appleOfferCorrelation');
  });

  it('rejects an unknown field', () => {
    expect(parsePromoCodeDocument(validRawDocument({ extraField: 'x' }))).toBeNull();
  });

  it('rejects wrong type for active', () => {
    expect(parsePromoCodeDocument(validRawDocument({ active: 'true' }))).toBeNull();
  });

  it('rejects a non-Timestamp startsAt', () => {
    expect(parsePromoCodeDocument(validRawDocument({ startsAt: '2026-08-01' }))).toBeNull();
  });

  it('rejects null/undefined/array input', () => {
    expect(parsePromoCodeDocument(null)).toBeNull();
    expect(parsePromoCodeDocument(undefined)).toBeNull();
    expect(parsePromoCodeDocument([])).toBeNull();
  });

  // FASE 1 — iosPromotion parsing.
  const VALID_IOS_PROMOTION = {
    offeringIdentifier: 'promo_7d',
    monthlyProductId: 'ajfit_premium_monthly_promo',
    annualProductId: 'ajfit_premium_annual_promo',
  };

  it('FASE 1: a pre-existing document missing iosPromotion entirely still parses successfully, as null', () => {
    const raw = validRawDocument();
    expect('iosPromotion' in raw).toBe(false);

    const parsed = parsePromoCodeDocument(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.iosPromotion).toBeNull();
  });

  it('FASE 1: an explicit null iosPromotion is equivalent to its absence', () => {
    expect(parsePromoCodeDocument(validRawDocument({ iosPromotion: null }))).toEqual(
      parsePromoCodeDocument(validRawDocument()),
    );
  });

  it('FASE 1: accepts a document with a fully valid iosPromotion', () => {
    const doc = validRawDocument({ iosPromotion: VALID_IOS_PROMOTION });
    const parsed = parsePromoCodeDocument(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.iosPromotion).toEqual(VALID_IOS_PROMOTION);
  });

  it('FASE 1: rejects the whole document when iosPromotion is missing one required field — never authorizes a partial config', () => {
    const { annualProductId: _annualProductId, ...partial } = VALID_IOS_PROMOTION;
    expect(parsePromoCodeDocument(validRawDocument({ iosPromotion: partial }))).toBeNull();
  });

  it('FASE 1: rejects the whole document when iosPromotion has an empty-string field', () => {
    expect(
      parsePromoCodeDocument(
        validRawDocument({ iosPromotion: { ...VALID_IOS_PROMOTION, offeringIdentifier: '' } }),
      ),
    ).toBeNull();
  });

  it('FASE 1: rejects the whole document when iosPromotion has an extra unknown key', () => {
    expect(
      parsePromoCodeDocument(
        validRawDocument({ iosPromotion: { ...VALID_IOS_PROMOTION, extra: 'x' } }),
      ),
    ).toBeNull();
  });

  it('FASE 1: rejects the whole document when iosPromotion is a non-object (wrong type)', () => {
    expect(parsePromoCodeDocument(validRawDocument({ iosPromotion: 'promo_7d' }))).toBeNull();
  });

  it('FASE 1: never hardcodes/special-cases a specific campaign — any well-formed iosPromotion parses identically', () => {
    const otherCampaign = {
      offeringIdentifier: 'promo_14d',
      monthlyProductId: 'other_monthly',
      annualProductId: 'other_annual',
    };
    const parsed = parsePromoCodeDocument(
      validRawDocument({ code: 'HELLLEN', iosPromotion: otherCampaign }),
    );
    expect(parsed!.iosPromotion).toEqual(otherCampaign);
  });
});

describe('lookupPromoCode', () => {
  beforeEach(() => {
    docMock.mockReset();
    collectionMock.mockClear();
  });

  it('returns not_found when the document does not exist', async () => {
    docMock.mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) });

    const result = await lookupPromoCode('MISSING');

    expect(result).toEqual({ status: 'not_found' });
    expect(docMock).toHaveBeenCalledWith('MISSING');
  });

  it('returns found with the parsed document when it exists and is well-formed', async () => {
    const raw = validRawDocument();
    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: true, data: () => raw }),
    });

    const result = await lookupPromoCode('ARNALDO');

    expect(result).toEqual({
      status: 'found',
      promoCode: { ...raw, ...NORMALIZED_IOS_PROMOTION_FIELD, ...NORMALIZED_ANDROID_OFFERING_IDENTIFIER_FIELDS },
    });
  });

  it('treats a malformed document as not_found (never trusts a hand-edited catalog entry)', async () => {
    docMock.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ code: 'ARNALDO' }) }),
    });

    const result = await lookupPromoCode('ARNALDO');

    expect(result).toEqual({ status: 'not_found' });
  });
});

// FASE 4C.1, revised FASE 5.3/5.7
describe('resolveAndroidOfferPair', () => {
  it('A/B: returns the complete LEGACY shape when basePlanId + offerId are set (offeringIdentifier absent)', () => {
    expect(resolveAndroidOfferPair('monthly', 'influencer-trial-7d', null)).toEqual({
      basePlanId: 'monthly',
      offerId: 'influencer-trial-7d',
      offeringIdentifier: null,
    });
    expect(resolveAndroidOfferPair('annual', 'influencer-trial-7d-annual', null)).toEqual({
      basePlanId: 'annual',
      offerId: 'influencer-trial-7d-annual',
      offeringIdentifier: null,
    });
  });

  it('FASE 5.7: returns the complete NEW shape when basePlanId + offeringIdentifier are set (offerId absent)', () => {
    expect(resolveAndroidOfferPair('monthly-promo', null, 'coupon_discount')).toEqual({
      basePlanId: 'monthly-promo',
      offerId: null,
      offeringIdentifier: 'coupon_discount',
    });
    expect(resolveAndroidOfferPair('annual-promo', null, 'coupon_discount')).toEqual({
      basePlanId: 'annual-promo',
      offerId: null,
      offeringIdentifier: 'coupon_discount',
    });
  });

  it('D/E: returns null when all three fields are null', () => {
    expect(resolveAndroidOfferPair(null, null, null)).toBeNull();
  });

  it('FASE 5.7: returns null (fail-closed, incomplete) when basePlanId is set but BOTH offerId and offeringIdentifier are null', () => {
    expect(resolveAndroidOfferPair('monthly-promo', null, null)).toBeNull();
  });

  it('FASE 5.7: returns null (fail-closed, ambiguous) when basePlanId, offerId, AND offeringIdentifier are all set', () => {
    expect(resolveAndroidOfferPair('monthly', 'influencer-trial-7d', 'coupon_discount')).toBeNull();
  });

  it('G: returns null (fail-closed) when offerId is set but basePlanId is null', () => {
    expect(resolveAndroidOfferPair(null, 'influencer-trial-7d', null)).toBeNull();
  });

  it('FASE 5.7: returns null (fail-closed) when offeringIdentifier is set but basePlanId is null', () => {
    expect(resolveAndroidOfferPair(null, null, 'coupon_discount')).toBeNull();
  });

  it('never fabricates/infers a basePlanId from an offerId alone', () => {
    expect(resolveAndroidOfferPair(null, 'influencer-trial-7d', null)).toBeNull();
  });
});
