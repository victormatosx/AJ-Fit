/**
 * OPT-IN integration proof against the REAL Firestore Emulator — Fase 6
 * gate §27/§28.12: unit tests with a fake store prove the LOGIC; this file
 * proves the engine's actual behavior against real Firestore semantics
 * (real pagination, real BulkWriter, real document existence), the same
 * way `firestore-tests/`/`storage-tests/` already prove the Rules against
 * real behavior (Fase 5).
 *
 * Skipped by default — only runs when `FIRESTORE_CLEANUP_INTEGRATION=1` is
 * set (mirrors `kmsRoundTrip.integration.test.ts`'s opt-in pattern). Run
 * via the root `test:integration:firestoreCleanup` npm script, which wraps
 * this in `firebase emulators:exec --only firestore --project
 * ajfit-rules-test` — the exact same disposable, non-production project
 * Fase 5's Rules tests already use. Never touches production.
 *
 * Uses its OWN named Admin app instance (`firestore-cleanup-integration`),
 * never the shared singleton in `functions/src/lib/firebaseAdmin.ts`, so
 * running this file can never accidentally initialize that singleton
 * against production-shaped config as a side effect of import order in the
 * same test run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { runFirestoreCleanup } from '../engine';

const enabled = process.env.FIRESTORE_CLEANUP_INTEGRATION === '1';

describe.skipIf(!enabled)('Firestore Cleanup Engine — real Emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'firestore-cleanup-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function wipeCollectionGroup(name: string) {
    // Test-harness cleanup between runs — not the engine under test.
    const snapshot = await db.collectionGroup(name).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }

  async function resetEmulator() {
    await Promise.all([
      wipeCollectionGroup('questionnaires'),
      wipeCollectionGroup('assessments'),
      wipeCollectionGroup('progressPhotos'),
      wipeCollectionGroup('workoutPrograms'),
      wipeCollectionGroup('workoutProgramState'),
      wipeCollectionGroup('privateSecurity'),
    ]);
    const users = await db.collection('users').get();
    await Promise.all(users.docs.map((doc) => doc.ref.delete()));
    const support = await db.collection('supportTickets').get();
    await Promise.all(support.docs.map((doc) => doc.ref.delete()));
    const coupons = await db.collection('couponRedemptions').get();
    await Promise.all(coupons.docs.map((doc) => doc.ref.delete()));
    const locks = await db.collection('accountDeletionLocks').get();
    await Promise.all(locks.docs.map((doc) => doc.ref.delete()));
    const deletions = await db.collection('accountDeletions').get();
    await Promise.all(deletions.docs.map((doc) => doc.ref.delete()));
  }

  async function seedFullUser(uid: string) {
    await db.collection('users').doc(uid).set({ profile: { name: 'Test User' } });
    await db.collection('users').doc(uid).collection('questionnaires').doc('q1').set({ answers: {} });
    for (let i = 0; i < 120; i++) {
      await db
        .collection('users')
        .doc(uid)
        .collection('assessments')
        .doc(`a${i}`)
        .set({ weight: 80 });
    }
    for (let i = 0; i < 30; i++) {
      await db
        .collection('users')
        .doc(uid)
        .collection('progressPhotos')
        .doc(`p${i}`)
        .set({ storagePath: `users/${uid}/progressPhotos/p${i}.enc` });
    }
    await db.collection('users').doc(uid).collection('privateSecurity').doc('photoVault').set({
      wrappedVaultKey: 'ciphertext-not-a-real-key',
    });
    await db.collection('users').doc(uid).collection('workoutPrograms').doc('wpg1').set({ status: 'active' });
    await db.collection('users').doc(uid).collection('workoutProgramState').doc('active').set({ programId: 'wpg1' });
  }

  beforeAll(async () => {
    await resetEmulator();
  }, 30_000);

  it(
    'proves DELETE = absent, RETAIN/control-plane/Vault/other-uid = preserved — real Firestore, not a fake',
    async () => {
      await seedFullUser('test-uid-cleanup-A');
      await seedFullUser('test-uid-cleanup-B'); // "other uid" control

      // Retained / control-plane data, keyed to uid A where relevant.
      await db.collection('supportTickets').doc('ticket-1').set({ userId: 'test-uid-cleanup-A' });
      await db.collection('couponRedemptions').doc('test-uid-cleanup-A').set({ couponCode: 'PROMO' });
      await db.collection('accountDeletionLocks').doc('test-uid-cleanup-A').set({
        uid: 'test-uid-cleanup-A',
        activeDeletionId: 'del-integration-1',
        status: 'PROCESSING',
        revision: 0,
      });
      await db.collection('accountDeletions').doc('del-integration-1').set({
        uid: 'test-uid-cleanup-A',
        status: 'PROCESSING',
      });

      const outcome = await runFirestoreCleanup('test-uid-cleanup-A', { db });
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });

      // ── DELETE = absent (queried directly, never inferred from deletedCount) ──
      const userDoc = await db.collection('users').doc('test-uid-cleanup-A').get();
      expect(userDoc.exists).toBe(false);

      const questionnaires = await db
        .collection('users')
        .doc('test-uid-cleanup-A')
        .collection('questionnaires')
        .get();
      expect(questionnaires.empty).toBe(true);

      const assessments = await db
        .collection('users')
        .doc('test-uid-cleanup-A')
        .collection('assessments')
        .get();
      expect(assessments.empty).toBe(true);

      const progressPhotos = await db
        .collection('users')
        .doc('test-uid-cleanup-A')
        .collection('progressPhotos')
        .get();
      expect(progressPhotos.empty).toBe(true);
      const workoutPrograms = await db
        .collection('users').doc('test-uid-cleanup-A').collection('workoutPrograms').get();
      expect(workoutPrograms.empty).toBe(true);
      const workoutProgramState = await db
        .collection('users').doc('test-uid-cleanup-A').collection('workoutProgramState').get();
      expect(workoutProgramState.empty).toBe(true);

      // ── Vault = preserved (VAULT_KEY_DESTRUCTION's responsibility, not this engine's) ──
      const vault = await db
        .collection('users')
        .doc('test-uid-cleanup-A')
        .collection('privateSecurity')
        .doc('photoVault')
        .get();
      expect(vault.exists).toBe(true);

      // ── RETAIN (policy v1) = preserved ──
      const ticket = await db.collection('supportTickets').doc('ticket-1').get();
      expect(ticket.exists).toBe(true);
      const coupon = await db.collection('couponRedemptions').doc('test-uid-cleanup-A').get();
      expect(coupon.exists).toBe(true);

      // ── Control plane = preserved ──
      const lock = await db.collection('accountDeletionLocks').doc('test-uid-cleanup-A').get();
      expect(lock.exists).toBe(true);
      const record = await db.collection('accountDeletions').doc('del-integration-1').get();
      expect(record.exists).toBe(true);

      // ── Other uid = 100% intact ──
      const otherUser = await db.collection('users').doc('test-uid-cleanup-B').get();
      expect(otherUser.exists).toBe(true);
      const otherAssessments = await db
        .collection('users')
        .doc('test-uid-cleanup-B')
        .collection('assessments')
        .get();
      expect(otherAssessments.size).toBe(120);
      const otherVault = await db
        .collection('users')
        .doc('test-uid-cleanup-B')
        .collection('privateSecurity')
        .doc('photoVault')
        .get();
      expect(otherVault.exists).toBe(true);

      await resetEmulator();
    },
    60_000,
  );

  it(
    'retry after the fact (idempotency against real Firestore): re-running on an already-cleaned uid stays SUCCEEDED',
    async () => {
      await seedFullUser('test-uid-cleanup-retry');
      await runFirestoreCleanup('test-uid-cleanup-retry', { db });

      const retry = await runFirestoreCleanup('test-uid-cleanup-retry', { db });
      expect(retry).toEqual({ kind: 'SUCCEEDED' });

      await resetEmulator();
    },
    60_000,
  );
});
