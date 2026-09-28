/** Opt-in proof against the real Firestore + Storage emulators. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { runRetainedDataProcessing } from '../engine';

const enabled = process.env.RETAINED_DATA_INTEGRATION === '1';

describe.skipIf(!enabled)('Retained Data Processing — Support V2 emulator integration', () => {
  let app: App;
  let db: Firestore;
  let storage: Storage;

  beforeAll(() => {
    app = initializeApp(
      { projectId: 'ajfit-rules-test', storageBucket: 'ajfit-rules-test.appspot.com' },
      'retained-data-integration',
    );
    db = getFirestore(app);
    storage = getStorage(app);
  });

  afterAll(async () => deleteApp(app));

  async function wipe() {
    for (const collectionName of ['supportCases', 'supportUploadSessions', 'supportRateLimits', 'couponRedemptions']) {
      const snapshot = await db.collection(collectionName).get();
      for (const document of snapshot.docs) await db.recursiveDelete(document.ref);
    }
    const [files] = await storage.bucket().getFiles();
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  }

  beforeAll(wipe, 30_000);

  async function seedFullUser(uid: string) {
    const caseId = `${uid}-case`;
    const uploadId = `${uid}-upload`;
    const storagePath = `users/${uid}/support-v2/staged/${uploadId}`;
    const caseRef = db.collection('supportCases').doc(caseId);
    await caseRef.set({ ownerUid: uid, state: 'CHAT_OPEN' });
    await caseRef.collection('messages').doc('m1').set({
      senderId: uid,
      attachments: [{ storagePath }],
    });
    await caseRef.collection('_actions').doc('a1').set({ adminUid: 'admin-1' });
    await db.collection('supportUploadSessions').doc(uploadId).set({
      ownerUid: uid, caseId, status: 'ATTACHED', storagePath,
    });
    await db.collection('supportRateLimits').doc(`${uid}_create-case`).set({ ownerUid: uid });
    await db.collection('couponRedemptions').doc(uid).set({ uid });
    await storage.bucket().file(storagePath).save(Buffer.from('attachment'));
    return { caseId, uploadId, storagePath };
  }

  it('RETAIN preserves the entire V2 graph and another uid', async () => {
    const target = await seedFullUser('rdp-uid-A');
    const other = await seedFullUser('rdp-uid-B');

    const outcome = await runRetainedDataProcessing(
      'rdp-uid-A',
      { support: 'RETAIN', couponRedemptions: 'RETAIN' },
      { db, storage },
    );

    expect(outcome.kind).toBe('SKIPPED_BY_POLICY');
    expect((await db.doc(`supportCases/${target.caseId}`).get()).exists).toBe(true);
    expect((await db.doc(`supportCases/${target.caseId}/messages/m1`).get()).exists).toBe(true);
    expect((await db.doc(`supportCases/${target.caseId}/_actions/a1`).get()).exists).toBe(true);
    expect((await db.doc(`supportUploadSessions/${target.uploadId}`).get()).exists).toBe(true);
    expect(await storage.bucket().file(target.storagePath).exists()).toEqual([true]);
    expect((await db.doc(`supportCases/${other.caseId}`).get()).exists).toBe(true);
    await wipe();
  }, 60_000);

  it('DELETE removes the complete target graph, is repeatable and preserves another uid', async () => {
    const target = await seedFullUser('rdp-delete-A');
    const other = await seedFullUser('rdp-delete-B');

    const first = await runRetainedDataProcessing(
      'rdp-delete-A',
      { support: 'DELETE', couponRedemptions: 'RETAIN' },
      { db, storage },
    );
    const retry = await runRetainedDataProcessing(
      'rdp-delete-A',
      { support: 'DELETE', couponRedemptions: 'RETAIN' },
      { db, storage },
    );

    expect(first.kind).toBe('SUCCEEDED');
    expect(retry.kind).toBe('SUCCEEDED');
    expect((await db.doc(`supportCases/${target.caseId}`).get()).exists).toBe(false);
    expect((await db.doc(`supportUploadSessions/${target.uploadId}`).get()).exists).toBe(false);
    expect((await db.doc('supportRateLimits/rdp-delete-A_create-case').get()).exists).toBe(false);
    expect(await storage.bucket().file(target.storagePath).exists()).toEqual([false]);
    expect((await db.doc(`supportCases/${other.caseId}`).get()).exists).toBe(true);
    expect(await storage.bucket().file(other.storagePath).exists()).toEqual([true]);
    await wipe();
  }, 60_000);
});
