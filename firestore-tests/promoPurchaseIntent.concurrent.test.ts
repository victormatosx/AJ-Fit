/**
 * Real Firestore-emulator coverage for the promotional iOS architecture.
 * Unlike the unit tests' serialized in-memory models, this suite crosses the
 * real catalog, validation, snapshot, purchase-intent and webhook transactions
 * and lets Firestore's optimistic retry behavior resolve contention.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../functions/src/lib/firebaseAdmin';
import {
  applyAttributionRevenueCatEvent,
  applyPromoCodeAttributionTransactionally,
} from '../functions/src/attribution/attributionSync';
import { authorizePromoPurchaseHandler } from '../functions/src/attribution/authorizePromoPurchase';
import { authorizePromoPurchaseTransactionally } from '../functions/src/attribution/promoPurchaseIntent';
import type {
  AuthorizePromoPurchaseRequestData,
  ValidatePromoCodeRequestData,
} from '../functions/src/attribution/types';
import { validatePromoCodeHandler } from '../functions/src/attribution/validatePromoCode';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'promo-intent-concurrency-user';
const REDEMPTION_PATH = `couponRedemptions/${UID}`;
const USER_PATH = `users/${UID}`;
const ARNALDO_PATH = 'promoCodes/ARNALDO';
const JOAO_PATH = 'promoCodes/JOAO';
let testEnv: RulesTestEnvironment;

const ARNALDO_ATTRIBUTION = {
  couponCode: 'ARNALDO',
  campaignId: 'campaign-arnaldo',
  influencerId: 'ARNALDO',
  androidOffer: { monthly: null, annual: null },
  iosPromotion: {
    offeringIdentifier: 'promo_7d',
    monthlyProductId: 'ajfit_premium_monthly_promo',
    annualProductId: 'ajfit_premium_annual_promo',
  },
};

const JOAO_ATTRIBUTION = {
  couponCode: 'JOAO',
  campaignId: 'campaign-joao',
  influencerId: 'JOAO',
  androidOffer: { monthly: null, annual: null },
  iosPromotion: {
    offeringIdentifier: 'promo_7d_joao',
    monthlyProductId: 'ajfit_premium_monthly_promo_joao',
    annualProductId: 'ajfit_premium_annual_promo_joao',
  },
};

function promoCodeDocument(attribution: typeof ARNALDO_ATTRIBUTION) {
  const now = new Date();
  return {
    code: attribution.couponCode,
    active: true,
    startsAt: null,
    endsAt: null,
    influencerId: attribution.influencerId,
    campaignId: attribution.campaignId,
    androidBasePlanIdMonthly: null,
    androidOfferIdMonthly: null,
    androidBasePlanIdAnnual: null,
    androidOfferIdAnnual: null,
    iosPromotion: attribution.iosPromotion,
    createdAt: now,
    updatedAt: now,
    createdBy: 'phase-10-emulator',
    notes: null,
  };
}

function callableRequest<T>(data: T) {
  return {
    data,
    auth: { uid: UID, token: {} as never },
    rawRequest: {} as never,
  } as never;
}

function validateIOSCode(code: string) {
  return validatePromoCodeHandler(
    callableRequest<ValidatePromoCodeRequestData>({ code, platform: 'IOS' }),
  );
}

function authorizePlan(plan: 'monthly' | 'annual') {
  return authorizePromoPurchaseHandler(
    callableRequest<AuthorizePromoPurchaseRequestData>({ plan }),
  );
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await db.doc(REDEMPTION_PATH).delete();
  await db.doc(USER_PATH).delete();
  await db.doc(ARNALDO_PATH).delete();
  await db.doc(JOAO_PATH).delete();
  await testEnv.cleanup();
});

beforeEach(async () => {
  await db.doc(USER_PATH).set({ createdAt: new Date() });
  await db.doc(ARNALDO_PATH).set(promoCodeDocument(ARNALDO_ATTRIBUTION));
  await db.doc(JOAO_PATH).set(promoCodeDocument(JOAO_ATTRIBUTION));
  await db.doc(REDEMPTION_PATH).set({
    uid: UID,
    couponCode: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    influencerId: 'ARNALDO',
    iosPromotion: {
      offeringIdentifier: 'promo_7d',
      monthlyProductId: 'ajfit_premium_monthly_promo',
      annualProductId: 'ajfit_premium_annual_promo',
    },
    lockedAt: null,
    trialStartedAt: null,
    convertedAt: null,
  });
});

describe('promo purchase intent — Firestore emulator', () => {
  it.each([
    ['couponRedemptions', { uid: UID, couponCode: 'ATTACKER' }],
    ['purchaseIntent', { purchaseIntent: { status: 'purchase_pending' } }],
    ['lockedAt', { lockedAt: new Date() }],
    ['trialStartedAt', { trialStartedAt: new Date() }],
    ['convertedAt', { convertedAt: new Date() }],
  ])('denies a direct client write to the sensitive %s state', async (_field, payload) => {
    const client = testEnv.authenticatedContext(UID).firestore();
    await assertFails(
      setDoc(doc(client, 'couponRedemptions', UID), payload, { merge: true }),
    );
  });

  it('serializes concurrent monthly and annual authorization for the same uid', async () => {
    const results = await Promise.all([
      authorizePromoPurchaseTransactionally(UID, 'monthly'),
      authorizePromoPurchaseTransactionally(UID, 'annual'),
    ]);

    const authorized = results.filter((result) => result.status === 'authorized');
    const conflicts = results.filter((result) => result.status === 'intent_conflict');
    expect(authorized).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const stored = (await db.doc(REDEMPTION_PATH).get()).data();
    expect(stored?.purchaseIntent).toMatchObject({
      status: 'purchase_pending',
      plan: authorized[0].status === 'authorized' ? authorized[0].intent.plan : undefined,
      expectedProductId:
        authorized[0].status === 'authorized' ? authorized[0].intent.expectedProductId : undefined,
    });
  });

  it('serializes two devices authorizing the same monthly purchase into one reusable intent', async () => {
    const results = await Promise.all([
      authorizePromoPurchaseTransactionally(UID, 'monthly'),
      authorizePromoPurchaseTransactionally(UID, 'monthly'),
    ]);

    expect(results.every((result) => result.status === 'authorized')).toBe(true);
    const authorized = results.filter((result) => result.status === 'authorized');
    expect(authorized.filter((result) => result.reused)).toHaveLength(1);
    expect(authorized.filter((result) => !result.reused)).toHaveLength(1);
    if (authorized[0]?.status === 'authorized' && authorized[1]?.status === 'authorized') {
      expect(authorized[0].intent.createdAt.toMillis()).toBe(
        authorized[1].intent.createdAt.toMillis(),
      );
      expect(authorized[0].intent.expiresAt.toMillis()).toBe(
        authorized[1].intent.expiresAt.toMillis(),
      );
    }
  });

  it('serializes two different codes without tearing redemption and user mirror', async () => {
    const results = await Promise.all([
      applyPromoCodeAttributionTransactionally(UID, ARNALDO_ATTRIBUTION),
      applyPromoCodeAttributionTransactionally(UID, JOAO_ATTRIBUTION),
    ]);

    expect(results).toEqual([{ status: 'applied' }, { status: 'applied' }]);
    const redemption = (await db.doc(REDEMPTION_PATH).get()).data();
    const user = (await db.doc(USER_PATH).get()).data();
    expect(['ARNALDO', 'JOAO']).toContain(redemption?.couponCode);
    const winningAttribution =
      redemption?.couponCode === 'ARNALDO' ? ARNALDO_ATTRIBUTION : JOAO_ATTRIBUTION;
    expect(redemption).toMatchObject(winningAttribution);
    expect(user?.attribution).toMatchObject({
      couponCode: winningAttribution.couponCode,
      campaignId: winningAttribution.campaignId,
      influencerId: winningAttribution.influencerId,
    });
  });

  it('does not authorize a uid whose attribution is already locked', async () => {
    await db.doc(REDEMPTION_PATH).set({ lockedAt: new Date() }, { merge: true });

    await expect(authorizePromoPurchaseTransactionally(UID, 'monthly')).resolves.toEqual({
      status: 'redemption_consumed',
    });
    const stored = (await db.doc(REDEMPTION_PATH).get()).data();
    expect(stored).not.toHaveProperty('purchaseIntent');
  });

  it.each([
    ['monthly', 'ajfit_premium_monthly_promo'],
    ['annual', 'ajfit_premium_annual_promo'],
  ] as const)(
    'runs validate → snapshot → authorize → %s webhook → locked attribution end to end',
    async (plan, productId) => {
      const validation = await validateIOSCode('ARNALDO');
      expect(validation).toMatchObject({
        valid: true,
        code: 'ARNALDO',
        iosPromotion: ARNALDO_ATTRIBUTION.iosPromotion,
      });

      const afterValidation = (await db.doc(REDEMPTION_PATH).get()).data();
      expect(afterValidation).toMatchObject({
        couponCode: 'ARNALDO',
        campaignId: 'campaign-arnaldo',
        iosPromotion: ARNALDO_ATTRIBUTION.iosPromotion,
        lockedAt: null,
      });
      expect(afterValidation).not.toHaveProperty('purchaseIntent');

      const authorization = await authorizePlan(plan);
      expect(authorization).toMatchObject({
        authorized: true,
        purchaseIntent: {
          plan,
          offeringIdentifier: 'promo_7d',
          expectedProductId: productId,
          status: 'purchase_pending',
        },
      });

      const pending = (await db.doc(REDEMPTION_PATH).get()).data();
      const intent = pending?.purchaseIntent;
      expect(intent).toMatchObject({ plan, expectedProductId: productId, status: 'purchase_pending' });
      const purchasedAtMs = intent.createdAt.toMillis() + 1;
      await expect(
        applyAttributionRevenueCatEvent(UID, {
          eventType: 'INITIAL_PURCHASE',
          eventId: `evt-e2e-like-${plan}`,
          eventTimestampMs: purchasedAtMs + 1000,
          purchasedAtMs,
          periodType: 'TRIAL',
          store: 'APP_STORE',
          productId,
          offerCode: undefined,
        }),
      ).resolves.toEqual({ status: 'confirmed' });

      const confirmed = (await db.doc(REDEMPTION_PATH).get()).data();
      expect(confirmed).toMatchObject({
        couponCode: 'ARNALDO',
        lockedAt: expect.anything(),
        trialStartedAt: expect.anything(),
        purchaseIntent: {
          plan,
          expectedProductId: productId,
          status: 'purchase_confirmed',
          revenueCatEventId: `evt-e2e-like-${plan}`,
        },
      });
      expect(confirmed).not.toHaveProperty('premium');
      expect(confirmed).not.toHaveProperty('entitlement');
      expect(confirmed).not.toHaveProperty('subscription');

      await expect(validateIOSCode('ARNALDO')).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'attribution_locked',
      });
      await expect(validateIOSCode('JOAO')).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'attribution_locked',
      });
      const afterReuseAttempts = (await db.doc(REDEMPTION_PATH).get()).data();
      expect(afterReuseAttempts).toMatchObject({
        couponCode: 'ARNALDO',
        iosPromotion: ARNALDO_ATTRIBUTION.iosPromotion,
        purchaseIntent: { status: 'purchase_confirmed' },
      });
    },
  );

  it('keeps a monthly intent pending when an annual webhook product mismatches', async () => {
    await validateIOSCode('ARNALDO');
    await authorizePlan('monthly');
    const pending = (await db.doc(REDEMPTION_PATH).get()).data();
    const purchasedAtMs = pending?.purchaseIntent.createdAt.toMillis() + 1;

    await expect(
      applyAttributionRevenueCatEvent(UID, {
        eventType: 'INITIAL_PURCHASE',
        eventId: 'evt-e2e-like-mismatch',
        eventTimestampMs: purchasedAtMs + 1000,
        purchasedAtMs,
        periodType: 'TRIAL',
        store: 'APP_STORE',
        productId: 'ajfit_premium_annual_promo',
        offerCode: undefined,
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'product_mismatch' });

    const stored = (await db.doc(REDEMPTION_PATH).get()).data();
    expect(stored).toMatchObject({
      lockedAt: null,
      trialStartedAt: null,
      purchaseIntent: { plan: 'monthly', status: 'purchase_pending' },
    });
  });

  it('authorizes from the immutable redemption snapshot after the live catalog changes', async () => {
    await validateIOSCode('ARNALDO');
    await db.doc(ARNALDO_PATH).set(
      {
        iosPromotion: {
          offeringIdentifier: 'changed_live_catalog',
          monthlyProductId: 'changed_monthly',
          annualProductId: 'changed_annual',
        },
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await expect(authorizePlan('monthly')).resolves.toMatchObject({
      purchaseIntent: {
        offeringIdentifier: 'promo_7d',
        expectedProductId: 'ajfit_premium_monthly_promo',
      },
    });
    const stored = (await db.doc(REDEMPTION_PATH).get()).data();
    expect(stored?.iosPromotion).toEqual(ARNALDO_ATTRIBUTION.iosPromotion);
  });

  it('replaces an expired intent without overwriting an active one', async () => {
    const expiredAtMs = Date.now() - 1;
    await db.doc(REDEMPTION_PATH).set(
      {
        purchaseIntent: {
          campaignId: 'campaign-arnaldo',
          plan: 'monthly',
          expectedProductId: 'ajfit_premium_monthly_promo',
          offeringIdentifier: 'promo_7d',
          status: 'purchase_pending',
          createdAt: new Date(expiredAtMs - 1000),
          updatedAt: new Date(expiredAtMs - 1000),
          expiresAt: new Date(expiredAtMs),
        },
      },
      { merge: true },
    );

    const result = await authorizePromoPurchaseTransactionally(UID, 'annual');
    expect(result).toMatchObject({
      status: 'authorized',
      reused: false,
      intent: {
        plan: 'annual',
        expectedProductId: 'ajfit_premium_annual_promo',
      },
    });
    if (result.status === 'authorized') {
      expect(result.intent.expiresAt.toMillis()).toBeGreaterThan(expiredAtMs);
    }
  });

  it('atomically lets only one distinct RevenueCat event consume the intent', async () => {
    const authorization = await authorizePromoPurchaseTransactionally(UID, 'monthly');
    expect(authorization.status).toBe('authorized');
    if (authorization.status !== 'authorized') return;

    const purchasedAtMs = authorization.intent.createdAt.toMillis() + 1;
    const input = {
      eventType: 'INITIAL_PURCHASE' as const,
      eventTimestampMs: purchasedAtMs + 1000,
      purchasedAtMs,
      periodType: 'TRIAL',
      store: 'APP_STORE',
      productId: 'ajfit_premium_monthly_promo',
      offerCode: undefined,
    };
    const results = await Promise.all([
      applyAttributionRevenueCatEvent(UID, { ...input, eventId: 'evt-concurrent-a' }),
      applyAttributionRevenueCatEvent(UID, { ...input, eventId: 'evt-concurrent-b' }),
    ]);

    expect(results.filter((result) => result.status === 'confirmed')).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.status === 'skipped' && result.reason === 'already_consumed',
      ),
    ).toHaveLength(1);

    const stored = (await db.doc(REDEMPTION_PATH).get()).data();
    expect(stored).toMatchObject({
      lockedAt: expect.anything(),
      trialStartedAt: expect.anything(),
      purchaseIntent: {
        status: 'purchase_confirmed',
        revenueCatEventId: expect.stringMatching(/^evt-concurrent-[ab]$/),
      },
    });
    expect(stored).not.toHaveProperty('subscription');
    expect(stored).not.toHaveProperty('premium');
  });
});
