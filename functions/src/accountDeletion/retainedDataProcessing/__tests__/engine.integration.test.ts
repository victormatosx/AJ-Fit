/**
 * OPT-IN integration proof against the REAL Firestore + Storage Emulators —
 * Fase 8 gate. Same role as `firestoreCleanup`/`storageCleanup`'s own
 * `engine.integration.test.ts` (Fases 6/7): unit tests with fakes prove the
 * LOGIC; this file proves that, against real emulator behavior, policy v1
 * (support=RETAIN, couponRedemptions=RETAIN) genuinely preserves every
 * retained resource — never "empty because the query silently found
 * nothing".
 *
 * Skipped by default — only runs when `RETAINED_DATA_INTEGRATION=1`. Run
 * via `npm run test:integration:retainedData`, which wraps this in
 * `firebase emulators:exec --only firestore,storage --project
 * ajfit-rules-test`. Never touches production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { runRetainedDataProcessing } from '../engine';

const enabled = process.env.RETAINED_DATA_INTEGRATION === '1';

describe.skipIf(!enabled)('Retained Data Processing Engine — real Emulator integration', () => {
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

  afterAll(async () => {
    await deleteApp(app);
  });

  async function wipe() {
    for (const collection of ['supportTickets', 'couponRedemptions']) {
      const snapshot = await db.collection(collection).get();
      const writer = db.bulkWriter();
      for (const doc of snapshot.docs) writer.delete(doc.ref);
      await writer.close();
    }
    const [files] = await storage.bucket().getFiles();
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
  }

  beforeAll(async () => {
    await wipe();
  }, 30_000);

  async function seedFullUser(uid: string) {
    const ticketRef = db.collection('supportTickets').doc(`${uid}-t1`);
    await ticketRef.set({ userId: uid, subject: 'help', lastMessage: 'hi' });
    await ticketRef.collection('messages').doc('m1').set({ senderId: uid, message: 'hi' });
    await db
      .collection('couponRedemptions')
      .doc(uid)
      .set({ uid, couponCode: 'ARNALDO10', lockedAt: null });
    await storage
      .bucket()
      .file(`users/${uid}/support/${uid}-t1/attachments/photo.jpg`)
      .save(Buffer.from('fake-attachment'), { contentType: 'image/jpeg' });
  }

  it(
    'policy v1 (RETAIN/RETAIN): every resource survives, step reports SKIPPED_BY_POLICY — real Firestore + Storage, not fakes',
    async () => {
      await seedFullUser('rdp-uid-A');
      await seedFullUser('rdp-uid-B'); // other-uid control

      const outcome = await runRetainedDataProcessing(
        'rdp-uid-A',
        { support: 'RETAIN', couponRedemptions: 'RETAIN' },
        { db, storage },
      );

      expect(outcome.kind).toBe('SKIPPED_BY_POLICY');

      const ticket = await db.collection('supportTickets').doc('rdp-uid-A-t1').get();
      expect(ticket.exists).toBe(true);
      const message = await db.collection('supportTickets').doc('rdp-uid-A-t1').collection('messages').doc('m1').get();
      expect(message.exists).toBe(true);
      const redemption = await db.collection('couponRedemptions').doc('rdp-uid-A').get();
      expect(redemption.exists).toBe(true);
      const [attachments] = await storage.bucket().getFiles({ prefix: 'users/rdp-uid-A/support/' });
      expect(attachments).toHaveLength(1);

      // Other uid 100% intact.
      const otherTicket = await db.collection('supportTickets').doc('rdp-uid-B-t1').get();
      expect(otherTicket.exists).toBe(true);
      const otherRedemption = await db.collection('couponRedemptions').doc('rdp-uid-B').get();
      expect(otherRedemption.exists).toBe(true);

      await wipe();
    },
    60_000,
  );

  it(
    'idempotent retry against real Firestore + Storage: running the step again after a first RETAIN run stays SKIPPED_BY_POLICY with no mutation',
    async () => {
      await seedFullUser('rdp-uid-retry');

      await runRetainedDataProcessing(
        'rdp-uid-retry',
        { support: 'RETAIN', couponRedemptions: 'RETAIN' },
        { db, storage },
      );
      const retry = await runRetainedDataProcessing(
        'rdp-uid-retry',
        { support: 'RETAIN', couponRedemptions: 'RETAIN' },
        { db, storage },
      );

      expect(retry.kind).toBe('SKIPPED_BY_POLICY');
      const ticket = await db.collection('supportTickets').doc('rdp-uid-retry-t1').get();
      expect(ticket.exists).toBe(true);

      await wipe();
    },
    60_000,
  );
});
