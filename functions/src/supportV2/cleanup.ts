import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, storage } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { SUPPORT_CASES_COLLECTION, SUPPORT_UPLOADS_COLLECTION, supportCleanupToken } from './supportV2';
import { deleteSupportCaseChildren, deleteSupportObject } from './supportDataDeletion';

const SCOPE = 'supportV2.cleanup';
const LEASE_MS = 10 * 60 * 1000;

async function claimCase(
  caseRef: DocumentReference,
  now: Timestamp,
  firestore: Firestore,
): Promise<string | null> {
  const token = supportCleanupToken();
  return firestore.runTransaction(async (transaction) => {
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

/** Storage is always removed before any message or parent document. Safe to retry after any step. */
export async function purgeSupportCase(
  caseRef: DocumentReference,
  firestore: Firestore = db,
  storageService: Storage = storage,
  now: Timestamp = Timestamp.now(),
): Promise<boolean> {
  const token = await claimCase(caseRef, now, firestore);
  if (!token) return false;
  const objectCount = await deleteSupportCaseChildren(caseRef, firestore, storageService);
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(caseRef);
    if (!current.exists) return;
    if (current.data()?.cleanupToken !== token) throw new Error('support_cleanup_lease_lost');
    transaction.delete(caseRef);
  });
  logInfo(SCOPE, 'case_purged', { caseId: caseRef.id, objectCount, cleanupToken: token });
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
      if (typeof path === 'string') await deleteSupportObject(storage, path);
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
