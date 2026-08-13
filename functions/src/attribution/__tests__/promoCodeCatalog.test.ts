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
  resolveAppleOfferCorrelationPair,
} from '../promoCodeCatalog';

const CREATED_AT = Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z'));

/**
 * Deliberately does NOT include `appleProductIdMonthly`/`appleOfferReferenceMonthly`/
 * `appleProductIdAnnual`/`appleOfferReferenceAnnual` by default — every
 * `promoCodes` document written before FASE iOS-6 looks exactly like this
 * (those four keys entirely absent). `parsePromoCodeDocument` must still
 * parse it successfully, normalizing the absent keys to `null` — see
 * `NORMALIZED_FIELDS` below and the "accepts a fully valid document" test.
 */
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
    appleOfferCodeMonthly: null,
    appleOfferCodeAnnual: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    createdBy: 'admin-uid',
    notes: null,
    ...overrides,
  };
}

/** FASE iOS-6 — what any pre-iOS-6 raw document above normalizes to once parsed. */
const NORMALIZED_APPLE_CORRELATION_FIELDS = {
  appleProductIdMonthly: null,
  appleOfferReferenceMonthly: null,
  appleProductIdAnnual: null,
  appleOfferReferenceAnnual: null,
};

/** FASE 1 — what any pre-Fase-1 raw document above normalizes to once parsed (same absent-key leniency as `NORMALIZED_APPLE_CORRELATION_FIELDS`). */
const NORMALIZED_IOS_PROMOTION_FIELD = {
  iosPromotion: null,
};

describe('parsePromoCodeDocument', () => {
  it('accepts a fully valid document', () => {
    expect(parsePromoCodeDocument(validRawDocument())).toEqual({
      ...validRawDocument(),
      ...NORMALIZED_APPLE_CORRELATION_FIELDS,
      ...NORMALIZED_IOS_PROMOTION_FIELD,
    });
  });

  // FASE iOS-6, Parte 4 — the actual backward-compatibility proof: a
  // pre-iOS-6 document (the four new keys entirely ABSENT, not merely
  // `null`) must keep parsing successfully. Before this phase's leniency
  // (`isOptionalNullableString`), this would have returned `null` (rejected
  // as malformed) for every single pre-existing promo code, including
  // ARNALDO's already-working Android configuration.
  it('FASE iOS-6: a pre-existing document missing the four new Apple correlation keys entirely still parses successfully', () => {
    const raw = validRawDocument(); // no appleProductId*/appleOfferReference* keys at all
    expect('appleProductIdMonthly' in raw).toBe(false);

    const parsed = parsePromoCodeDocument(raw);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject(NORMALIZED_APPLE_CORRELATION_FIELDS);
    // Every pre-existing field (in particular Android, already working)
    // survives byte-for-byte.
    expect(parsed).toMatchObject({
      androidBasePlanIdMonthly: 'monthly',
      androidOfferIdMonthly: 'influencer-trial-7d',
    });
  });

  it('FASE iOS-6: accepts a document with real Apple correlation fields configured (monthly only, annual absent)', () => {
    const doc = validRawDocument({
      appleProductIdMonthly: 'ajfit_premium_monthly',
      appleOfferReferenceMonthly: 'Influencer Trial 7D',
    });

    expect(parsePromoCodeDocument(doc)).toEqual({
      ...doc,
      appleProductIdAnnual: null,
      appleOfferReferenceAnnual: null,
      ...NORMALIZED_IOS_PROMOTION_FIELD,
    });
  });

  it('FASE iOS-6: rejects a non-string, non-null appleOfferReferenceMonthly (wrong type) even though the field is otherwise optional', () => {
    expect(
      parsePromoCodeDocument(validRawDocument({ appleOfferReferenceMonthly: 42 })),
    ).toBeNull();
  });

  it('FASE iOS-6: an explicit null for the new fields is equivalent to their absence', () => {
    const raw = validRawDocument({
      appleProductIdMonthly: null,
      appleOfferReferenceMonthly: null,
      appleProductIdAnnual: null,
      appleOfferReferenceAnnual: null,
    });
    expect(parsePromoCodeDocument(raw)).toEqual(parsePromoCodeDocument(validRawDocument()));
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

  // FASE iOS-1, Passo 4 — confirms the existing appleOfferCodeMonthly/Annual
  // fields (added before this phase) already round-trip real, non-null
  // values correctly. No catalog schema change was needed for FASE iOS-1.
  it('accepts a document with real (non-null) Apple offer codes configured', () => {
    const doc = validRawDocument({
      appleOfferCodeMonthly: 'ARNALDO7DMONTHLY',
      appleOfferCodeAnnual: 'ARNALDO7DANNUAL',
    });
    expect(parsePromoCodeDocument(doc)).toEqual({
      ...doc,
      ...NORMALIZED_APPLE_CORRELATION_FIELDS,
      ...NORMALIZED_IOS_PROMOTION_FIELD,
    });
  });

  it('rejects a non-string, non-null appleOfferCodeMonthly (wrong type)', () => {
    expect(parsePromoCodeDocument(validRawDocument({ appleOfferCodeMonthly: 42 }))).toBeNull();
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
      promoCode: { ...raw, ...NORMALIZED_APPLE_CORRELATION_FIELDS, ...NORMALIZED_IOS_PROMOTION_FIELD },
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

// FASE 4C.1
describe('resolveAndroidOfferPair', () => {
  it('A/B: returns the complete pair when both basePlanId and offerId are set', () => {
    expect(resolveAndroidOfferPair('monthly', 'influencer-trial-7d')).toEqual({
      basePlanId: 'monthly',
      offerId: 'influencer-trial-7d',
    });
    expect(resolveAndroidOfferPair('annual', 'influencer-trial-7d-annual')).toEqual({
      basePlanId: 'annual',
      offerId: 'influencer-trial-7d-annual',
    });
  });

  it('D/E: returns null when both fields are null', () => {
    expect(resolveAndroidOfferPair(null, null)).toBeNull();
  });

  it('F: returns null (fail-closed) when basePlanId is set but offerId is null', () => {
    expect(resolveAndroidOfferPair('monthly', null)).toBeNull();
  });

  it('G: returns null (fail-closed) when offerId is set but basePlanId is null', () => {
    expect(resolveAndroidOfferPair(null, 'influencer-trial-7d')).toBeNull();
  });

  it('never fabricates/infers a missing half from the one that is present', () => {
    // basePlanId "monthly" must never be inferred from an offerId alone —
    // confirms the function looks at nothing but its two explicit inputs.
    expect(resolveAndroidOfferPair(null, 'influencer-trial-7d')).toBeNull();
    expect(resolveAndroidOfferPair('monthly', null)).toBeNull();
  });
});

// FASE iOS-6
describe('resolveAppleOfferCorrelationPair', () => {
  it('returns the complete pair when both productId and offerReference are set', () => {
    expect(resolveAppleOfferCorrelationPair('ajfit_premium_monthly', 'Influencer Trial 7D')).toEqual({
      productId: 'ajfit_premium_monthly',
      offerReference: 'Influencer Trial 7D',
    });
  });

  it('returns null when both fields are null', () => {
    expect(resolveAppleOfferCorrelationPair(null, null)).toBeNull();
  });

  it('returns null (fail-closed) when productId is set but offerReference is null', () => {
    expect(resolveAppleOfferCorrelationPair('ajfit_premium_monthly', null)).toBeNull();
  });

  it('returns null (fail-closed) when offerReference is set but productId is null', () => {
    expect(resolveAppleOfferCorrelationPair(null, 'Influencer Trial 7D')).toBeNull();
  });

  it('never fabricates/infers a missing half from the one that is present', () => {
    expect(resolveAppleOfferCorrelationPair(null, 'Influencer Trial 7D')).toBeNull();
    expect(resolveAppleOfferCorrelationPair('ajfit_premium_monthly', null)).toBeNull();
  });
});
