/**
 * OPT-IN integration proof against the REAL Firestore Emulator (same
 * pattern as `accountDeletion/firestoreCleanup/__tests__/engine.integration.test.ts`).
 *
 * WHY this file exists: the unit tests in `commercialGateResolution.test.ts`
 * and `confirmCommercialGate.test.ts` mock `transaction.set`/`.update` with
 * `vi.fn()` — they prove the code CALLED the right mock with the right
 * plain-JS arguments, but cannot catch a bug where the argument shape looks
 * right in JS yet the real Firestore Admin SDK stores it wrong. That is
 * exactly the incident this file guards against: `set(ref, { 'metadata.
 * commercialGateResolvedAt': ... }, { merge: true })` looks correct as a
 * mock assertion, but the real SDK stores the dotted key as a LITERAL
 * top-level field instead of nesting it under `metadata` — corrupting
 * `users/{uid}` and permanently blocking every future `update()` on it
 * (`nestedUserValid()`'s top-level `hasOnly` in firestore.rules rejects the
 * unexpected key). Only `update()` parses a dotted string key as a nested
 * field path.
 *
 * Covers BOTH backend write paths for `metadata.commercialGateResolvedAt`:
 *   - Scenario A: `applySubscriptionEventAtomically` (the webhook path,
 *     `subscriptionSync.ts`).
 *   - Scenario B: `confirmCommercialGateEntitlement` (the synchronous
 *     callable path, `confirmCommercialGate.ts`), with RevenueCat itself
 *     faked out (`RevenueCatSubscriptionApi` is injectable) — this test
 *     never touches the real RevenueCat API/dashboard, only real Firestore.
 *
 * Skipped by default — only runs when `COMMERCIAL_GATE_INTEGRATION=1` is
 * set. Run via the root `test:integration:commercialGate` npm script, which
 * wraps this in `firebase emulators:exec --only firestore --project
 * ajfit-rules-test` — the same disposable, non-production project the
 * other Fase 5/6 integration suites use. Never touches production.
 *
 * Uses its OWN named Admin app instance (`commercial-gate-integration`),
 * never the shared singleton in `functions/src/lib/firebaseAdmin.ts`, EXCEPT
 * for actually exercising `applySubscriptionEventAtomically` and
 * `confirmCommercialGateEntitlement` themselves, which import that shared
 * singleton internally — that singleton's `initializeApp()` takes no
 * arguments, so it picks up `FIRESTORE_EMULATOR_HOST` (set by `firebase
 * emulators:exec`) the same way this file's own app does.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { applySubscriptionEventAtomically } from '../subscriptionSync';
import { confirmCommercialGateEntitlement } from '../confirmCommercialGate';
import type { RevenueCatSubscription, RevenueCatSubscriptionApi } from '../revenueCatApi';

const enabled = process.env.COMMERCIAL_GATE_INTEGRATION === '1';

describe.skipIf(!enabled)('commercialGateResolvedAt — real Firestore Emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'commercial-gate-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  afterEach(async () => {
    const users = await db.collection('users').get();
    await Promise.all(users.docs.map((doc) => doc.ref.delete()));
  });

  function newUserDoc(overrides: Record<string, unknown> = {}) {
    return {
      profile: { name: 'Alice', email: 'alice@example.com' },
      preferences: { language: 'pt-BR', units: 'system', theme: 'dark' },
      subscription: {},
      metadata: {
        role: 'user',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        commercialGateResolvedAt: null,
        ...overrides,
      },
    };
  }

  /** Every top-level key of a raw document, to assert none of them contain a literal dot. */
  function topLevelKeys(data: FirebaseFirestore.DocumentData) {
    return Object.keys(data);
  }

  function activeSubscription(
    overrides: Partial<RevenueCatSubscription> = {},
  ): RevenueCatSubscription {
    return {
      id: 'sub-1',
      customerId: 'uid-webhook',
      originalCustomerId: 'uid-webhook',
      productId: 'prod-monthly',
      startsAtMs: 1_000,
      currentPeriodStartsAtMs: 2_000,
      currentPeriodEndsAtMs: 3_000,
      endsAtMs: null,
      givesAccess: true,
      pendingPayment: false,
      autoRenewalStatus: 'will_renew',
      status: 'active',
      entitlements: [
        {
          id: 'ent-premium',
          lookupKey: 'premium',
          products: [{ id: 'prod-monthly', storeIdentifier: 'ajfit_premium_monthly' }],
        },
      ],
      environment: 'sandbox',
      store: 'app_store',
      ...overrides,
    };
  }

  function fakeApi(subscriptions: RevenueCatSubscription[]): RevenueCatSubscriptionApi {
    return {
      getCustomerIdentityGraph: async () => {
        throw new Error('not used by confirmCommercialGateEntitlement');
      },
      getCustomerSubscriptions: async () => subscriptions,
    };
  }

  describe('Scenario A — webhook path (applySubscriptionEventAtomically)', () => {
    it('resolves the gate as a real nested Timestamp, never as a literal dotted top-level field', async () => {
      const uid = 'uid-webhook';
      await db
        .collection('users')
        .doc(uid)
        .set(newUserDoc());

      const result = await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });

      expect(result).toEqual({ status: 'processed' });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;

      // 1. Nested, real Timestamp.
      expect(data.metadata.commercialGateResolvedAt).toBeInstanceOf(Timestamp);

      // 2 & 3. No literal dotted top-level field, and no dotted top-level
      // key of ANY kind — the exact regression this suite exists to catch.
      expect(topLevelKeys(data)).not.toContain('metadata.commercialGateResolvedAt');
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);

      // 4. Sibling metadata fields survive untouched.
      expect(data.metadata.role).toBe('user');
      expect(data.metadata.createdAt).toBeInstanceOf(Timestamp);

      // 5. Subscription mirror applied correctly.
      expect(data.subscription.entitlementActive).toBe(true);
      expect(data.subscription.status).toBe('ACTIVE');
      expect(data.subscription.lastEventId).toBe('evt-1');
    });

    it('preserves subscription sub-fields not present in a later partial event delta (deep-merge semantics)', async () => {
      const uid = 'uid-webhook';
      await db.collection('users').doc(uid).set(newUserDoc());

      // First event: INITIAL_PURCHASE-shaped, sets startedAt.
      await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
        startedAt: Timestamp.fromMillis(1_000),
      });

      // Second event: a RENEWAL-shaped partial delta that does NOT include
      // `startedAt` — real `normalizeSubscription` output for this case.
      await applySubscriptionEventAtomically(uid, 'evt-2', 2_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
        lastRenewedAt: Timestamp.fromMillis(2_000),
      });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;

      // `startedAt` from the first event must survive the second event's
      // merge-set, exactly like before this fix (this proves the
      // set(...,{merge:true}) deep-merge behavior for `subscription` was
      // preserved by the refactor, not just the gate write).
      expect(data.subscription.startedAt).toBeInstanceOf(Timestamp);
      expect(data.subscription.lastRenewedAt).toBeInstanceOf(Timestamp);
      expect(data.subscription.lastEventId).toBe('evt-2');

      // Gate resolved once, on the first event, never touched again.
      expect(data.metadata.commercialGateResolvedAt).toBeInstanceOf(Timestamp);
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);
    });

    it('does NOT resolve the gate when entitlement is not active — stays null', async () => {
      const uid = 'uid-webhook';
      await db.collection('users').doc(uid).set(newUserDoc());

      await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: false,
        status: 'EXPIRED',
      });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;
      expect(data.metadata.commercialGateResolvedAt).toBeNull();
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);
    });

    it('never regresses an already-resolved gate on a later event', async () => {
      const uid = 'uid-webhook';
      const alreadyResolvedAt = Timestamp.fromMillis(500);
      await db.collection('users').doc(uid).set(newUserDoc({ commercialGateResolvedAt: alreadyResolvedAt }));

      await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;
      expect(data.metadata.commercialGateResolvedAt.isEqual(alreadyResolvedAt)).toBe(true);
    });

    it('leaves a legacy account (field entirely absent) absent — never invents the key', async () => {
      const uid = 'uid-webhook';
      const legacyDoc = newUserDoc();
      delete (legacyDoc.metadata as Record<string, unknown>).commercialGateResolvedAt;
      await db.collection('users').doc(uid).set(legacyDoc);

      await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;
      expect('commercialGateResolvedAt' in data.metadata).toBe(false);
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);
    });

    it('duplicate event id is a true no-op — idempotent, no extra write, gate untouched', async () => {
      const uid = 'uid-webhook';
      await db.collection('users').doc(uid).set(newUserDoc());

      await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });
      const afterFirst = (await db.collection('users').doc(uid).get()).data()!;

      const result = await applySubscriptionEventAtomically(uid, 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });

      expect(result).toEqual({ status: 'duplicate' });
      const afterSecond = (await db.collection('users').doc(uid).get()).data()!;
      expect(afterSecond.metadata.commercialGateResolvedAt.isEqual(afterFirst.metadata.commercialGateResolvedAt)).toBe(
        true,
      );
      expect(topLevelKeys(afterSecond).every((key) => !key.includes('.'))).toBe(true);
    });

    it('documented contract: user_not_found when users/{uid} does not exist — never recreates it (Part 2 architectural guarantee)', async () => {
      const result = await applySubscriptionEventAtomically('uid-does-not-exist', 'evt-1', 1_000, {
        provider: 'REVENUECAT',
        entitlementActive: true,
        status: 'ACTIVE',
      });

      expect(result).toEqual({ status: 'user_not_found' });
      const snap = await db.collection('users').doc('uid-does-not-exist').get();
      expect(snap.exists).toBe(false);
    });

    it('TRANSFER reconciliation (replaceSubscription) also resolves the gate without a dotted top-level field', async () => {
      const uid = 'uid-webhook';
      await db.collection('users').doc(uid).set(newUserDoc());

      await applySubscriptionEventAtomically(
        uid,
        'transfer-1',
        1_000,
        { provider: 'REVENUECAT', entitlementActive: true, status: 'ACTIVE' },
        { replaceSubscription: true },
      );

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;
      expect(data.metadata.commercialGateResolvedAt).toBeInstanceOf(Timestamp);
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);
    });
  });

  describe('Scenario B — callable path (confirmCommercialGateEntitlement)', () => {
    it('resolves the gate as a real nested Timestamp when RevenueCat confirms an active entitlement', async () => {
      const uid = 'uid-callable';
      await db.collection('users').doc(uid).set(newUserDoc());

      const result = await confirmCommercialGateEntitlement(uid, fakeApi([activeSubscription()]));

      expect(result).toEqual({ status: 'resolved' });

      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data()!;
      expect(data.metadata.commercialGateResolvedAt).toBeInstanceOf(Timestamp);
      expect(topLevelKeys(data)).not.toContain('metadata.commercialGateResolvedAt');
      expect(topLevelKeys(data).every((key) => !key.includes('.'))).toBe(true);
      expect(data.metadata.role).toBe('user');
    });

    it('not entitled → stays null, no write at all', async () => {
      const uid = 'uid-callable';
      await db.collection('users').doc(uid).set(newUserDoc());

      const result = await confirmCommercialGateEntitlement(
        uid,
        fakeApi([activeSubscription({ givesAccess: false, status: 'expired' })]),
      );

      expect(result).toEqual({ status: 'not_entitled' });
      const snap = await db.collection('users').doc(uid).get();
      expect(snap.data()!.metadata.commercialGateResolvedAt).toBeNull();
    });

    it('already resolved (Timestamp) → idempotent no-op, does not rewrite the timestamp', async () => {
      const uid = 'uid-callable';
      const alreadyResolvedAt = Timestamp.fromMillis(500);
      await db.collection('users').doc(uid).set(newUserDoc({ commercialGateResolvedAt: alreadyResolvedAt }));

      const result = await confirmCommercialGateEntitlement(uid, fakeApi([activeSubscription()]));

      expect(result).toEqual({ status: 'already_resolved' });
      const snap = await db.collection('users').doc(uid).get();
      expect(snap.data()!.metadata.commercialGateResolvedAt.isEqual(alreadyResolvedAt)).toBe(true);
    });

    it('user_not_found when users/{uid} does not exist', async () => {
      const result = await confirmCommercialGateEntitlement('uid-does-not-exist', fakeApi([activeSubscription()]));
      expect(result).toEqual({ status: 'user_not_found' });
    });
  });
});
