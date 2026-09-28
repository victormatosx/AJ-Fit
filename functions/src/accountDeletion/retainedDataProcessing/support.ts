/**
 * Support V2 retained-data policy executor.
 *
 * RETAIN preserves the complete case graph exactly as the frozen policy
 * requests. DELETE removes every V2 resource owned by, or attached to a case
 * owned by, the deleted account. ANONYMIZE remains unsupported because the
 * project has no reviewed field-by-field anonymization contract.
 */

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import { storage as defaultStorage } from '../../lib/firebaseAdmin';
import {
  SUPPORT_CASES_COLLECTION,
  SUPPORT_RATE_LIMITS_COLLECTION,
  SUPPORT_UPLOADS_COLLECTION,
} from '../../supportV2/supportV2';
import {
  deleteSupportCaseChildren,
  deleteSupportObject,
  deleteSupportStoragePrefix,
} from '../../supportV2/supportDataDeletion';
import type { RetentionAction } from '../types';
import { UnsupportedRetentionActionError } from './types';
import type { RetainedDataCategoryResult } from './types';

const PAGE_SIZE = 100;

function userUploadPrefix(uid: string): string {
  return `users/${uid}/support-v2/staged/`;
}

async function findOwnedCaseRefs(db: Firestore, uid: string): Promise<DocumentReference[]> {
  const refs: DocumentReference[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = db
      .collection(SUPPORT_CASES_COLLECTION)
      .where('ownerUid', '==', uid)
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    if (snapshot.empty) return refs;
    refs.push(...snapshot.docs.map((document) => document.ref));
    lastId = snapshot.docs[snapshot.docs.length - 1].id;
    if (snapshot.size < PAGE_SIZE) return refs;
  }
}

async function deleteOwnedCases(
  db: Firestore,
  storage: Storage,
  caseRefs: DocumentReference[],
): Promise<void> {
  for (const caseRef of caseRefs) {
    try {
      // This state is outside every user/admin transition vocabulary. Once
      // committed, concurrent Support V2 transactions retry, observe it and
      // reject instead of adding a new child while cleanup is in progress.
      // The parent remains an ownership/discovery anchor until every child
      // and object is gone, so reconciliation can resume after any failure.
      await caseRef.update({ state: 'ACCOUNT_DELETION', purgeAt: null });
    } catch (error) {
      if ((error as { code?: number }).code === 5) continue;
      throw error;
    }
    await deleteSupportCaseChildren(caseRef, db, storage);
    await caseRef.delete();
  }
}

async function deleteOwnedUploadSessions(db: Firestore, storage: Storage, uid: string): Promise<number> {
  let deletedCount = 0;
  for (;;) {
    const snapshot = await db
      .collection(SUPPORT_UPLOADS_COLLECTION)
      .where('ownerUid', '==', uid)
      .limit(PAGE_SIZE)
      .get();
    if (snapshot.empty) return deletedCount;

    for (const session of snapshot.docs) {
      const path = session.data().storagePath;
      if (typeof path === 'string') await deleteSupportObject(storage, path);
    }
    const writer = db.bulkWriter();
    for (const session of snapshot.docs) writer.delete(session.ref);
    await writer.close();
    deletedCount += snapshot.size;
  }
}

async function deleteOwnedRateLimits(db: Firestore, uid: string): Promise<number> {
  let deletedCount = 0;
  for (;;) {
    const snapshot = await db
      .collection(SUPPORT_RATE_LIMITS_COLLECTION)
      .where('ownerUid', '==', uid)
      .limit(PAGE_SIZE)
      .get();
    if (snapshot.empty) return deletedCount;
    const writer = db.bulkWriter();
    for (const limit of snapshot.docs) writer.delete(limit.ref);
    await writer.close();
    deletedCount += snapshot.size;
  }
}

export async function processSupportRetention(
  uid: string,
  action: RetentionAction,
  deps: { db: Firestore; storage?: Storage },
): Promise<RetainedDataCategoryResult> {
  const { db } = deps;
  const storage = deps.storage ?? defaultStorage;

  if (action === 'ANONYMIZE') {
    throw new UnsupportedRetentionActionError('support', action);
  }

  const caseRefs = await findOwnedCaseRefs(db, uid);
  if (action !== 'DELETE') {
    return { category: 'support', action, outcome: 'RETAINED', resourceCount: caseRefs.length };
  }

  await deleteOwnedCases(db, storage, caseRefs);
  const deletedSessions = await deleteOwnedUploadSessions(db, storage, uid);
  const deletedRateLimits = await deleteOwnedRateLimits(db, uid);
  // Catches a Storage object whose session/case was removed by an earlier,
  // interrupted attempt. The prefix is UID-scoped and cannot touch another
  // account or an admin-owned attachment linked to somebody else's case.
  const deletedPrefixObjects = await deleteSupportStoragePrefix(storage, userUploadPrefix(uid));
  const deletedAnything = caseRefs.length + deletedSessions + deletedRateLimits + deletedPrefixObjects > 0;

  return {
    category: 'support',
    action,
    outcome: deletedAnything ? 'DELETED' : 'ALREADY_ABSENT',
    resourceCount: caseRefs.length,
  };
}
