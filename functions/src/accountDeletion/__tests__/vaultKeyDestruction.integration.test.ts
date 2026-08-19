/**
 * OPT-IN integration proof against the REAL Firestore (+ Storage) Emulator
 * — Fase 12.5 gate §34/§35/§36. Unit tests with fakes prove the LOGIC; this
 * file proves against real Firestore semantics that deleting
 * `users/{uid}/privateSecurity/photoVault` genuinely removes the only
 * backend copy of the wrapped Vault Key, while leaving Storage ciphertext
 * and another uid's vault completely untouched — the separation-of-
 * responsibility property this step's whole design depends on (Fase 12.5
 * §31/§36: Storage Cleanup is a separate, later step).
 *
 * Skipped by default — only runs when `VAULT_KEY_DESTRUCTION_INTEGRATION=1`
 * is set. Run via `npm run test:integration:vaultKeyDestruction`, which
 * wraps this in `firebase emulators:exec --only firestore,storage
 * --project ajfit-rules-test`. Never touches production — uses its own
 * named Admin app instance, never the shared
 * `functions/src/lib/firebaseAdmin.ts` singleton, and never a real Vault.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { executeVaultKeyDestruction } from '../vaultKeyDestruction';
import { runFirestoreCleanup } from '../firestoreCleanup/engine';

const enabled = process.env.VAULT_KEY_DESTRUCTION_INTEGRATION === '1';

describe.skipIf(!enabled)('VAULT_KEY_DESTRUCTION executor — real Emulator integration', () => {
  let app: App;
  let db: Firestore;
  let storage: Storage;

  beforeAll(() => {
    app = initializeApp(
      { projectId: 'ajfit-rules-test', storageBucket: 'ajfit-rules-test.appspot.com' },
      'vault-key-destruction-integration',
    );
    db = getFirestore(app);
    storage = getStorage(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function vaultRef(uid: string) {
    return db.collection('users').doc(uid).collection('privateSecurity').doc('photoVault');
  }

  async function wipe() {
    for (const uid of ['vkd-uid-A', 'vkd-uid-B']) {
      await vaultRef(uid).delete();
    }
    const [files] = await storage.bucket().getFiles();
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  }

  async function seedVault(uid: string) {
    await vaultRef(uid).set({
      wrappedVaultKey: 'fake-wrapped-key-base64==',
      encryptionVersion: 1,
      vaultKeyVersion: 1,
      kmsKeyVersion: 'projects/ajfit-rules-test/locations/us-central1/keyRings/ajfit-photo-vault/cryptoKeys/photo-vault-kek/cryptoKeyVersions/1',
      algorithm: 'AES-256-GCM',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Photo ciphertext this step must NEVER touch — Storage Cleanup's job.
    await storage
      .bucket()
      .file(`users/${uid}/progressPhotos/p1.enc`)
      .save(Buffer.from('fake-ciphertext'), { contentType: 'application/octet-stream' });
  }

  beforeAll(async () => {
    await wipe();
  }, 30_000);

  it(
    'destroys the wrapped Vault Key while leaving Storage ciphertext and another uid untouched — real Firestore, not a fake',
    async () => {
      await seedVault('vkd-uid-A');
      await seedVault('vkd-uid-B'); // other-uid control

      const outcome = await executeVaultKeyDestruction('vkd-uid-A', {
        deleteVaultDocument: (uid) => vaultRef(uid).delete().then(() => undefined),
      });
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });

      // ── The sole wrapped-key document is gone ──
      const snapshotA = await vaultRef('vkd-uid-A').get();
      expect(snapshotA.exists).toBe(false);

      // ── Ciphertext survives (Storage Cleanup's job, not this step's) ──
      const [filesA] = await storage.bucket().getFiles({ prefix: 'users/vkd-uid-A/progressPhotos/' });
      expect(filesA).toHaveLength(1);

      // ── Other uid's vault key and ciphertext are 100% intact ──
      const snapshotB = await vaultRef('vkd-uid-B').get();
      expect(snapshotB.exists).toBe(true);
      const [filesB] = await storage.bucket().getFiles({ prefix: 'users/vkd-uid-B/progressPhotos/' });
      expect(filesB).toHaveLength(1);

      await wipe();
    },
    60_000,
  );

  it(
    'retry after the fact (idempotency against real Firestore): re-running on an already-destroyed uid stays SUCCEEDED',
    async () => {
      await seedVault('vkd-uid-A');
      const deleteVaultDocument = (uid: string) => vaultRef(uid).delete().then(() => undefined);

      await executeVaultKeyDestruction('vkd-uid-A', { deleteVaultDocument });
      const retry = await executeVaultKeyDestruction('vkd-uid-A', { deleteVaultDocument });

      expect(retry).toEqual({ kind: 'SUCCEEDED' });

      await wipe();
    },
    30_000,
  );

  it(
    'a uid with no vault at all is still SUCCEEDED (never created, never an error)',
    async () => {
      const outcome = await executeVaultKeyDestruction('vkd-uid-never-had-one', {
        deleteVaultDocument: (uid) => vaultRef(uid).delete().then(() => undefined),
      });
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    },
    30_000,
  );

  it(
    'composed with Fase 6: VAULT_KEY_DESTRUCTION(A) then FIRESTORE_CLEANUP(A) — vault material and privateSecurity both absent afterward (§35)',
    async () => {
      const uid = 'vkd-uid-composed';
      await db.collection('users').doc(uid).set({ profile: { name: 'Composed Test User' } });
      await db.collection('users').doc(uid).collection('questionnaires').doc('q1').set({ answers: {} });
      await seedVault(uid);

      const vaultOutcome = await executeVaultKeyDestruction(uid, {
        deleteVaultDocument: (u) => vaultRef(u).delete().then(() => undefined),
      });
      expect(vaultOutcome).toEqual({ kind: 'SUCCEEDED' });

      // Firestore Cleanup (Fase 6) never depends on this step having run —
      // it simply never touches privateSecurity either way. Running it
      // afterward proves the two engines compose without conflict.
      const cleanupOutcome = await runFirestoreCleanup(uid, { db });
      expect(cleanupOutcome).toEqual({ kind: 'SUCCEEDED' });

      const vaultSnapshot = await vaultRef(uid).get();
      expect(vaultSnapshot.exists).toBe(false);
      const privateSecuritySnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('privateSecurity')
        .get();
      expect(privateSecuritySnapshot.empty).toBe(true);
      const userSnapshot = await db.collection('users').doc(uid).get();
      expect(userSnapshot.exists).toBe(false);

      // A retry of VAULT_KEY_DESTRUCTION after Firestore Cleanup already ran
      // still converges to logical success — coherent with the real schema.
      const retryAfterCleanup = await executeVaultKeyDestruction(uid, {
        deleteVaultDocument: (u) => vaultRef(u).delete().then(() => undefined),
      });
      expect(retryAfterCleanup).toEqual({ kind: 'SUCCEEDED' });

      await db.collection('users').doc(uid).collection('questionnaires').doc('q1').delete();
      await storage.bucket().file(`users/${uid}/progressPhotos/p1.enc`).delete({ ignoreNotFound: true });
    },
    60_000,
  );
});
