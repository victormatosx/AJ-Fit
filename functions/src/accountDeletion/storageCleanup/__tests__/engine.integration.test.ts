/**
 * OPT-IN integration proof against the REAL Storage Emulator — Fase 7 gate
 * §53/§54.11: unit tests with a fake bucket prove the LOGIC; this file
 * proves the engine against real Cloud Storage semantics (real listing/
 * pagination, real object existence), same role as
 * `firestoreCleanup/__tests__/engine.integration.test.ts` (Fase 6) and
 * `firestore-tests/`/`storage-tests/` (Fase 5).
 *
 * Skipped by default — only runs when `STORAGE_CLEANUP_INTEGRATION=1` is
 * set. Run via the root `test:integration:storageCleanup` npm script,
 * which wraps this in `firebase emulators:exec --only storage,firestore
 * --project ajfit-rules-test` (Storage Emulator requires the Firestore
 * emulator running alongside it in this project's existing setup — see
 * `vitest.storage.config.mts`'s doc comment, Fase 5/7). Never touches
 * production; uses its own named Admin app instance, never the shared
 * `functions/src/lib/firebaseAdmin.ts` singleton.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { runStorageCleanup } from '../engine';

const enabled = process.env.STORAGE_CLEANUP_INTEGRATION === '1';

describe.skipIf(!enabled)('Storage Cleanup Engine — real Emulator integration', () => {
  let app: App;
  let storage: Storage;

  beforeAll(() => {
    app = initializeApp(
      { projectId: 'ajfit-rules-test', storageBucket: 'ajfit-rules-test.appspot.com' },
      'storage-cleanup-integration',
    );
    storage = getStorage(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  async function wipeBucket() {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles();
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  }

  async function seedFullUser(uid: string) {
    const bucket = storage.bucket();
    await bucket.file(`users/${uid}/profile/avatar`).save(Buffer.from('fake-avatar-bytes'), {
      contentType: 'image/jpeg',
    });
    for (let i = 0; i < 40; i++) {
      await bucket
        .file(`users/${uid}/progressPhotos/p${i}.enc`)
        .save(Buffer.from('fake-ciphertext'), { contentType: 'application/octet-stream' });
      await bucket
        .file(`users/${uid}/progressPhotos/p${i}.thumb.enc`)
        .save(Buffer.from('fake-thumb-ciphertext'), { contentType: 'application/octet-stream' });
    }
    await bucket
      .file(`users/${uid}/support-v2/staged/upload-1`)
      .save(Buffer.from('fake-attachment'), { contentType: 'image/jpeg' });
  }

  async function existsUnder(prefix: string): Promise<string[]> {
    const [files] = await storage.bucket().getFiles({ prefix });
    return files.map((f) => f.name);
  }

  beforeAll(async () => {
    await wipeBucket();
  }, 30_000);

  it(
    'proves DELETE = absent, support attachment + other-uid = preserved — real Storage, not a fake',
    async () => {
      await seedFullUser('test-uid-storage-A');
      await seedFullUser('test-uid-storage-B'); // other-uid control

      const outcome = await runStorageCleanup('test-uid-storage-A', { storage });
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });

      // ── DELETE = absent ──
      expect(await existsUnder('users/test-uid-storage-A/profile/')).toEqual([]);
      expect(await existsUnder('users/test-uid-storage-A/progressPhotos/')).toEqual([]);

      // ── RETAIN (support) = preserved ──
      expect(await existsUnder('users/test-uid-storage-A/support-v2/')).toEqual([
        'users/test-uid-storage-A/support-v2/staged/upload-1',
      ]);

      // ── Other uid = 100% intact ──
      expect(await existsUnder('users/test-uid-storage-B/profile/')).toHaveLength(1);
      expect(await existsUnder('users/test-uid-storage-B/progressPhotos/')).toHaveLength(80); // 40 * 2
      expect(await existsUnder('users/test-uid-storage-B/support-v2/')).toHaveLength(1);

      await wipeBucket();
    },
    60_000,
  );

  it(
    'retry after the fact (idempotency against real Storage): re-running on an already-cleaned uid stays SUCCEEDED',
    async () => {
      await seedFullUser('test-uid-storage-retry');
      await runStorageCleanup('test-uid-storage-retry', { storage });

      const retry = await runStorageCleanup('test-uid-storage-retry', { storage });
      expect(retry).toEqual({ kind: 'SUCCEEDED' });

      await wipeBucket();
    },
    60_000,
  );

  it(
    'deletes a Storage object with NO corresponding Firestore document at all (orphan independence, real Storage)',
    async () => {
      const bucket = storage.bucket();
      await bucket
        .file('users/test-uid-storage-orphan/progressPhotos/orphan.enc')
        .save(Buffer.from('orphan-ciphertext'), { contentType: 'application/octet-stream' });

      const outcome = await runStorageCleanup('test-uid-storage-orphan', { storage });
      expect(outcome).toEqual({ kind: 'SUCCEEDED' });
      expect(await existsUnder('users/test-uid-storage-orphan/progressPhotos/')).toEqual([]);

      await wipeBucket();
    },
    30_000,
  );
});
