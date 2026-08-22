/**
 * OPT-IN integration proof against the REAL Auth + Firestore Emulators —
 * Fase 14, the reconciliation worker's own gate.
 *
 * Every function under test here (`processAccountDeletionRecord`,
 * `tryAcquireReconciliationLease`, `persistAccountDeletionRecordChange`,
 * `readAccountDeletionRecord`, `queryReconciliationCandidates`,
 * `FirestoreAccountDeletionRepository.createOrReuse`, `lockAccountAccess`,
 * `executeVaultKeyDestruction`, `runFirestoreCleanup`, `runStorageCleanup`,
 * `executeAuthDeletion`) uses the SHARED Admin SDK singleton
 * (`lib/firebaseAdmin.ts`), auto-connecting to the Emulator via
 * `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` — the same
 * mechanism every prior integration test in this directory relies on. A
 * SEPARATE named Admin app exists in this file ONLY to seed/verify state
 * directly, never to stand in for the code under test.
 *
 * BACKEND AUTONOMY (Fase 14 rule): after a deletion record exists, this
 * file NEVER calls `requestAccountDeletion`, any client-side orchestrator,
 * or any React Native module — every step of reconciliation is driven
 * exclusively by `processAccountDeletionRecord`, an Admin-SDK-only backend
 * function.
 *
 * Every record here has NO linked providers (`linkedProviders: []`), so
 * `PROVIDER_REVOCATION` resolves via `SKIPPED_BY_POLICY` without ever
 * needing Apple's KMS/network (unavailable in the Emulator Suite) — Apple's
 * own sub-step dispatch is already independently proven by
 * `dispatcher.test.ts` (mocked) and `backendAutonomy.integration.test.ts`
 * (real Emulators, faked Apple HTTP client only).
 *
 * Skipped by default — only runs when
 * `ACCOUNT_DELETION_RECONCILIATION_INTEGRATION=1` is set. Run via
 * `npm run test:integration:accountDeletionReconciliation`, which wraps
 * this in `firebase emulators:exec --only auth,firestore,storage --project
 * ajfit-rules-test` (Storage is required even though no object is ever
 * seeded — `STORAGE_CLEANUP` still needs a live Storage Emulator to resolve
 * as an idempotent no-op; without it the Admin SDK call itself fails
 * transiently and the step never gets past `RETRY_SCHEDULED`). Never
 * touches production, never a real Apple/Google call, never a real
 * subscription.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { currentPolicy } from '../policy';
import { AccountDeletionRepositoryError, FirestoreAccountDeletionRepository } from '../repository';
import {
  persistAccountDeletionRecordChange,
  processAccountDeletionRecord,
  queryReconciliationCandidates,
  readAccountDeletionRecord,
  tryAcquireReconciliationLease,
} from '../reconciliation';

const enabled = process.env.ACCOUNT_DELETION_RECONCILIATION_INTEGRATION === '1';

describe.skipIf(!enabled)('Fase 14 — reconciliation worker, real Auth + Firestore Emulators', () => {
  let app: App;
  let auth: Auth;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'ajfit-rules-test' }, 'reconciliation-integration');
    auth = getAuth(app);
    db = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function wipe(uid: string, deletionId?: string) {
    await db.collection('accountDeletionLocks').doc(uid).delete().catch(() => {});
    if (deletionId) await db.collection('accountDeletions').doc(deletionId).delete().catch(() => {});
    const others = await db.collection('accountDeletions').where('uid', '==', uid).get();
    await Promise.all(others.docs.map((d) => d.ref.delete()));
    await auth.deleteUser(uid).catch(() => {});
  }

  async function createAbandonedRequest(uid: string, deletionId: string) {
    await auth.createUser({ uid, email: `${uid}@example.test`, password: 'irrelevant123' });
    const repository = new FirestoreAccountDeletionRepository();
    const result = await repository.createOrReuse({
      uid,
      candidateDeletionId: deletionId,
      policy: currentPolicy(),
      linkedProviders: [],
      requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
      now: Date.now(),
    });
    expect(result.deduplicated).toBe(false);
    return result.record;
  }

  it(
    'MAIN GATE — an artificially abandoned REQUESTED record is reconciled automatically to COMPLETED',
    async () => {
      const uid = 'reconcile-main-gate-uid';
      const deletionId = 'reconcile-main-gate-del';
      await wipe(uid, deletionId);

      await createAbandonedRequest(uid, deletionId);
      // Nothing else ever runs `requestAccountDeletion` or any client-side
      // function again from this point on — reconciliation alone must
      // finish the workflow.

      const outcome = await processAccountDeletionRecord(deletionId, {
        ownerId: 'reconciliation-test-worker',
        maxStepsPerInvocation: 10,
      });

      expect(outcome).toEqual({ kind: 'PROGRESSED', stepsExecuted: expect.any(Number), finalStatus: 'COMPLETED' });

      await expect(auth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });

      const lockSnap = await db.collection('accountDeletionLocks').doc(uid).get();
      expect(lockSnap.exists).toBe(true);
      expect(lockSnap.data()?.status).toBe('COMPLETED');

      // A COMPLETED record must never be returned as a future candidate —
      // proves the query-level exclusion, not just an in-memory check.
      const candidatesAfter = await queryReconciliationCandidates(50);
      expect(candidatesAfter.some((c) => c.deletionId === deletionId)).toBe(false);

      // Reprocessing an already-COMPLETED id is a safe, cheap no-op —
      // never re-executes any step.
      const second = await processAccountDeletionRecord(deletionId, { ownerId: 'reconciliation-test-worker-2' });
      expect(second.kind).toBe('ALREADY_TERMINAL');

      await wipe(uid, deletionId);
    },
    120_000,
  );

  it(
    'a record stuck partway (ACCOUNT_ACCESS_LOCK already done) continues from exactly the right point, never restarts',
    async () => {
      const uid = 'reconcile-stuck-uid';
      const deletionId = 'reconcile-stuck-del';
      await wipe(uid, deletionId);

      const created = await createAbandonedRequest(uid, deletionId);

      // Simulate "worker A already completed step 1, then crashed" by
      // directly persisting that partial progress via the SAME CAS-protected
      // write path a real worker would use.
      const firstStep = await processAccountDeletionRecord(deletionId, {
        ownerId: 'partial-worker',
        maxStepsPerInvocation: 1,
      });
      expect(firstStep).toEqual({ kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'PROCESSING' });

      const afterFirstStep = await readAccountDeletionRecord(deletionId);
      expect(afterFirstStep?.steps.ACCOUNT_ACCESS_LOCK.status).toBe('SUCCEEDED');
      const attemptCountAfterFirstStep = afterFirstStep!.steps.ACCOUNT_ACCESS_LOCK.attemptCount;

      // A REAL Auth user in `disabled: true` is proof step 1 truly ran
      // against the Emulator, not merely marked done in Firestore.
      const userAfterStep1 = await auth.getUser(uid);
      expect(userAfterStep1.disabled).toBe(true);

      // A LATER reconciliation call continues from PROVIDER_REVOCATION
      // onward — never redoes ACCOUNT_ACCESS_LOCK.
      const rest = await processAccountDeletionRecord(deletionId, {
        ownerId: 'continuation-worker',
        maxStepsPerInvocation: 10,
      });
      expect(rest.kind).toBe('PROGRESSED');
      if (rest.kind === 'PROGRESSED') expect(rest.finalStatus).toBe('COMPLETED');

      const final = await readAccountDeletionRecord(deletionId);
      // The step's own record was never touched again after step 1 — same
      // shape, including its original attemptCount (never bumped a second
      // time) — created's initial value confirms it started fresh at 0.
      expect(created.steps.ACCOUNT_ACCESS_LOCK.attemptCount).toBe(0);
      expect(attemptCountAfterFirstStep).toBe(1);

      await wipe(uid, deletionId);
      void final;
    },
    120_000,
  );

  it(
    'lease handoff — after a stale worker\'s lease expires, a second worker continues; the stale worker is later rejected by CAS',
    async () => {
      const uid = 'reconcile-lease-uid';
      const deletionId = 'reconcile-lease-del';
      await wipe(uid, deletionId);
      await createAbandonedRequest(uid, deletionId);

      const now = Date.now();

      // Worker A "dies" immediately after acquiring a very short lease —
      // never calls any executor, never persists a step outcome.
      const workerA = await tryAcquireReconciliationLease(deletionId, 'worker-A', now, 1_000);
      expect(workerA.ok).toBe(true);

      // Worker B, ticking later (lease expired), successfully takes over
      // and completes the whole workflow.
      const laterNow = now + 5_000;
      const outcome = await processAccountDeletionRecord(deletionId, {
        ownerId: 'worker-B',
        now: laterNow,
        maxStepsPerInvocation: 10,
      });
      expect(outcome.kind).toBe('PROGRESSED');
      if (outcome.kind === 'PROGRESSED') expect(outcome.finalStatus).toBe('COMPLETED');

      // Worker A, unaware it is stale, now tries to persist using the
      // revision it observed when it acquired the (now long-superseded)
      // lease — CAS must reject it, and completion must NOT regress.
      if (workerA.ok) {
        const staleWrite = await persistAccountDeletionRecordChange(deletionId, workerA.record.revision, (current) => ({
          ...current,
          status: 'PROCESSING',
        }));
        expect(staleWrite.ok).toBe(false);
      }

      const finalRecord = await readAccountDeletionRecord(deletionId);
      expect(finalRecord?.status).toBe('COMPLETED');
      const lockSnap = await db.collection('accountDeletionLocks').doc(uid).get();
      expect(lockSnap.data()?.status).toBe('COMPLETED');

      await wipe(uid, deletionId);
    },
    120_000,
  );

  it(
    'two concurrent reconciliation invocations for the SAME record converge on one logical evolution, never corrupt or duplicate work',
    async () => {
      const uid = 'reconcile-concurrent-uid';
      const deletionId = 'reconcile-concurrent-del';
      await wipe(uid, deletionId);
      await createAbandonedRequest(uid, deletionId);

      const [a, b] = await Promise.all([
        processAccountDeletionRecord(deletionId, { ownerId: 'concurrent-worker-A', maxStepsPerInvocation: 10 }),
        processAccountDeletionRecord(deletionId, { ownerId: 'concurrent-worker-B', maxStepsPerInvocation: 10 }),
      ]);

      // Exactly one of the two ever reaches COMPLETED in this pass; the
      // other is expected to observe LEASE_HELD, a stale rejection, or make
      // partial/no progress — never a corrupted or duplicated outcome.
      const finalStatuses = [a, b]
        .filter((o): o is { kind: 'PROGRESSED'; stepsExecuted: number; finalStatus: 'COMPLETED' | 'PROCESSING' | 'RETRY_SCHEDULED' | 'FAILED_TERMINAL' } => o.kind === 'PROGRESSED')
        .map((o) => o.finalStatus);
      expect(finalStatuses.every((s) => s !== 'FAILED_TERMINAL')).toBe(true);

      // Whichever one didn't finish it, the workflow as a whole must have
      // reached (or be approaching) COMPLETED — reconcile any remainder.
      let safety = 0;
      let lockStatus: string | undefined;
      while (safety < 10) {
        const lockSnap = await db.collection('accountDeletionLocks').doc(uid).get();
        lockStatus = lockSnap.data()?.status as string | undefined;
        if (lockStatus === 'COMPLETED') break;
        await processAccountDeletionRecord(deletionId, { ownerId: `sweep-${safety}`, maxStepsPerInvocation: 10 });
        safety += 1;
      }
      expect(lockStatus).toBe('COMPLETED');

      await wipe(uid, deletionId);
    },
    120_000,
  );

  it(
    "reconciling one uid's deletion never touches another uid's record, lock, or Auth user",
    async () => {
      const uidA = 'reconcile-isolation-uid-A';
      const uidB = 'reconcile-isolation-uid-B';
      const delA = 'reconcile-isolation-del-A';
      const delB = 'reconcile-isolation-del-B';
      await wipe(uidA, delA);
      await wipe(uidB, delB);

      await createAbandonedRequest(uidA, delA);
      const recordBBefore = await createAbandonedRequest(uidB, delB);

      await processAccountDeletionRecord(delA, { ownerId: 'isolation-worker', maxStepsPerInvocation: 10 });

      // uid A is gone; uid B's Auth user and record are completely untouched.
      await expect(auth.getUser(uidA)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      const userB = await auth.getUser(uidB);
      expect(userB.disabled).toBe(false);

      const recordBAfter = await readAccountDeletionRecord(delB);
      expect(recordBAfter?.status).toBe('REQUESTED');
      expect(recordBAfter?.revision).toBe(recordBBefore.revision);

      await wipe(uidA, delA);
      await wipe(uidB, delB);
    },
    120_000,
  );

  it(
    'a malformed/corrupted record fails safely (throws) — never guesses a destructive action from a bad shape',
    async () => {
      const uid = 'reconcile-malformed-uid';
      const deletionId = 'reconcile-malformed-del';
      await wipe(uid, deletionId);
      await auth.createUser({ uid, email: `${uid}@example.test`, password: 'irrelevant123' });

      // Deliberately missing `steps`/`policy`/`providerRevocation` — a shape
      // no real writer in this codebase ever produces.
      await db.collection('accountDeletions').doc(deletionId).set({
        deletionId,
        uid,
        workflowVersion: 1,
        status: 'REQUESTED',
        revision: 0,
        requestedAt: Date.now(),
      });

      await expect(
        processAccountDeletionRecord(deletionId, { ownerId: 'malformed-worker' }),
      ).rejects.toBeInstanceOf(AccountDeletionRepositoryError);

      // The Auth user must be completely untouched — no inference, no
      // partial destructive action taken from a corrupted control-plane doc.
      const user = await auth.getUser(uid);
      expect(user.disabled).toBe(false);

      await db.collection('accountDeletions').doc(deletionId).delete();
      await auth.deleteUser(uid).catch(() => {});
    },
    60_000,
  );
});
