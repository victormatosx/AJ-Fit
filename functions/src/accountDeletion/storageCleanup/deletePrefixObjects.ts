/**
 * Generic, paginated, idempotent bulk-delete of every object under one
 * Cloud Storage prefix — Fase 7 §32/§43/§44.
 *
 * INTERNAL ONLY — never exported from this module's public surface
 * (`index.ts` does not re-export it). Fase 7 §35 is explicit: the engine
 * must never expose a `deletePrefix(path)`-shaped API to callers outside
 * this directory, because an arbitrary caller-supplied prefix is exactly
 * how retained data (`users/{uid}/support-v2/...`) could get swept by
 * accident. `resources.ts` is the ONLY caller, and it always builds the
 * prefix itself from a fixed, hardcoded template — never from external
 * input.
 *
 * Independent of Firestore by construction: this function only ever calls
 * the Storage `list`/`delete` APIs. It never reads a Firestore document to
 * discover what to delete (Fase 7 §32/§33) — it discovers objects purely
 * by listing the Storage namespace itself, so an object whose Firestore
 * metadata document is already gone (or never existed) is still found and
 * removed. See `resources.ts`'s doc comment for the orphan-object tests
 * this guarantees.
 */

import type { Bucket, GetFilesOptions, GetFilesResponse } from '@google-cloud/storage';

const DEFAULT_PAGE_SIZE = 500;

export interface DeletePrefixResult {
  deletedCount: number;
}

export async function deletePrefixObjects(
  bucket: Bucket,
  prefix: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<DeletePrefixResult> {
  let deletedCount = 0;
  let pageToken: string | undefined;

  for (;;) {
    const query: GetFilesOptions = {
      prefix,
      maxResults: pageSize,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    };
    const [files, nextQuery]: GetFilesResponse = await bucket.getFiles(query);

    if (files.length > 0) {
      // `ignoreNotFound` makes a delete of an object another process
      // already removed (or that vanished between listing and this call) a
      // silent no-op instead of a thrown 404 — Fase 7 §40's "object missing
      // = logical success", applied per-object rather than only at the
      // whole-prefix level.
      await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
      deletedCount += files.length;
    }

    // The Storage Emulator returns `null` (not `{}`) for this element when
    // there is nothing left to paginate — the SDK's declared type says it's
    // always an object, but real emulator behavior disagrees, so this must
    // not assume `nextQuery` is non-null before probing it.
    pageToken = nextQuery && 'pageToken' in nextQuery ? nextQuery.pageToken : undefined;
    if (!pageToken) break;
  }

  return { deletedCount };
}
