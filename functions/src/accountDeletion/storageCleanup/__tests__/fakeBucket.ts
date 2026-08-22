/**
 * Minimal in-memory fake of the slice of the `@google-cloud/storage`
 * `Bucket` API this module's engine actually uses: `getFiles({prefix,
 * maxResults, pageToken})` and `File.delete({ignoreNotFound})`. Same role
 * as `firestoreCleanup/__tests__/fakeFirestore.ts` — fast, deterministic
 * unit-test coverage; the Fase 7 report's Storage Emulator integration test
 * is what proves this against real Cloud Storage behavior.
 */

import type { Bucket } from '@google-cloud/storage';

export interface FakeBucketHarness {
  bucket: Bucket;
  seed(name: string): void;
  exists(name: string): boolean;
  listUnder(prefix: string): string[];
  /** Forces the NEXT `getFiles()` call to reject, simulating a transient listing failure. */
  failNextGetFiles(error: Error): void;
  /** Forces the NEXT `delete()` call (on any object) to reject with a non-404, simulating a transient delete failure. */
  failNextDelete(error: Error): void;
}

/**
 * When `true`, the fake returns `null` as the second `getFiles()` tuple
 * element instead of `{}` once there is nothing left to paginate — this is
 * what the real Storage Emulator does (discovered against real Cloud
 * Storage in the Fase 7 integration test), even though the SDK's declared
 * `GetFilesResponse` type says it's always an object. `deletePrefixObjects`
 * must not crash on this.
 */
export function createFakeBucket(options: { emulatorNullNextQuery?: boolean } = {}): FakeBucketHarness {
  const existing = new Set<string>();
  let pendingGetFilesFailure: Error | null = null;
  let pendingDeleteFailure: Error | null = null;

  function fileRef(name: string) {
    return {
      name,
      async delete(opts?: { ignoreNotFound?: boolean }) {
        if (pendingDeleteFailure) {
          const error = pendingDeleteFailure;
          pendingDeleteFailure = null;
          throw error;
        }
        if (!existing.has(name) && !opts?.ignoreNotFound) {
          throw Object.assign(new Error('No such object'), { code: 404 });
        }
        existing.delete(name);
      },
    };
  }

  const bucket = {
    async getFiles(query: { prefix?: string; maxResults?: number; pageToken?: string }) {
      if (pendingGetFilesFailure) {
        const error = pendingGetFilesFailure;
        pendingGetFilesFailure = null;
        throw error;
      }

      const prefix = query.prefix ?? '';
      // Cursor is the LAST NAME already returned, not a numeric offset —
      // `existing` shrinks as the caller deletes objects between pages, so
      // an integer index would silently skip/duplicate entries. Real
      // Storage `pageToken`s are opaque cursors with the same
      // shrink-safety property; this mirrors that, not the exact encoding.
      let names = [...existing].filter((name) => name.startsWith(prefix)).sort();
      if (query.pageToken) {
        names = names.filter((name) => name > (query.pageToken as string));
      }
      const pageSize = query.maxResults ?? names.length;
      const page = names.slice(0, pageSize);
      const hasNextPage = page.length === pageSize && names.length > pageSize;
      const nextQuery = hasNextPage
        ? { pageToken: page[page.length - 1] }
        : options.emulatorNullNextQuery
          ? null
          : {};

      return [page.map(fileRef), nextQuery, {}];
    },
  };

  return {
    bucket: bucket as unknown as Bucket,
    seed(name: string) {
      existing.add(name);
    },
    exists(name: string) {
      return existing.has(name);
    },
    listUnder(prefix: string) {
      return [...existing].filter((name) => name.startsWith(prefix)).sort();
    },
    failNextGetFiles(error: Error) {
      pendingGetFilesFailure = error;
    },
    failNextDelete(error: Error) {
      pendingDeleteFailure = error;
    },
  };
}
