/**
 * Real Firestore-emulator coverage for the FASE 2 transaction. Unlike the
 * unit test's serialized in-memory model, this file launches two actual
 * transactions concurrently against the same document and lets Firestore's
 * optimistic retry behavior resolve the contention.
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
import { applyAttributionRevenueCatEvent } from '../functions/src/attribution/attributionSync';
import { authorizePromoPurchaseTransactionally } from '../functions/src/attribution/promoPurchaseIntent';

const PROJECT_ID = 'ajfit-rules-test';
const UID = 'promo-intent-concurrency-user';
const REDEMPTION_PATH = `couponRedemptions/${UID}`;
let testEnv: RulesTestEnvironment;

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
  await testEnv.cleanup();
});

beforeEach(async () => {
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
  it('denies direct client creation of a purchase intent', async () => {
    const client = testEnv.authenticatedContext(UID).firestore();
    await assertFails(
      setDoc(doc(client, 'couponRedemptions', UID), {
        uid: UID,
        purchaseIntent: { status: 'purchase_pending' },
      }),
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
