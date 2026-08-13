import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

interface FakeDocRef {
  path: string;
}

const transactionMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const docMock = vi.hoisted(() => vi.fn((path: string): FakeDocRef => ({ path })));
const runTransactionMock = vi.hoisted(() =>
  vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) =>
    operation(transactionMocks),
  ),
);

vi.mock('../../lib/firebaseAdmin', () => ({
  db: { doc: docMock, runTransaction: runTransactionMock },
  auth: {},
}));

import {
  applyAttributionRevenueCatEvent,
  classifyInitialPurchasePeriodType,
  decideInitialPurchaseAttributionConfirmation,
  decideRenewalAttributionConfirmation,
  type AttributionConfirmationInput,
} from '../attributionSync';
import {
  parseStoredAppleOfferCorrelationSnapshot,
  parseStoredAppleOfferSnapshot,
} from '../attributionSync';
import type {
  PromoCodeAndroidOfferSnapshot,
  PromoCodeAppleCorrelationSnapshot,
  PromoCodeAppleOfferSnapshot,
} from '../types';

const UID = 'firebase-uid-001';
const REDEMPTION_PATH = `couponRedemptions/${UID}`;
const T1 = 1_786_400_000_000;

const ARNALDO_ANDROID_OFFER: PromoCodeAndroidOfferSnapshot = {
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
};

const ARNALDO_APPLE_OFFER: PromoCodeAppleOfferSnapshot = {
  offerCodeMonthly: 'influencer-trial-7d',
  offerCodeAnnual: 'influencer-trial-7d-annual',
};

/**
 * FASE iOS-6 — the NEW, real correlation snapshot (distinct from
 * `ARNALDO_APPLE_OFFER` above, which stays whatever it always was — see
 * `appleOfferCorrelation.ts`'s doc comment). Modeled on the actual
 * REAL evidence captured (docs/13's FASE iOS-5 section): App Store Connect
 * product `ajfit_premium_monthly` + Offer reference `"Influencer Trial 7D"`.
 * `annual` stays `null` — no real Apple annual offer exists yet (never
 * invented).
 */
const ARNALDO_APPLE_CORRELATION: PromoCodeAppleCorrelationSnapshot = {
  monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
  annual: null,
};

function redemption(overrides: Record<string, unknown> = {}) {
  return {
    uid: UID,
    couponCode: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    influencerId: 'ARNALDO',
    androidOffer: ARNALDO_ANDROID_OFFER,
    appleOffer: ARNALDO_APPLE_OFFER,
    appleOfferCorrelation: ARNALDO_APPLE_CORRELATION,
    appliedAt: Timestamp.fromMillis(T1 - 1000),
    createdAt: Timestamp.fromMillis(T1 - 1000),
    updatedAt: Timestamp.fromMillis(T1 - 1000),
    trialStartedAt: null,
    convertedAt: null,
    lockedAt: null,
    ...overrides,
  };
}

/** Matches ARNALDO's monthly authorized offer by default — override per test. */
function initialPurchaseInput(
  overrides: Partial<Extract<AttributionConfirmationInput, { eventType: 'INITIAL_PURCHASE' }>> = {},
): AttributionConfirmationInput {
  return {
    eventType: 'INITIAL_PURCHASE',
    eventTimestampMs: T1,
    periodType: 'NORMAL',
    store: 'PLAY_STORE',
    productId: 'ajfit_premium:monthly',
    offerCode: 'influencer-trial-7d',
    ...overrides,
  };
}

function mockRedemptionSnapshot(exists: boolean, data?: Record<string, unknown>) {
  transactionMocks.get.mockImplementation(async (ref: FakeDocRef) => {
    if (ref.path === REDEMPTION_PATH) return { exists, data: () => data };
    throw new Error(`unexpected ref.path in test: ${ref.path}`);
  });
}

describe('classifyInitialPurchasePeriodType (pure)', () => {
  it('classifies TRIAL as trial', () => {
    expect(classifyInitialPurchasePeriodType('TRIAL')).toBe('trial');
  });

  it.each(['NORMAL', 'INTRO', 'PREPAID'])('classifies %s as paid', (periodType) => {
    expect(classifyInitialPurchasePeriodType(periodType)).toBe('paid');
  });

  it('classifies PROMOTIONAL as unclassified (not a real store charge, but not a trial either)', () => {
    expect(classifyInitialPurchasePeriodType('PROMOTIONAL')).toBe('unclassified');
  });

  it('classifies a missing period_type as unclassified', () => {
    expect(classifyInitialPurchasePeriodType(undefined)).toBe('unclassified');
  });

  it('classifies an unrecognized future value as unclassified rather than guessing', () => {
    expect(classifyInitialPurchasePeriodType('SOME_FUTURE_VALUE')).toBe('unclassified');
  });
});

describe('decideInitialPurchaseAttributionConfirmation (pure)', () => {
  const MATCHED = { status: 'matched', plan: 'monthly' } as const;
  const NOT_MATCHED = { status: 'not_matched' } as const;

  it('skips when there is no redemption record', () => {
    expect(decideInitialPurchaseAttributionConfirmation(undefined, 'trial', MATCHED)).toEqual({
      action: 'skip_no_redemption',
    });
  });

  it('skips when already locked, even with a matched offer', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: Timestamp.fromMillis(T1) };
    expect(decideInitialPurchaseAttributionConfirmation(current, 'paid', MATCHED)).toEqual({
      action: 'skip_locked',
    });
  });

  it('P/Q/R (core fix): skips with skip_offer_not_matched when correlation fails — regardless of classification', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: null };
    expect(decideInitialPurchaseAttributionConfirmation(current, 'paid', NOT_MATCHED)).toEqual({
      action: 'skip_offer_not_matched',
    });
    expect(decideInitialPurchaseAttributionConfirmation(current, 'trial', NOT_MATCHED)).toEqual({
      action: 'skip_offer_not_matched',
    });
  });

  it('U: confirms trial when matched: locks and sets trialStartedAt, not convertedAt', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: null };
    expect(decideInitialPurchaseAttributionConfirmation(current, 'trial', MATCHED)).toEqual({
      action: 'confirm',
      setTrialStartedAt: true,
      setConvertedAt: false,
    });
  });

  it('V: confirms paid when matched: locks and sets convertedAt, not trialStartedAt', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: null };
    expect(decideInitialPurchaseAttributionConfirmation(current, 'paid', MATCHED)).toEqual({
      action: 'confirm',
      setTrialStartedAt: false,
      setConvertedAt: true,
    });
  });

  it('confirms unclassified when matched: locks, but sets neither trialStartedAt nor convertedAt', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: null };
    expect(decideInitialPurchaseAttributionConfirmation(current, 'unclassified', MATCHED)).toEqual({
      action: 'confirm',
      setTrialStartedAt: false,
      setConvertedAt: false,
    });
  });
});

describe('decideRenewalAttributionConfirmation (pure) — unchanged by Fase 4C.3A, no offer_code dependency', () => {
  it('skips when there is no redemption record', () => {
    expect(decideRenewalAttributionConfirmation(undefined, true)).toEqual({
      action: 'skip_no_redemption',
    });
  });

  it('AC: skips when trialStartedAt was never set — never creates a conversion from nothing', () => {
    const current = { trialStartedAt: null, convertedAt: null, lockedAt: Timestamp.fromMillis(T1) };
    expect(decideRenewalAttributionConfirmation(current, true)).toEqual({
      action: 'skip_not_trial_started',
    });
  });

  it('AD: skips when convertedAt is already set — retry never rewrites it', () => {
    const current = {
      trialStartedAt: Timestamp.fromMillis(T1),
      convertedAt: Timestamp.fromMillis(T1 + 1000),
      lockedAt: Timestamp.fromMillis(T1),
    };
    expect(decideRenewalAttributionConfirmation(current, true)).toEqual({
      action: 'skip_already_converted',
    });
  });

  it('AE: skips when the renewal is not a trial conversion', () => {
    const current = { trialStartedAt: Timestamp.fromMillis(T1), convertedAt: null, lockedAt: Timestamp.fromMillis(T1) };
    expect(decideRenewalAttributionConfirmation(current, false)).toEqual({
      action: 'skip_not_paid_renewal',
    });
  });

  it('AB: confirms conversion when trial started, not yet converted, and is_trial_conversion is true', () => {
    const current = { trialStartedAt: Timestamp.fromMillis(T1), convertedAt: null, lockedAt: Timestamp.fromMillis(T1) };
    expect(decideRenewalAttributionConfirmation(current, true)).toEqual({
      action: 'confirm_conversion',
    });
  });
});

describe('applyAttributionRevenueCatEvent — INITIAL_PURCHASE', () => {
  beforeEach(() => {
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
    runTransactionMock.mockClear();
  });

  it('M: option mensal exata + TRIAL: confirms, locks and sets trialStartedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'TRIAL' }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    expect(transactionMocks.set).toHaveBeenCalledTimes(1);
    const [ref, payload] = transactionMocks.set.mock.calls[0];
    expect((ref as FakeDocRef).path).toBe(REDEMPTION_PATH);
    expect(payload).toMatchObject({
      lockedAt: expect.any(Timestamp),
      trialStartedAt: expect.any(Timestamp),
    });
    expect(payload).not.toHaveProperty('convertedAt');
    expect(payload).not.toHaveProperty('couponCode');
    expect(payload).not.toHaveProperty('subscription');
  });

  it('N: option anual exata + paid: confirms, locks and sets convertedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        periodType: 'NORMAL',
        productId: 'ajfit_premium:annual',
        offerCode: 'influencer-trial-7d-annual',
      }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({
      lockedAt: expect.any(Timestamp),
      convertedAt: expect.any(Timestamp),
    });
    expect(payload).not.toHaveProperty('trialStartedAt');
  });

  it('sem attribution: no-op, follows along normally', async () => {
    mockRedemptionSnapshot(false);

    const result = await applyAttributionRevenueCatEvent(UID, initialPurchaseInput({ periodType: 'TRIAL' }));

    expect(result).toEqual({ status: 'skipped', reason: 'no_redemption' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('attribution já locked: refuses to touch it again, mesmo com a oferta certa', async () => {
    mockRedemptionSnapshot(true, redemption({ lockedAt: Timestamp.fromMillis(T1 - 5000) }));

    const result = await applyAttributionRevenueCatEvent(UID, initialPurchaseInput());

    expect(result).toEqual({ status: 'skipped', reason: 'locked' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('retry do mesmo evento: locking is naturally idempotent (second call is a no-op)', async () => {
    mockRedemptionSnapshot(true, redemption());
    const first = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'TRIAL' }),
    );
    expect(first).toEqual({ status: 'confirmed' });

    transactionMocks.set.mockClear();
    mockRedemptionSnapshot(
      true,
      redemption({ trialStartedAt: Timestamp.fromMillis(T1), lockedAt: Timestamp.fromMillis(T1) }),
    );

    const retry = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'TRIAL' }),
    );

    expect(retry).toEqual({ status: 'skipped', reason: 'locked' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // FASE 4C.3A — SEGURANÇA (P–X): o teste principal desta fase.
  // ===========================================================================

  it('P/Q/R: ARNALDO pendente + compra NORMAL (sem offer_code) → NÃO locked/trialStartedAt/convertedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'NORMAL', offerCode: null }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('S: a compra em si segue processada por subscriptionSync.ts (fora do escopo deste módulo) — este resultado não é um erro', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'NORMAL', offerCode: null }),
    );

    // 'skipped', não uma exceção — nunca impede a resposta 200 do webhook
    // (ver billing/revenuecat.ts's confirmPromoCodeAttributionIfApplicable).
    expect(result.status).toBe('skipped');
  });

  it('W: offer errada + TRIAL → nenhuma confirmação', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'TRIAL', offerCode: 'some-other-offer' }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('X: offer errada + paid → nenhuma confirmação', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'NORMAL', offerCode: 'some-other-offer' }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('plano errado: basePlan mensal + offerId anual → nenhuma confirmação (nunca cruzar planos)', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        productId: 'ajfit_premium:monthly',
        offerCode: 'influencer-trial-7d-annual',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('compra promocional paga sem trial (Store negou trial, mas a oferta foi comprovadamente usada) → confirma convertedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'NORMAL' }), // offerCode ainda bate com o monthly autorizado
    );

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({ convertedAt: expect.any(Timestamp) });
  });

  it('O: APP_STORE with an Android-shaped offer_code value never matches the Apple correlation (different string, different convention)', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: 'influencer-trial-7d', // Android-style value — NOT "Influencer Trial 7D"
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // FASE iOS-6 — real evidence (a captured RevenueCat webhook for a genuine
  // Apple Sandbox Offer Code redemption, docs/13's FASE iOS-5 section) proved
  // `event.offer_code` carries the App Store Connect Offer's reference/name
  // ("Influencer Trial 7D") — `appleOfferCorrelation.ts` now performs a real,
  // deterministic match instead of always returning `unsupported`. This
  // suite proves BOTH directions: a genuine match confirms exactly like
  // Android does, and everything that isn't an exact productId+offerReference
  // match still never confirms (see appleOfferCorrelation.test.ts for the
  // pure-function-level version of the same guarantees).
  // ===========================================================================

  it('J/K: APP_STORE + TRIAL + real, matching productId/offer reference → confirms, locks and sets trialStartedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: 'Influencer Trial 7D', // == ARNALDO_APPLE_CORRELATION.monthly.offerReference
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    const [ref, payload] = transactionMocks.set.mock.calls[0];
    expect((ref as FakeDocRef).path).toBe(REDEMPTION_PATH);
    expect(payload).toMatchObject({
      lockedAt: expect.any(Timestamp),
      trialStartedAt: expect.any(Timestamp),
    });
    expect(payload).not.toHaveProperty('convertedAt');
  });

  it('APP_STORE + paid (NORMAL) + real, matching productId/offer reference → confirms, locks and sets convertedAt, not trialStartedAt', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: 'Influencer Trial 7D',
        periodType: 'NORMAL',
      }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({
      lockedAt: expect.any(Timestamp),
      convertedAt: expect.any(Timestamp),
    });
    expect(payload).not.toHaveProperty('trialStartedAt');
  });

  it('L: APP_STORE + paid + no offer_code at all → never confirms, trialStartedAt/lockedAt stay untouched', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_annual',
        offerCode: null,
        periodType: 'NORMAL',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('L: APP_STORE + correct offer reference but WRONG productId → never confirms', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_annual', // ARNALDO's monthly reference, wrong product
        offerCode: 'Influencer Trial 7D',
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('APP_STORE with no appleOfferCorrelation ever configured on the redemption (legacy or Android-only code) → never confirms', async () => {
    mockRedemptionSnapshot(true, redemption({ appleOfferCorrelation: undefined }));

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: 'Influencer Trial 7D',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('monthly and annual Apple offers are never confused: the monthly offer reference under the annual productId never matches', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_annual',
        offerCode: 'Influencer Trial 7D', // this is the MONTHLY reference
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('E: annual requested, but ARNALDO has no annual Apple correlation configured → fail-closed, never matched even with a plausible-looking offer reference', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_annual',
        offerCode: 'Influencer Trial 7D Annual',
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('N: PLAY_STORE correlation is untouched by the presence of a fully-configured appleOfferCorrelation snapshot on the same redemption', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(UID, initialPurchaseInput({ periodType: 'TRIAL' }));

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({ trialStartedAt: expect.any(Timestamp) });
  });

  it('redemption legado sem androidOffer + compra normal → não confirma (AI)', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ androidOffer: undefined }), // documento pré-4C.3A: campo nunca existiu
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'NORMAL', offerCode: null }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('redemption legado sem androidOffer + compra trial → não confirma, mesmo com period_type TRIAL (AJ)', async () => {
    mockRedemptionSnapshot(true, redemption({ androidOffer: undefined }));

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({ periodType: 'TRIAL', offerCode: 'influencer-trial-7d' }),
    );

    // Sem snapshot algum para correlacionar contra — nunca reconstruído
    // silenciosamente a partir do catálogo `promoCodes` ao vivo.
    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('documento removido durante a transação: no write, no crash', async () => {
    mockRedemptionSnapshot(false);

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'no_redemption' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });
});

describe('applyAttributionRevenueCatEvent — RENEWAL (inalterado pela Fase 4C.3A)', () => {
  beforeEach(() => {
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
    runTransactionMock.mockClear();
  });

  // FASE iOS-6, Parte 9 — RENEWAL confirmation (`decideRenewalAttributionConfirmation`)
  // has ZERO dependency on `store`/`appleOfferCorrelation`/`androidOffer` — it
  // only looks at `trialStartedAt`/`convertedAt` already stored on the
  // redemption and `is_trial_conversion` from the event. Since the store
  // proof happens exactly once, at INITIAL_PURCHASE (see this function's top
  // doc comment), no parallel Apple-specific RENEWAL logic was created — the
  // EXACT SAME mechanism the "AB"/"AD"/"AC"/"AE" tests above already prove
  // for Android applies verbatim once `trialStartedAt` was set by a matched
  // Apple correlation instead. These two tests make that explicit.
  it('M: RENEWAL after an Apple-confirmed trial (trialStartedAt set via a matched APP_STORE INITIAL_PURCHASE): sets convertedAt', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({
        trialStartedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
        lockedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
      }),
    );

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({ convertedAt: expect.any(Timestamp) });
  });

  it('N: RENEWAL with no Apple trial ever confirmed (trialStartedAt still null) → convertedAt is never created', async () => {
    mockRedemptionSnapshot(true, redemption()); // trialStartedAt: null (default)

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'not_trial_started' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('AB: RENEWAL após trial corretamente correlacionado (is_trial_conversion=true): sets convertedAt', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({
        trialStartedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
        lockedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
      }),
    );

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'confirmed' });
    const [ref, payload] = transactionMocks.set.mock.calls[0];
    expect((ref as FakeDocRef).path).toBe(REDEMPTION_PATH);
    expect(payload).toEqual({
      convertedAt: expect.any(Timestamp),
      updatedAt: expect.anything(),
    });
    expect(payload).not.toHaveProperty('lockedAt');
    expect(payload).not.toHaveProperty('subscription');
  });

  it('AD: segunda RENEWAL não altera convertedAt já definido', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({
        trialStartedAt: Timestamp.fromMillis(T1 - 14 * 86400000),
        convertedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
        lockedAt: Timestamp.fromMillis(T1 - 14 * 86400000),
      }),
    );

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'already_converted' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('AC: RENEWAL sem trialStartedAt correlacionado: skip, nunca inventa uma conversão do nada', async () => {
    mockRedemptionSnapshot(true, redemption({ lockedAt: Timestamp.fromMillis(T1 - 1000) }));

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: true,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'not_trial_started' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('AE: is_trial_conversion=false: skip, mesmo com trial iniciado e não convertido', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({
        trialStartedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
        lockedAt: Timestamp.fromMillis(T1 - 7 * 86400000),
      }),
    );

    const result = await applyAttributionRevenueCatEvent(UID, {
      eventType: 'RENEWAL',
      eventTimestampMs: T1,
      isTrialConversion: false,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'not_paid_renewal' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });
});

describe('nenhum caminho escreve em users/{uid} ou subscription, e nenhum concede Premium', () => {
  beforeEach(() => {
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
  });

  it('T: só chama db.doc para couponRedemptions/{uid}, nunca para users/{uid}', async () => {
    mockRedemptionSnapshot(true, redemption());

    await applyAttributionRevenueCatEvent(UID, initialPurchaseInput());

    expect(docMock).toHaveBeenCalledWith(REDEMPTION_PATH);
    expect(docMock).not.toHaveBeenCalledWith(`users/${UID}`);
  });

  it('resposta nunca contém entitlement/premium/subscription', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(UID, initialPurchaseInput());

    expect(JSON.stringify(result)).not.toMatch(/entitlement|premium|subscription/i);
  });
});

// FASE iOS-1 — defensive reader for the new `appleOffer` field, mirroring
// the existing coverage `parseStoredAndroidOfferSnapshot` already has via
// the "redemption legado" tests above.
describe('parseStoredAppleOfferSnapshot (pure)', () => {
  it('parses a well-formed snapshot', () => {
    expect(parseStoredAppleOfferSnapshot(ARNALDO_APPLE_OFFER)).toEqual(ARNALDO_APPLE_OFFER);
  });

  it('resolves both plans to null when the field is entirely absent (pre-FASE iOS-1 document)', () => {
    expect(parseStoredAppleOfferSnapshot(undefined)).toBeNull();
    expect(parseStoredAppleOfferSnapshot(null)).toBeNull();
  });

  it('resolves a non-object value to null rather than throwing', () => {
    expect(parseStoredAppleOfferSnapshot('not-an-object')).toBeNull();
    expect(parseStoredAppleOfferSnapshot(42)).toBeNull();
  });

  it('resolves a plan to null when its field is present but not a string, never fabricating a value', () => {
    expect(
      parseStoredAppleOfferSnapshot({ offerCodeMonthly: 123, offerCodeAnnual: 'valid-code' }),
    ).toEqual({ offerCodeMonthly: null, offerCodeAnnual: 'valid-code' });
  });

  it('treats missing plan keys as null per plan, not as a whole-object rejection', () => {
    expect(parseStoredAppleOfferSnapshot({})).toEqual({ offerCodeMonthly: null, offerCodeAnnual: null });
  });
});

// FASE iOS-6 — defensive reader for the new `appleOfferCorrelation` field,
// mirroring `parseStoredAndroidOfferSnapshot`'s/`parseStoredAppleOfferSnapshot`'s
// policy exactly.
describe('parseStoredAppleOfferCorrelationSnapshot (pure)', () => {
  it('parses a well-formed snapshot', () => {
    expect(parseStoredAppleOfferCorrelationSnapshot(ARNALDO_APPLE_CORRELATION)).toEqual(
      ARNALDO_APPLE_CORRELATION,
    );
  });

  it('resolves both plans to null when the field is entirely absent (pre-FASE iOS-6 document)', () => {
    expect(parseStoredAppleOfferCorrelationSnapshot(undefined)).toBeNull();
    expect(parseStoredAppleOfferCorrelationSnapshot(null)).toBeNull();
  });

  it('resolves a non-object value to null rather than throwing', () => {
    expect(parseStoredAppleOfferCorrelationSnapshot('not-an-object')).toBeNull();
    expect(parseStoredAppleOfferCorrelationSnapshot(42)).toBeNull();
  });

  it('resolves a plan to null when its config is present but malformed (missing productId), never fabricating a value', () => {
    expect(
      parseStoredAppleOfferCorrelationSnapshot({
        monthly: { offerReference: 'Influencer Trial 7D' }, // missing productId
        annual: null,
      }),
    ).toEqual({ monthly: null, annual: null });
  });

  it('treats missing plan keys as null per plan, not as a whole-object rejection', () => {
    expect(parseStoredAppleOfferCorrelationSnapshot({})).toEqual({ monthly: null, annual: null });
  });
});
