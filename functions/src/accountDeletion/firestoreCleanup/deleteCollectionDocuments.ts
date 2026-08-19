/**
 * Generic, paginated, idempotent bulk-delete of every document directly in
 * one Firestore collection — Fase 6 §18/§19/§20.
 *
 * Deliberately NOT `db.recursiveDelete(ref)`: `recursiveDelete` would also
 * remove any subcollection nested under each deleted document, and this
 * engine must never assume a resource category has no such nested data it
 * doesn't know about (Fase 6 §9 — no cascade-by-assumption). Listing +
 * `BulkWriter.delete()` per document, one level only, is the deliberately
 * more conservative choice — see `resources.ts` for why `users/{uid}`
 * itself is handled with a single plain `.delete()`, never a recursive one,
 * specifically so `privateSecurity/photoVault` (VAULT_KEY_DESTRUCTION's
 * responsibility, never this engine's) is never touched as a side effect.
 *
 * Idempotency: an empty collection (nothing left to page through) returns
 * `{ deletedCount: 0 }` — logical success, not a distinct "already done"
 * code path. A document that disappears between being listed and the
 * `BulkWriter` flush (another process/retry racing this one) is not an
 * error either — `BulkWriter.delete()` on an already-gone document
 * succeeds silently, matching Firestore's own delete semantics.
 *
 * Pagination: `orderBy('__name__')` + `startAfter(lastDoc)` — the
 * document-id ordering every Firestore collection supports natively,
 * without requiring any resource-specific field to sort by. Handles
 * collections far larger than any single query page without ever loading
 * more than `pageSize` documents into memory at once.
 */

import type { CollectionReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';

const DEFAULT_PAGE_SIZE = 300;

export interface DeleteCollectionResult {
  deletedCount: number;
}

export async function deleteCollectionDocuments(
  collectionRef: CollectionReference,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<DeleteCollectionResult> {
  const bulkWriter = collectionRef.firestore.bulkWriter();
  let deletedCount = 0;
  let lastDoc: QueryDocumentSnapshot | undefined;

  try {
    for (;;) {
      let query = collectionRef.orderBy('__name__').limit(pageSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        bulkWriter.delete(doc.ref);
        deletedCount += 1;
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }
  } finally {
    // Flushes every queued delete, retrying transient per-operation
    // failures internally (BulkWriter's own retry policy). Runs even if the
    // listing loop above threw partway through, so deletes already queued
    // from earlier pages are not abandoned. Throws if any operation
    // ultimately failed — propagated to the caller (`resources.ts`) for
    // classification, never swallowed here.
    await bulkWriter.close();
  }

  return { deletedCount };
}
