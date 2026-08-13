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
import type { PromoCodeAndroidOfferSnapshot } from '../types';

const UID = 'firebase-uid-001';
const REDEMPTION_PATH = `couponRedemptions/${UID}`;
const T1 = 1_786_400_000_000;

const ARNALDO_ANDROID_OFFER: PromoCodeAndroidOfferSnapshot = {
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
};

const IOS_PROMOTION = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};

function promoIntent(
  plan: 'monthly' | 'annual' = 'monthly',
  overrides: Record<string, unknown> = {},
) {
  return {
    campaignId: 'campaign-arnaldo',
    plan,
    expectedProductId:
      plan === 'monthly' ? IOS_PROMOTION.monthlyProductId : IOS_PROMOTION.annualProductId,
    offeringIdentifier: IOS_PROMOTION.offeringIdentifier,
    status: 'purchase_pending',
    createdAt: Timestamp.fromMillis(T1 - 5 * 60 * 1000),
    updatedAt: Timestamp.fromMillis(T1 - 5 * 60 * 1000),
    expiresAt: Timestamp.fromMillis(T1 + 5 * 60 * 1000),
    ...overrides,
  };
}

function redemption(overrides: Record<string, unknown> = {}) {
  return {
    uid: UID,
    couponCode: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    influencerId: 'ARNALDO',
    androidOffer: ARNALDO_ANDROID_OFFER,
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
    eventId: 'evt-attribution-initial-001',
    purchasedAtMs: T1,
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

  it('FASE 8: normal App Store product stays unattributed even with offer_code and historical Apple fields', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({
        appleOffer: { offerCodeMonthly: 'historical-code', offerCodeAnnual: null },
        appleOfferCorrelation: {
          monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' },
          annual: null,
        },
      }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: 'Influencer Trial 7D',
        periodType: 'NORMAL',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('N: PLAY_STORE correlation remains intact after retiring Apple Offer Code', async () => {
    mockRedemptionSnapshot(true, redemption());

    const result = await applyAttributionRevenueCatEvent(UID, initialPurchaseInput({ periodType: 'TRIAL' }));

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({ trialStartedAt: expect.any(Timestamp) });
  });

  it('FASE 9: PLAY_STORE ignores iOS purchase state and correlates only the Android snapshot', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent() }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'PLAY_STORE',
        productId: 'ajfit_premium:monthly',
        offerCode: 'influencer-trial-7d',
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    const [, payload] = transactionMocks.set.mock.calls[0];
    expect(payload).toMatchObject({ trialStartedAt: expect.any(Timestamp) });
    expect(payload).not.toHaveProperty('purchaseIntent');
  });

  it('FASE 9: an unsupported store cannot invoke either platform correlation', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent() }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'STRIPE',
        productId: 'ajfit_premium:monthly',
        offerCode: 'influencer-trial-7d',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'offer_not_matched' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
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

describe('applyAttributionRevenueCatEvent — Apple purchase intent FASE 3', () => {
  beforeEach(() => {
    transactionMocks.get.mockReset();
    transactionMocks.set.mockReset();
    docMock.mockClear();
    runTransactionMock.mockClear();
  });

  it.each([
    ['monthly', IOS_PROMOTION.monthlyProductId],
    ['annual', IOS_PROMOTION.annualProductId],
  ] as const)('confirms and atomically consumes a matching %s intent', async (plan, productId) => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent(plan) }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        eventId: `evt-promo-${plan}`,
        eventTimestampMs: T1 + 20 * 60 * 1000,
        purchasedAtMs: T1,
        store: 'APP_STORE',
        productId,
        offerCode: undefined,
        periodType: 'TRIAL',
      }),
    );

    expect(result).toEqual({ status: 'confirmed' });
    const payload = transactionMocks.set.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      lockedAt: Timestamp.fromMillis(T1 + 20 * 60 * 1000),
      trialStartedAt: Timestamp.fromMillis(T1 + 20 * 60 * 1000),
      purchaseIntent: {
        status: 'purchase_confirmed',
        revenueCatEventId: `evt-promo-${plan}`,
        confirmedAt: Timestamp.fromMillis(T1 + 20 * 60 * 1000),
      },
    });
    expect(payload).not.toHaveProperty('subscription');
    expect(payload).not.toHaveProperty('premium');
  });

  it('known promo SKU without intent is a normal no-match and does not fall back to legacy', async () => {
    mockRedemptionSnapshot(true, redemption({ iosPromotion: IOS_PROMOTION }));

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: IOS_PROMOTION.monthlyProductId,
        offerCode: 'Influencer Trial 7D',
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'no_intent' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('a normal product with an active promo intent receives no campaign attribution', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent('monthly') }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: 'ajfit_premium_monthly',
        offerCode: undefined,
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'product_mismatch' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('an annual intent cannot be consumed by the monthly promotional product', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent('annual') }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: IOS_PROMOTION.monthlyProductId,
        offerCode: undefined,
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason: 'product_mismatch' });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it.each([
    ['product_mismatch', { productId: IOS_PROMOTION.annualProductId }],
    ['campaign_mismatch', { purchaseIntent: promoIntent('monthly', { campaignId: 'other' }) }],
    ['offering_mismatch', { purchaseIntent: promoIntent('monthly', { offeringIdentifier: 'other' }) }],
    ['expired', { purchasedAtMs: T1 + 6 * 60 * 1000 }],
    ['purchase_before_intent', { purchasedAtMs: T1 - 6 * 60 * 1000 }],
    ['malformed', { purchasedAtMs: null }],
  ] as const)('returns %s without writing attribution', async (reason, scenario) => {
    const purchaseIntent = 'purchaseIntent' in scenario ? scenario.purchaseIntent : promoIntent();
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent }),
    );

    const result = await applyAttributionRevenueCatEvent(
      UID,
      initialPurchaseInput({
        store: 'APP_STORE',
        productId: IOS_PROMOTION.monthlyProductId,
        ...scenario,
      }),
    );

    expect(result).toEqual({ status: 'skipped', reason });
    expect(transactionMocks.set).not.toHaveBeenCalled();
  });

  it('recognizes an exact retry and rejects a different event against consumed evidence', async () => {
    const confirmedIntent = {
      ...promoIntent(),
      status: 'purchase_confirmed',
      confirmedAt: Timestamp.fromMillis(T1),
      revenueCatEventId: 'evt-attribution-initial-001',
    };
    mockRedemptionSnapshot(
      true,
      redemption({
        iosPromotion: IOS_PROMOTION,
        purchaseIntent: confirmedIntent,
        lockedAt: Timestamp.fromMillis(T1),
        trialStartedAt: Timestamp.fromMillis(T1),
      }),
    );

    await expect(
      applyAttributionRevenueCatEvent(
        UID,
        initialPurchaseInput({ store: 'APP_STORE', productId: IOS_PROMOTION.monthlyProductId }),
      ),
    ).resolves.toEqual({ status: 'skipped', reason: 'already_processed' });
    await expect(
      applyAttributionRevenueCatEvent(
        UID,
        initialPurchaseInput({
          eventId: 'evt-another-purchase',
          store: 'APP_STORE',
          productId: IOS_PROMOTION.monthlyProductId,
        }),
      ),
    ).resolves.toEqual({ status: 'skipped', reason: 'already_consumed' });
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
  // has ZERO dependency on `store` or snapshot fields — it
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

  it('FASE 3: RENEWAL never consumes an old purchase_pending intent', async () => {
    mockRedemptionSnapshot(
      true,
      redemption({ iosPromotion: IOS_PROMOTION, purchaseIntent: promoIntent() }),
    );

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
