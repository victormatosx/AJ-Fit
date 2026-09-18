import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, storage } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { SUPPORT_CASES_COLLECTION, SUPPORT_UPLOADS_COLLECTION, supportCleanupToken } from './supportV2';

const SCOPE = 'supportV2.cleanup';
const LEASE_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;

async function deleteObject(storageService: Storage, path: string): Promise<void> {
  try {
    await storageService.bucket().file(path).delete();
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 404) throw error;
  }
}

async function claimCase(caseRef: DocumentReference, now: Timestamp): Promise<string | null> {
  const token = supportCleanupToken();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef);
    if (!snapshot.exists) return null;
    const data = snapshot.data()!;
    if (!['CLOSED_SINGLE', 'CHAT_CLOSED'].includes(data.state)) return null;
    if (!(data.purgeAt instanceof Timestamp) || data.purgeAt.toMillis() > now.toMillis()) return null;
    if (data.cleanupLeaseUntil instanceof Timestamp && data.cleanupLeaseUntil.toMillis() > now.toMillis()) return null;
    transaction.update(caseRef, {
      cleanupToken: token,
      cleanupStartedAt: data.cleanupStartedAt ?? now,
      cleanupLeaseUntil: Timestamp.fromMillis(now.toMillis() + LEASE_MS),
    });
    return token;
  });
}

async function deleteCollectionPages(collection: FirebaseFirestore.CollectionReference): Promise<void> {
  while (true) {
    const snapshot = await collection.orderBy('__name__').limit(PAGE_SIZE).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    if (snapshot.size < PAGE_SIZE) return;
  }
}

/** Storage is always removed before any message or parent document. Safe to retry after any step. */
export async function purgeSupportCase(
  caseRef: DocumentReference,
  firestore: Firestore = db,
  storageService: Storage = storage,
  now: Timestamp = Timestamp.now(),
): Promise<boolean> {
  void firestore; // kept injectable as part of the cleanup contract/test surface
  const token = await claimCase(caseRef, now);
  if (!token) return false;

  const messages = await caseRef.collection('messages').get();
  const paths = new Set<string>();
  for (const message of messages.docs) {
    const attachments = message.data().attachments;
    if (!Array.isArray(attachments)) continue;
    for (const attachment of attachments) {
      if (attachment && typeof attachment.storagePath === 'string') paths.add(attachment.storagePath);
    }
  }
  for (const path of paths) await deleteObject(storageService, path);

  // Delete child data only after every object is confirmed absent. The parent
  // is deliberately last, preserving a durable retry anchor after failures.
  await deleteCollectionPages(caseRef.collection('messages'));
  await deleteCollectionPages(caseRef.collection('_actions'));
  const sessions = await db.collection(SUPPORT_UPLOADS_COLLECTION).where('caseId', '==', caseRef.id).get();
  if (!sessions.empty) {
    const batch = db.batch();
    for (const session of sessions.docs) batch.delete(session.ref);
    await batch.commit();
  }
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(caseRef);
    if (!current.exists) return;
    if (current.data()?.cleanupToken !== token) throw new Error('support_cleanup_lease_lost');
    transaction.delete(caseRef);
  });
  logInfo(SCOPE, 'case_purged', { caseId: caseRef.id, objectCount: paths.size, cleanupToken: token });
  return true;
}

export async function purgeExpiredUploads(now: Timestamp = Timestamp.now()): Promise<number> {
  const snapshot = await db.collection(SUPPORT_UPLOADS_COLLECTION)
    .where('status', '==', 'STAGED')
    .where('expiresAt', '<=', now)
    .limit(100)
    .get();
  let purged = 0;
  for (const session of snapshot.docs) {
    try {
      const path = session.data().storagePath;
      if (typeof path === 'string') await deleteObject(storage, path);
      await session.ref.delete();
      purged += 1;
    } catch (error) {
      logFunctionError(SCOPE, error, { operation: 'purge_expired_upload', uploadId: session.id });
    }
  }
  return purged;
}

export async function cleanupSupportV2Core(now: Timestamp = Timestamp.now()): Promise<void> {
  const cases = await db.collection(SUPPORT_CASES_COLLECTION)
    .where('state', 'in', ['CLOSED_SINGLE', 'CHAT_CLOSED'])
    .where('purgeAt', '<=', now)
    .orderBy('purgeAt', 'asc')
    .limit(50)
    .get();
  for (const supportCase of cases.docs) {
    try {
      await purgeSupportCase(supportCase.ref, db, storage, now);
    } catch (error) {
      logFunctionError(SCOPE, error, { operation: 'purge_case', caseId: supportCase.id });
    }
  }
  const uploads = await purgeExpiredUploads(now);
  logInfo(SCOPE, 'sweep_completed', { caseCandidates: cases.size, expiredUploadsPurged: uploads });
}

export const cleanupSupportV2 = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'UTC', timeoutSeconds: 540, memory: '512MiB' },
  async () => cleanupSupportV2Core(),
);
