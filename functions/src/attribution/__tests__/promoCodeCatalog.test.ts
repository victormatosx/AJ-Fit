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
    appleOfferCodeMonthly: null,
    appleOfferCodeAnnual: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    createdBy: 'admin-uid',
    notes: null,
    ...overrides,
  };
}

describe('parsePromoCodeDocument', () => {
  it('accepts a fully valid document', () => {
    expect(parsePromoCodeDocument(validRawDocument())).toEqual(validRawDocument());
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
    expect(parsePromoCodeDocument(doc)).toEqual(doc);
  });

  it('rejects a non-string, non-null appleOfferCodeMonthly (wrong type)', () => {
    expect(parsePromoCodeDocument(validRawDocument({ appleOfferCodeMonthly: 42 }))).toBeNull();
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

    expect(result).toEqual({ status: 'found', promoCode: raw });
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
