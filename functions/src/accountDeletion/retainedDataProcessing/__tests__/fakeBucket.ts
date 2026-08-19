/**
 * Minimal in-memory fake Storage bucket, same shape/rationale as Fase 7's
 * `storageCleanup/__tests__/fakeBucket.ts` — kept as its own copy rather
 * than imported across module boundaries, matching this repo's existing
 * per-module test-fake convention (`firestoreCleanup`/`storageCleanup` each
 * have their own).
 */

interface FakeFile {
  name: string;
  delete(opts?: { ignoreNotFound?: boolean }): Promise<void>;
}

export interface FakeBucketHarness {
  bucket: {
    getFiles(query: {
      prefix?: string;
      maxResults?: number;
      pageToken?: string;
    }): Promise<[FakeFile[], unknown, unknown]>;
  };
  seed(name: string): void;
  exists(name: string): boolean;
  listUnder(prefix: string): string[];
}

export function createFakeBucket(): FakeBucketHarness {
  const existing = new Set<string>();

  function fileRef(name: string): FakeFile {
    return {
      name,
      async delete(opts?: { ignoreNotFound?: boolean }) {
        if (!existing.has(name) && !opts?.ignoreNotFound) {
          throw Object.assign(new Error('No such object'), { code: 404 });
        }
        existing.delete(name);
      },
    };
  }

  const bucket = {
    async getFiles(query: {
      prefix?: string;
      maxResults?: number;
      pageToken?: string;
    }): Promise<[FakeFile[], unknown, unknown]> {
      const prefix = query.prefix ?? '';
      let names = [...existing].filter((name) => name.startsWith(prefix)).sort();
      if (query.pageToken) {
        names = names.filter((name) => name > (query.pageToken as string));
      }
      const pageSize = query.maxResults ?? names.length;
      const page = names.slice(0, pageSize);
      const nextQuery =
        page.length === pageSize && names.length > pageSize ? { pageToken: page[page.length - 1] } : {};

      return [page.map(fileRef), nextQuery, {}];
    },
  };

  return {
    bucket,
    seed(name: string) {
      existing.add(name);
    },
    exists(name: string) {
      return existing.has(name);
    },
    listUnder(prefix: string) {
      return [...existing].filter((name) => name.startsWith(prefix)).sort();
    },
  };
}
