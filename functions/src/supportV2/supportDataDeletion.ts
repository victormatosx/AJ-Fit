import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

import {
  SUPPORT_ACTIONS_SUBCOLLECTION,
  SUPPORT_MESSAGES_SUBCOLLECTION,
  SUPPORT_UPLOADS_COLLECTION,
} from './supportV2';

const PAGE_SIZE = 100;

export async function deleteSupportObject(storage: Storage, path: string): Promise<void> {
  try {
    await storage.bucket().file(path).delete();
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}

export async function deleteSupportStoragePrefix(storage: Storage, prefix: string): Promise<number> {
  let deletedCount = 0;
  let pageToken: string | undefined;

  for (;;) {
    const [files, nextQuery] = await storage.bucket().getFiles({
      prefix,
      maxResults: 500,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deletedCount += 1;
    }
    pageToken = nextQuery && 'pageToken' in nextQuery ? nextQuery.pageToken : undefined;
    if (!pageToken) return deletedCount;
  }
}

async function deleteCollectionPages(
  collection: FirebaseFirestore.CollectionReference,
  firestore: Firestore,
): Promise<void> {
  for (;;) {
    const snapshot = await collection.orderBy('__name__').limit(PAGE_SIZE).get();
    if (snapshot.empty) return;
    const batch = firestore.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
  }
}

/**
 * Deletes every child resource of one Support V2 case, but deliberately
 * leaves the parent document for the caller to delete under its own lease or
 * ownership guard. Storage goes first and the durable parent goes last, so a
 * failure can always be retried without losing the discovery anchor.
 */
export async function deleteSupportCaseChildren(
  caseRef: DocumentReference,
  firestore: Firestore,
  storage: Storage,
): Promise<number> {
  let objectCount = 0;
  const messages = caseRef.collection(SUPPORT_MESSAGES_SUBCOLLECTION);
  for (;;) {
    const page = await messages.orderBy('__name__').limit(PAGE_SIZE).get();
    if (page.empty) break;
    const paths = new Set<string>();
    for (const message of page.docs) {
      const attachments = message.data().attachments;
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments) {
        if (attachment && typeof attachment.storagePath === 'string') paths.add(attachment.storagePath);
      }
    }
    for (const path of paths) await deleteSupportObject(storage, path);
    objectCount += paths.size;
    const batch = firestore.batch();
    for (const message of page.docs) batch.delete(message.ref);
    await batch.commit();
  }

  await deleteCollectionPages(caseRef.collection(SUPPORT_ACTIONS_SUBCOLLECTION), firestore);

  const sessions = firestore.collection(SUPPORT_UPLOADS_COLLECTION).where('caseId', '==', caseRef.id);
  for (;;) {
    const page = await sessions.limit(PAGE_SIZE).get();
    if (page.empty) break;
    for (const session of page.docs) {
      const path = session.data().storagePath;
      if (typeof path === 'string') {
        await deleteSupportObject(storage, path);
        objectCount += 1;
      }
    }
    const batch = firestore.batch();
    for (const session of page.docs) batch.delete(session.ref);
    await batch.commit();
  }
  return objectCount;
}
