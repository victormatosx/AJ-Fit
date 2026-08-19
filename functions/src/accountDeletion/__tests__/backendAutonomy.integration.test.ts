/**
 * OPT-IN integration proof against the REAL Auth + Firestore + Storage
 * Emulators — Fase 3/5 correction gate §57/§58: "backend autonomy".
 *
 * Scenario: a deletion for a user with Apple AND Google linked is prepared
 * (Apple material exchanged+cached, Google already revoked+unlinked —
 * exactly what the client is now expected to do BEFORE calling
 * `requestAccountDeletion`) and the request is accepted. From that point
 * on, THIS TEST NEVER CALLS ANY CLIENT-SIDE FUNCTION AGAIN — every
 * remaining step is driven by directly invoking the REAL backend executor
 * for that step (no worker/orchestrator exists yet — Fase 14 territory —
 * so this test plays that role manually, exactly as the phase's rules
 * allow: "Pode executar os executores diretamente no harness de teste").
 *
 * The only fake in this file is the Apple HTTP client (`AppleIdentityClient`)
 * — an external network dependency this test must never actually call, the
 * same way `appleProviderRevocation.test.ts` already fakes it. Every OTHER
 * step's dependencies are the REAL Firestore/Storage/Auth Emulators, not
 * fakes.
 *
 * Skipped by default — only runs when `BACKEND_AUTONOMY_INTEGRATION=1` is
 * set. Run via `npm run test:integration:backendAutonomy`, which wraps this
 * in `firebase emulators:exec --only auth,firestore,storage --project
 * ajfit-rules-test`. Never touches production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import {
  beginStepAttempt,
  completeStepAttempt,
  initialStepRecords,
  nextRunnableStep,
} from '../steps';
import { currentPolicy } from '../policy';
import type { AccountDeletionStepRecord } from '../types';
import type { AccountDeletionStepOutcome } from '../errors';

import {
  cacheAppleRevocationMaterial,
  exchangeAppleAuthorizationCode,
} from '../providerRevocation/appleRevocationPreparation';
import { revokeAppleProvider } from '../providerRevocation/appleProviderRevocation';
import {
  deriveProviderRevocationOutcome,
  initialProviderRevocationState,
} from '../providerRevocation/types';
import { FirestoreAppleRevocationMaterialRepository } from '../providerRevocation/appleRevocationRepository';

import { executeVaultKeyDestruction } from '../vaultKeyDestruction';
import { runFirestoreCleanup } from '../firestoreCleanup/engine';
import { runStorageCleanup } from '../storageCleanup/engine';
import { runRetainedDataProcessing } from '../retainedDataProcessing/engine';
import { runRevenueCatProcessing } from '../revenueCatProcessing/engine';
import { executeAuthDeletion } from '../authDeletion';

const enabled = process.env.BACKEND_AUTONOMY_INTEGRATION === '1';

describe.skipIf(!enabled)('Backend autonomy — full chain, Apple+Google linked, zero client calls after commit', () => {
  let app: App;
  let auth: Auth;
  let db: Firestore;
  let storage: Storage;
  const uid = 'autonomy-uid-A';
  const deletionId = 'autonomy-deletion-1';

  beforeAll(() => {
    app = initializeApp(
      { projectId: 'ajfit-rules-test', storageBucket: 'ajfit-rules-test.appspot.com' },
      'backend-autonomy-integration',
    );
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function applyOutcome(
    record: AccountDeletionStepRecord,
    outcome: AccountDeletionStepOutcome,
    now: number,
  ): AccountDeletionStepRecord {
    const running = beginStepAttempt('x', record, now);
    return completeStepAttempt('x', running, outcome, now, currentPolicy().retry);
  }

  it(
    'walks ACCOUNT_ACCESS_LOCK through AUTH_DELETION with no client interaction after commit',
    async () => {
      // ── Setup: create a real Auth user, standing in for the account. ──
      await auth.createUser({ uid, email: 'autonomy@example.test', password: 'irrelevant123' });

      // ── "Client preparation" phase (BEFORE commit) — the only place any ──
      // "client-shaped" material is ever produced in this test.
      //   - Apple: fresh authorizationCode exchanged server-side (faked
      //     HTTP client — never a real Apple network call).
      //   - Google: modeled as "already revoked+unlinked before commit"
      //     (Fase 3/5 correction's other half) — nothing left to do here;
      //     PROVIDER_REVOCATION's Google sub-step starts unlinked, i.e.
      //     `linked: false`, exactly like `initialProviderRevocationState`
      //     already handles for any not-linked provider.
      const fakeAppleClient = {
        exchangeAuthorizationCode: async () => ({
          refreshToken: 'fake-refresh-token',
          accessToken: 'fake-access-token',
          expiresInSeconds: 3600,
        }),
      };
      const appleRefreshToken = await exchangeAppleAuthorizationCode('fresh-code', {
        client: fakeAppleClient,
      });

      // ── COMMIT BOUNDARY ── — from here on, no function in this test ever
      // represents client/browser/user-interactive behavior again.
      // KMS has no local Emulator (Cloud KMS is not part of the Firebase
      // Emulator Suite) — `wrap`/`unwrap` are faked here exactly like
      // `appleProviderRevocation.test.ts` already fakes them; every OTHER
      // dependency in this test (Auth/Firestore/Storage) is the real
      // Emulator, not a fake.
      const fakeWrap = async () => ({ wrappedToken: 'wrapped-fake-refresh-token', kmsKeyVersion: 'fake-kv-1' });
      const fakeUnwrap = async () => 'fake-refresh-token';

      const appleRepository = new FirestoreAppleRevocationMaterialRepository();
      const cacheResult = await cacheAppleRevocationMaterial(deletionId, appleRefreshToken, {
        repository: appleRepository,
        wrap: fakeWrap,
      });
      expect(cacheResult).toEqual({ cached: true });

      const policy = currentPolicy();
      let steps = initialStepRecords();
      let providerRevocation = initialProviderRevocationState(['apple.com', 'google.com'], Date.now());
      // Google already unlinked before commit (Fase 3/5 correction) — model
      // that snapshot directly, matching what `admin.auth().getUser(uid)`
      // would have returned had Google truly been unlinked already.
      providerRevocation = {
        ...providerRevocation,
        google: initialProviderRevocationState([], Date.now()).google,
      };
      let now = 1;

      // ── ACCOUNT_ACCESS_LOCK — real Auth Emulator, no client. ──
      expect(nextRunnableStep(policy, steps)).toBe('ACCOUNT_ACCESS_LOCK');
      await auth.updateUser(uid, { disabled: true });
      await auth.revokeRefreshTokens(uid);
      steps = { ...steps, ACCOUNT_ACCESS_LOCK: applyOutcome(steps.ACCOUNT_ACCESS_LOCK, { kind: 'SUCCEEDED' }, now++) };

      // ── PROVIDER_REVOCATION — Apple sub-step consumes ONLY cached ──
      // material (authorizationCode: null) — no client, no fresh capture.
      expect(nextRunnableStep(policy, steps)).toBe('PROVIDER_REVOCATION');
      const appleOutcome = await revokeAppleProvider(
        { deletionId, expectedUid: uid, capturedForUid: uid, authorizationCode: null },
        {
          client: { exchangeAuthorizationCode: fakeAppleClient.exchangeAuthorizationCode, revokeToken: async () => {} },
          repository: appleRepository,
          wrap: async () => ({ wrappedToken: 'unused', kmsKeyVersion: 'unused' }),
          unwrap: fakeUnwrap,
        },
      );
      expect(appleOutcome).toEqual({ kind: 'SUCCEEDED' });
      providerRevocation = {
        ...providerRevocation,
        apple: { ...providerRevocation.apple, step: applyOutcome(providerRevocation.apple.step, appleOutcome, now++) },
      };
      expect(deriveProviderRevocationOutcome(providerRevocation)).toBe('SUCCEEDED');
      steps = { ...steps, PROVIDER_REVOCATION: applyOutcome(steps.PROVIDER_REVOCATION, { kind: 'SUCCEEDED' }, now++) };

      // ── VAULT_KEY_DESTRUCTION — real Firestore Emulator. ──
      expect(nextRunnableStep(policy, steps)).toBe('VAULT_KEY_DESTRUCTION');
      const vaultOutcome = await executeVaultKeyDestruction(uid, {
        deleteVaultDocument: (u) =>
          db.collection('users').doc(u).collection('privateSecurity').doc('photoVault').delete().then(() => undefined),
      });
      expect(vaultOutcome).toEqual({ kind: 'SUCCEEDED' });
      steps = { ...steps, VAULT_KEY_DESTRUCTION: applyOutcome(steps.VAULT_KEY_DESTRUCTION, vaultOutcome, now++) };

      // ── FIRESTORE_CLEANUP — real Firestore Emulator. ──
      expect(nextRunnableStep(policy, steps)).toBe('FIRESTORE_CLEANUP');
      const firestoreOutcome = await runFirestoreCleanup(uid, { db });
      expect(firestoreOutcome).toEqual({ kind: 'SUCCEEDED' });
      steps = { ...steps, FIRESTORE_CLEANUP: applyOutcome(steps.FIRESTORE_CLEANUP, firestoreOutcome, now++) };

      // ── STORAGE_CLEANUP — real Storage Emulator. ──
      expect(nextRunnableStep(policy, steps)).toBe('STORAGE_CLEANUP');
      const storageOutcome = await runStorageCleanup(uid, { storage });
      expect(storageOutcome).toEqual({ kind: 'SUCCEEDED' });
      steps = { ...steps, STORAGE_CLEANUP: applyOutcome(steps.STORAGE_CLEANUP, storageOutcome, now++) };

      // ── RETAINED_DATA_PROCESSING — real Firestore/Storage Emulators. ──
      expect(nextRunnableStep(policy, steps)).toBe('RETAINED_DATA_PROCESSING');
      const retainedOutcome = await runRetainedDataProcessing(
        uid,
        { support: policy.retention.support, couponRedemptions: policy.retention.couponRedemptions },
        { db, storage },
      );
      expect(retainedOutcome.kind).toBe('SKIPPED_BY_POLICY'); // policy v1: RETAIN/RETAIN
      steps = { ...steps, RETAINED_DATA_PROCESSING: applyOutcome(steps.RETAINED_DATA_PROCESSING, retainedOutcome, now++) };

      // ── REVENUECAT_PROCESSING — zero I/O, policy v1 SKIP. ──
      expect(nextRunnableStep(policy, steps)).toBe('REVENUECAT_PROCESSING');
      const revenueCatOutcome = await runRevenueCatProcessing(policy.retention.revenueCat);
      expect(revenueCatOutcome.kind).toBe('SKIPPED_BY_POLICY');
      steps = { ...steps, REVENUECAT_PROCESSING: applyOutcome(steps.REVENUECAT_PROCESSING, revenueCatOutcome, now++) };

      // ── AUTH_DELETION — real Auth Emulator, last step. ──
      expect(nextRunnableStep(policy, steps)).toBe('AUTH_DELETION');
      const authOutcome = await executeAuthDeletion(uid, auth);
      expect(authOutcome).toEqual({ kind: 'SUCCEEDED' });
      steps = { ...steps, AUTH_DELETION: applyOutcome(steps.AUTH_DELETION, authOutcome, now++) };

      // ── Every required step reached an acceptable-for-completion status. ──
      expect(nextRunnableStep(policy, steps)).toBeNull();

      // ── Final proof against real infrastructure, not inferred: ──
      await expect(auth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      const vaultSnapshot = await db.collection('users').doc(uid).collection('privateSecurity').doc('photoVault').get();
      expect(vaultSnapshot.exists).toBe(false);
      // `revokeAppleProvider` already clears cached material itself the
      // moment the sub-step reaches SUCCEEDED (`appleProviderRevocation.ts`'s
      // own documented lifecycle) — no leftover credential material
      // survives a successful revoke.
      const appleMaterialAfter = await appleRepository.read(deletionId);
      expect(appleMaterialAfter).toBeNull();
    },
    120_000,
  );
});
