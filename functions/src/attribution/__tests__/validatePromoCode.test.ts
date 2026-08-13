import type { CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({ lookupPromoCode: vi.fn() }));
const syncMocks = vi.hoisted(() => ({ applyPromoCodeAttributionTransactionally: vi.fn() }));

// Only `lookupPromoCode` is mocked — `resolveAndroidOfferPair` is the REAL
// implementation (pure, no Firestore dependency), so these tests exercise
// the actual fail-closed pairing logic end-to-end through the handler.
vi.mock('../promoCodeCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../promoCodeCatalog')>();
  return { ...actual, lookupPromoCode: catalogMocks.lookupPromoCode };
});
vi.mock('../attributionSync', () => syncMocks);

import { validatePromoCodeHandler } from '../validatePromoCode';
import type { PromoCodeDocument } from '../types';
import type { ValidatePromoCodeRequestData } from '../types';

const UID = 'firebase-uid-caller';
const NOW = new Date('2026-08-11T12:00:00.000Z');

function promoCode(overrides: Partial<PromoCodeDocument> = {}): PromoCodeDocument {
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
    appleProductIdMonthly: null,
    appleOfferReferenceMonthly: null,
    appleProductIdAnnual: null,
    appleOfferReferenceAnnual: null,
    iosPromotion: null,
    createdAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
    createdBy: 'admin-uid',
    notes: null,
    ...overrides,
  };
}

// FASE 1 — the real ARNALDO iOS promotional config once the campaign is
// migrated to the new Promo SKU + Introductory Offer architecture.
const ARNALDO_IOS_PROMOTION = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};

// `authUid` defaults to the caller's uid when omitted. Deliberately typed as
// `string | null` (not `| undefined`) so tests can force "no auth" via an
// EXPLICIT `null` argument — a default parameter only kicks in for a
// literal `undefined`, so `| undefined` would silently fall back to the
// default even when a caller passes `undefined` on purpose.
function request(
  data: ValidatePromoCodeRequestData,
  authUid: string | null = UID,
): CallableRequest<ValidatePromoCodeRequestData> {
  return {
    data,
    auth: authUid !== null ? { uid: authUid, token: {} as never } : undefined,
    rawRequest: {} as never,
  } as unknown as CallableRequest<ValidatePromoCodeRequestData>;
}

async function expectHttpsError(promise: Promise<unknown>, code: string, message: string) {
  await expect(promise).rejects.toMatchObject({ code, message });
}

describe('validatePromoCodeHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    catalogMocks.lookupPromoCode.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('rejects an unauthenticated caller before touching the catalog', async () => {
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' }, null)),
      'unauthenticated',
      'authentication_required',
    );
    expect(catalogMocks.lookupPromoCode).not.toHaveBeenCalled();
  });

  it('never trusts a uid supplied in the request payload — only request.auth.uid', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(
      request({ code: 'ARNALDO', uid: 'attacker-supplied-uid' } as unknown as ValidatePromoCodeRequestData),
    );

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.anything(),
    );
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['too long', 'A'.repeat(64)],
    ['invalid characters', 'ARNALDO!'],
    ['non-string', 123],
    ['missing', undefined],
  ])('rejects invalid code format: %s', async (_label, code) => {
    await expectHttpsError(
      validatePromoCodeHandler(request({ code } as ValidatePromoCodeRequestData)),
      'invalid-argument',
      'invalid_code_format',
    );
    expect(catalogMocks.lookupPromoCode).not.toHaveBeenCalled();
  });

  it('rejects an invalid platform value', async () => {
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'WEB' })),
      'invalid-argument',
      'invalid_platform',
    );
  });

  it('returns a generic not-found for a nonexistent code (never reveals the reason)', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'not_found' });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'MISSING' })),
      'not-found',
      'promo_code_unavailable',
    );
  });

  it('returns the SAME generic not-found for an inactive code', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ active: false }),
    });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'not-found',
      'promo_code_unavailable',
    );
  });

  it('returns the SAME generic not-found before startsAt', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ startsAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00.000Z')) }),
    });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'not-found',
      'promo_code_unavailable',
    );
  });

  it('returns the SAME generic not-found after endsAt', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ endsAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')) }),
    });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'not-found',
      'promo_code_unavailable',
    );
  });

  it('succeeds for a code with neither startsAt nor endsAt', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));
    expect(result.valid).toBe(true);
  });

  it('normalizes lowercase input end-to-end and looks up the normalized code', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: '  arnaldo  ' }));

    expect(catalogMocks.lookupPromoCode).toHaveBeenCalledWith('ARNALDO');
  });

  it('maps a locked attribution to a distinct, non-code-revealing error', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'locked' });

    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'failed-precondition',
      'attribution_locked',
    );
  });

  it('maps user_not_found from the transaction to a distinct error', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'user_not_found' });

    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'failed-precondition',
      'user_not_found',
    );
  });

  it('returns both android and ios store config when no platform is requested', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android).not.toBeNull();
    expect(result.storeConfig.ios).not.toBeNull();
  });

  it('returns only android store config when platform=ANDROID is requested', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'ANDROID' }));

    expect(result.storeConfig.android).not.toBeNull();
    expect(result.storeConfig.ios).toBeNull();
  });

  it('never confides in a client-supplied offerId/productId — response is derived only from the catalog document', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(
      request({
        code: 'ARNALDO',
        // @ts-expect-error deliberately injecting fields the type doesn't declare
        offerId: 'attacker-offer',
        productId: 'attacker-product',
      }),
    );

    expect(result.storeConfig.android).toEqual({
      monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
      annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
    });
  });

  it('FASE 4C.3A: snapshots androidOffer into the transaction unconditionally, even when platform=IOS was requested', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        androidOffer: {
          monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
          annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
        },
      }),
    );
  });

  it('FASE iOS-1: snapshots appleOffer into the transaction unconditionally, even when platform=ANDROID was requested', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleOfferCodeMonthly: 'ARNALDO7DMONTHLY',
        appleOfferCodeAnnual: 'ARNALDO7DANNUAL',
      }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'ANDROID' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        appleOffer: { offerCodeMonthly: 'ARNALDO7DMONTHLY', offerCodeAnnual: 'ARNALDO7DANNUAL' },
      }),
    );
  });

  it('FASE iOS-1: appleOffer snapshot is {null, null} when the catalog has no Apple codes configured — never fabricated', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        appleOffer: { offerCodeMonthly: null, offerCodeAnnual: null },
      }),
    );
  });

  it('FASE iOS-1: platform=IOS returns the real configured Apple offer codes, monthly and annual never confused', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleOfferCodeMonthly: 'ARNALDO7DMONTHLY',
        appleOfferCodeAnnual: 'ARNALDO7DANNUAL',
      }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.storeConfig.ios).toEqual({
      offerCodeMonthly: 'ARNALDO7DMONTHLY',
      offerCodeAnnual: 'ARNALDO7DANNUAL',
    });
  });

  // ===========================================================================
  // FASE iOS-6 — the NEW, separate correlation snapshot
  // (`appleOfferCorrelation`), distinct from `appleOffer` above. Never
  // returned in the response (it's backend-only, compared later against a
  // real webhook event by `appleOfferCorrelation.ts`) — only ever passed to
  // `applyPromoCodeAttributionTransactionally`.
  // ===========================================================================

  it('H: snapshots appleOfferCorrelation into the transaction unconditionally, from the new catalog fields', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleOfferReferenceMonthly: 'Influencer Trial 7D',
      }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        appleOfferCorrelation: {
          monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
          annual: null,
        },
      }),
    );
  });

  it('H: appleOfferCorrelation is {monthly: null, annual: null} when the catalog has no Apple correlation configured — never fabricated', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ appleOfferCorrelation: { monthly: null, annual: null } }),
    );
  });

  it('H: a partial Apple correlation pair (only productId, no offerReference) fails closed to null for that plan — never half-configured', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ appleProductIdMonthly: 'ajfit_premium_monthly' }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ appleOfferCorrelation: { monthly: null, annual: null } }),
    );
  });

  it('I: appleOfferCorrelation never appears in the client response — backend-only', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleOfferReferenceMonthly: 'Influencer Trial 7D',
      }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(JSON.stringify(result)).not.toContain('appleOfferCorrelation');
    expect(JSON.stringify(result)).not.toContain('Influencer Trial 7D');
  });

  it('I: the Android snapshot passed to the transaction is byte-identical to before FASE iOS-6 (unaffected by Apple correlation fields)', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleProductIdMonthly: 'ajfit_premium_monthly',
        appleOfferReferenceMonthly: 'Influencer Trial 7D',
      }),
    });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        androidOffer: {
          monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
          annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
        },
      }),
    );
  });

  it('never promises a trial and always states the store is the eligibility authority', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.eligibility).toEqual({
      determinedBy: 'store',
      guaranteed: false,
      disclaimer: expect.stringContaining('loja'),
    });
    expect(JSON.stringify(result)).not.toMatch(/trial.*(garantid|concedid)/i);
  });

  it('response never contains subscription/entitlement/premium fields', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result).not.toHaveProperty('subscription');
    expect(result).not.toHaveProperty('entitlement');
    expect(result).not.toHaveProperty('premium');
  });
});

// Real ARNALDO/ARNALDOANUAL configuration — mirrors the actual
// `promoCodes/ARNALDO` document once the real Apple Custom Offer Codes were
// registered: monthly has both the client-facing code AND a proven backend
// correlation pair; annual has the client-facing code but NO backend
// correlation pair yet (appleOfferReferenceAnnual still unproven).
describe('validatePromoCodeHandler — real ARNALDO/ARNALDOANUAL configuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    catalogMocks.lookupPromoCode.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });
  });

  afterEach(() => vi.useRealTimers());

  function realArnaldoPromoCode(): PromoCodeDocument {
    return promoCode({
      appleOfferCodeMonthly: 'ARNALDO',
      appleOfferCodeAnnual: 'ARNALDOANUAL',
      appleProductIdMonthly: 'ajfit_premium_monthly',
      appleOfferReferenceMonthly: 'Influencer Trial 7D',
      appleProductIdAnnual: 'ajfit_premium_annual',
      appleOfferReferenceAnnual: null,
    });
  }

  it('returns ARNALDO/ARNALDOANUAL as the iOS store config, monthly and annual never confused', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: realArnaldoPromoCode() });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.storeConfig.ios).toEqual({
      offerCodeMonthly: 'ARNALDO',
      offerCodeAnnual: 'ARNALDOANUAL',
    });
  });

  it('snapshots a matched monthly correlation but a null annual correlation into the transaction — appleProductIdAnnual alone (no offerReference) never fabricates a pair', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: realArnaldoPromoCode() });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        appleOfferCorrelation: {
          monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
          annual: null,
        },
      }),
    );
  });

  it('the annual client offer code is still returned even though the backend correlation for annual is absent — client redemption never depends on backend correlation', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: realArnaldoPromoCode() });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.storeConfig.ios?.offerCodeAnnual).toBe('ARNALDOANUAL');
  });

  it('ARNALDOANUAL (the client-facing annual code) never appears anywhere as an offerReference/correlation value', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: realArnaldoPromoCode() });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    const call = syncMocks.applyPromoCodeAttributionTransactionally.mock.calls[0][1];
    expect(JSON.stringify(call.appleOfferCorrelation)).not.toContain('ARNALDOANUAL');
  });

  it('Android storeConfig stays byte-identical to before ARNALDO/ARNALDOANUAL were configured', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: realArnaldoPromoCode() });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android).toEqual({
      monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
      annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
    });
  });
});

// FASE 4C.1 — nested android storeConfig contract, fail-closed pairing, platform isolation.
describe('validatePromoCodeHandler — Fase 4C.1 android storeConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    catalogMocks.lookupPromoCode.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });
  });

  afterEach(() => vi.useRealTimers());

  it('A: monthly complete → returns basePlanId + offerId for monthly', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdAnnual: null, androidOfferIdAnnual: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.monthly).toEqual({
      basePlanId: 'monthly',
      offerId: 'influencer-trial-7d',
    });
  });

  it('B: annual complete → returns basePlanId + offerId for annual', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdMonthly: null, androidOfferIdMonthly: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.annual).toEqual({
      basePlanId: 'annual',
      offerId: 'influencer-trial-7d-annual',
    });
  });

  it('C: both complete → both returned', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android).toEqual({
      monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
      annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
    });
  });

  it('D: monthly completely null → monthly null', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdMonthly: null, androidOfferIdMonthly: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.monthly).toBeNull();
  });

  it('E: annual completely null → annual null', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdAnnual: null, androidOfferIdAnnual: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.annual).toBeNull();
  });

  it('F: monthly basePlanId present, offerId absent → monthly null (fail-closed, never half-filled)', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidOfferIdMonthly: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.monthly).toBeNull();
  });

  it('G: monthly offerId present, basePlanId absent → monthly null (fail-closed, never guessed)', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdMonthly: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.monthly).toBeNull();
  });

  it('H: annual basePlanId present, offerId absent → annual null', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidOfferIdAnnual: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.annual).toBeNull();
  });

  it('H: annual offerId present, basePlanId absent → annual null', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ androidBasePlanIdAnnual: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.storeConfig.android?.annual).toBeNull();
  });

  it('I: platform=android never leaks ios config', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        appleOfferCodeMonthly: 'apple-monthly-code',
        appleOfferCodeAnnual: 'apple-annual-code',
      }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'ANDROID' }));

    expect(result.storeConfig.ios).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/apple-(monthly|annual)-code/);
  });

  it('J: platform=ios never leaks android config', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.storeConfig.android).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/basePlanId|monthly:influencer|annual:influencer/);
  });

  it('K: nonexistent code stays indistinguishable from inactive/out-of-window (existing contract preserved)', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'not_found' });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'MISSING' })),
      'not-found',
      'promo_code_unavailable',
    );

    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ active: false }),
    });
    await expectHttpsError(
      validatePromoCodeHandler(request({ code: 'ARNALDO' })),
      'not-found',
      'promo_code_unavailable',
    );
  });

  it('L: no response ever affirms the trial is guaranteed, regardless of pair completeness', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode(),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.eligibility.guaranteed).toBe(false);
    expect(result.eligibility.determinedBy).toBe('store');
  });

  it('M/N: this suite never calls anything that could write subscription/entitlement/Premium', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({ status: 'found', promoCode: promoCode() });

    await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    // The only Firestore-adjacent dependency this handler calls is the
    // attribution transaction — asserting on its mock proves no other
    // (subscription-writing) module was ever invoked from this handler.
    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledTimes(1);
  });
});

// FASE 1 — new iOS promotional (Offering/SKU) contract. Deliberately
// UNRELATED to the legacy Apple Offer Code fields exercised above (which
// stay byte-for-byte unchanged) — see `IOSPromotionConfig`'s doc comment.
describe('validatePromoCodeHandler — FASE 1 iosPromotion contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    catalogMocks.lookupPromoCode.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockReset();
    syncMocks.applyPromoCodeAttributionTransactionally.mockResolvedValue({ status: 'applied' });
  });

  afterEach(() => vi.useRealTimers());

  it('a campaign configured for the new flow returns the exact iosPromotion the server derived from the catalog — never the legacy storeConfig.ios shape', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);
  });

  it('a campaign with no iOS promotional configuration returns iosPromotion: null — never fabricated', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: null }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    expect(result.iosPromotion).toBeNull();
  });

  it('platform=android never receives iosPromotion, even when the campaign has one configured', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'ANDROID' }));

    expect(result.iosPromotion).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/promo_7d|_promo/);
  });

  it('platform omitted returns iosPromotion alongside both storeConfig entries — client decides, server never guesses', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO' }));

    expect(result.iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);
    expect(result.storeConfig.android).not.toBeNull();
  });

  it('snapshots the campaign iosPromotion into couponRedemptions/{uid} verbatim, unconditionally regardless of requested platform', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'ANDROID' }));

    expect(syncMocks.applyPromoCodeAttributionTransactionally).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    );
  });

  it('the server NEVER trusts a client-supplied offeringIdentifier/productId — the request payload has no such fields to begin with, and the response is always derived from the catalog', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    // A malicious/confused client tries to smuggle its own offering choice
    // into the request — `ValidatePromoCodeRequestData` has no field for
    // this, so it is silently ignored by construction, never read anywhere.
    const result = await validatePromoCodeHandler(
      request({
        code: 'ARNALDO',
        platform: 'IOS',
        offeringIdentifier: 'attacker_chosen_offering',
        monthlyProductId: 'attacker_chosen_product',
      } as unknown as ValidatePromoCodeRequestData),
    );

    expect(result.iosPromotion).toEqual(ARNALDO_IOS_PROMOTION);
  });

  it('applying a valid iOS promotional code never defines lockedAt/trialStartedAt/convertedAt — that remains applyAttributionRevenueCatEvent-only, never validatePromoCode', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    const call = syncMocks.applyPromoCodeAttributionTransactionally.mock.calls[0][1];
    // `applyPromoCodeAttributionTransactionally` (attributionSync.ts) is the
    // one that actually writes `lockedAt`/`trialStartedAt`/`convertedAt: null`
    // unconditionally on every apply — this handler never passes those
    // fields into `PendingPromoCodeAttribution` at all, proving it has no
    // way to influence them.
    expect(call).not.toHaveProperty('lockedAt');
    expect(call).not.toHaveProperty('trialStartedAt');
    expect(call).not.toHaveProperty('convertedAt');
  });

  it('applying a valid iOS promotional code never claims Premium/entitlement was granted — no such field anywhere in the response shape', async () => {
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({ iosPromotion: ARNALDO_IOS_PROMOTION }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'ARNALDO', platform: 'IOS' }));

    // Product identifiers legitimately contain the word "premium" (e.g.
    // `ajfit_premium_monthly_promo`) — this checks for a GRANT claim
    // (`entitlement`/`isPremium`/`premiumActive`-shaped field), never a
    // naive substring match against product IDs.
    expect(result).not.toHaveProperty('entitlement');
    expect(result).not.toHaveProperty('isPremium');
    expect(result).not.toHaveProperty('premiumActive');
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(/entitlement/);
  });

  it('does not hardcode ARNALDO — a second, differently-named campaign with its own iosPromotion is authorized identically', async () => {
    const otherCampaignPromotion = {
      offeringIdentifier: 'promo_14d',
      monthlyProductId: 'ajfit_premium_monthly_promo_v2',
      annualProductId: 'ajfit_premium_annual_promo_v2',
    };
    catalogMocks.lookupPromoCode.mockResolvedValue({
      status: 'found',
      promoCode: promoCode({
        code: 'HELLLEN',
        influencerId: 'HELLLEN',
        campaignId: 'campaign-helllen',
        iosPromotion: otherCampaignPromotion,
      }),
    });

    const result = await validatePromoCodeHandler(request({ code: 'HELLLEN', platform: 'IOS' }));

    expect(result.iosPromotion).toEqual(otherCampaignPromotion);
  });
});
