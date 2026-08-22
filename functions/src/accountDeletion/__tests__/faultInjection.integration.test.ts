/**
 * OPT-IN integration proof against the REAL Firestore Emulator — Fase 13
 * Scenario F. Closes a gap `repository.test.ts`'s own doc comment already
 * flagged: its concurrency tests use "a faithful-enough fake" of Firestore
 * transaction semantics, explicitly noting "Firestore Emulator/production
 * integration is still a separate, unaddressed concern". This file is that
 * proof — real `db.runTransaction`, real optimistic concurrency, not a
 * simulation of it.
 *
 * `FirestoreAccountDeletionRepository` (`../repository.ts`) uses the SHARED
 * `db` singleton from `lib/firebaseAdmin.ts` (not dependency-injectable,
 * unlike the Fase 6/7/8/12.5 engines) — this test relies on that singleton
 * auto-connecting to the Firestore Emulator via `FIRESTORE_EMULATOR_HOST`,
 * which `firebase emulators:exec` sets in the environment automatically
 * (same mechanism already relied on for the Apple revocation repository in
 * `backendAutonomy.integration.test.ts`).
 *
 * Skipped by default — only runs when `FAULT_INJECTION_INTEGRATION=1` is
 * set. Run via `npm run test:integration:faultInjection`, which wraps this
 * in `firebase emulators:exec --only firestore --project ajfit-rules-test`.
 * Never touches production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { currentPolicy } from '../policy';
import { FirestoreAccountDeletionRepository } from '../repository';

const enabled = process.env.FAULT_INJECTION_INTEGRATION === '1';

describe.skipIf(!enabled)('Scenario F — duplicate concurrent requestAccountDeletion, real Firestore Emulator', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    // No named-app override exists for `FirestoreAccountDeletionRepository`
    // (unlike the Fase 6/7/8/12.5 engines) — it always uses the shared
    // singleton from `lib/firebaseAdmin.ts`. This named app exists only to
    // WIPE/VERIFY state directly; the repository itself still writes
    // through the shared singleton, which picks up the same Emulator via
    // `FIRESTORE_EMULATOR_HOST`.
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'fault-injection-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function wipe(uid: string) {
    await db.collection('accountDeletionLocks').doc(uid).delete();
    const records = await db.collection('accountDeletions').where('uid', '==', uid).get();
    await Promise.all(records.docs.map((doc) => doc.ref.delete()));
  }

  it(
    'three concurrent requests for the same uid converge on exactly one CREATED operation, never three',
    async () => {
      const uid = 'fi-scenario-f-uid';
      await wipe(uid);
      const repository = new FirestoreAccountDeletionRepository();
      const policy = currentPolicy();

      const attempt = () =>
        repository.createOrReuse({
          uid,
          candidateDeletionId: `del-${Math.random().toString(36).slice(2)}`,
          policy,
          linkedProviders: [],
          requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
          now: Date.now(),
        });

      const [a, b, c] = await Promise.all([attempt(), attempt(), attempt()]);

      const deletionIds = new Set([a.record.deletionId, b.record.deletionId, c.record.deletionId]);
      expect(deletionIds.size).toBe(1); // all three converged on the SAME deletionId

      const createdCount = [a, b, c].filter((r) => !r.deduplicated).length;
      expect(createdCount).toBe(1); // exactly one of the three actually created it

      const lockSnapshot = await db.collection('accountDeletionLocks').doc(uid).get();
      expect(lockSnapshot.exists).toBe(true);
      expect(lockSnapshot.data()?.activeDeletionId).toBe([...deletionIds][0]);

      await wipe(uid);
    },
    30_000,
  );

  it(
    'a retry after a lost response returns the SAME deletionId, never creating a second operation',
    async () => {
      const uid = 'fi-scenario-f1-uid';
      await wipe(uid);
      const repository = new FirestoreAccountDeletionRepository();
      const policy = currentPolicy();

      const first = await repository.createOrReuse({
        uid,
        candidateDeletionId: 'del-first-attempt',
        policy,
        linkedProviders: [],
        requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
        now: Date.now(),
      });
      expect(first.deduplicated).toBe(false);

      // Simulates: the commit succeeded, but the client never saw the
      // response (network dropped) — it retries with a DIFFERENT candidate
      // id, exactly as `requestAccountDeletion.ts` does on every call.
      const retry = await repository.createOrReuse({
        uid,
        candidateDeletionId: 'del-retry-attempt-would-be-wasted',
        policy,
        linkedProviders: [],
        requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
        now: Date.now(),
      });

      expect(retry.deduplicated).toBe(true);
      expect(retry.record.deletionId).toBe(first.record.deletionId);
      expect(retry.record.deletionId).not.toBe('del-retry-attempt-would-be-wasted');

      await wipe(uid);
    },
    30_000,
  );

  it("two DIFFERENT uids racing concurrently never interfere with each other's operation", async () => {
    await wipe('fi-scenario-f-uid-A');
    await wipe('fi-scenario-f-uid-B');
    const repository = new FirestoreAccountDeletionRepository();
    const policy = currentPolicy();

    const attempt = (uid: string) =>
      repository.createOrReuse({
        uid,
        candidateDeletionId: `del-${uid}`,
        policy,
        linkedProviders: [],
        requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
        now: Date.now(),
      });

    const [a, b] = await Promise.all([attempt('fi-scenario-f-uid-A'), attempt('fi-scenario-f-uid-B')]);

    expect(a.record.uid).toBe('fi-scenario-f-uid-A');
    expect(b.record.uid).toBe('fi-scenario-f-uid-B');
    expect(a.record.deletionId).not.toBe(b.record.deletionId);

    await wipe('fi-scenario-f-uid-A');
    await wipe('fi-scenario-f-uid-B');
  }, 30_000);
});
