/**
 * Minimal in-memory fake of the slice of the Firestore Admin SDK this
 * module's engine actually uses: `collection().doc()`, `collection()
 * .orderBy().limit().startAfter().get()`, `doc().get()/.delete()`, and
 * `firestore.bulkWriter()`. NOT a general-purpose Firestore emulator
 * substitute — just enough surface, faithfully enough (real pagination via
 * id ordering + `startAfter`, real "document really removed from the
 * store" semantics), to unit-test `deleteCollectionDocuments`/`resources.ts`/
 * `engine.ts` without any network or the real Emulator. The Fase 6 report's
 * Emulator-based integration test is what proves this against real
 * Firestore behavior.
 */

export interface FakeDocRef {
  path: string;
  id: string;
  get(): Promise<{ exists: boolean; ref: FakeDocRef }>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}

interface FakeSnapshotDoc {
  id: string;
  ref: FakeDocRef;
}

interface FakeQuery {
  get(): Promise<{ empty: boolean; size: number; docs: FakeSnapshotDoc[] }>;
  orderBy(field: string): FakeQuery;
  limit(n: number): FakeQuery;
  startAfter(doc: FakeSnapshotDoc): FakeQuery;
}

export interface FakeCollectionRef extends FakeQuery {
  path: string;
  firestore: FakeFirestore;
  doc(id: string): FakeDocRef;
}

export interface FakeBulkWriter {
  delete(ref: FakeDocRef): void;
  close(): Promise<void>;
}

export interface FakeFirestore {
  collection(name: string): FakeCollectionRef;
  bulkWriter(): FakeBulkWriter;
}

export interface FakeFirestoreHarness {
  db: FakeFirestore;
  /** Seeds a document as "existing" — path segments joined with '/', e.g. `seed('users/uid-1')`. */
  seed(path: string): void;
  /** Whether a document currently exists in the fake store. */
  exists(path: string): boolean;
  /** All currently-existing document paths under a given prefix (for assertions). */
  listUnder(prefix: string): string[];
  /** Forces the NEXT `bulkWriter.close()` call to reject, simulating a mid-flush failure. */
  failNextBulkWriterClose(error: Error): void;
}

export function createFakeFirestore(): FakeFirestoreHarness {
  const existing = new Set<string>();
  let pendingCloseFailure: Error | null = null;

  function docRef(path: string): FakeDocRef {
    return {
      path,
      id: path.split('/').pop() as string,
      async get() {
        return { exists: existing.has(path), ref: docRef(path) };
      },
      async delete() {
        existing.delete(path);
      },
      collection(name: string) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(path: string): FakeCollectionRef {
    function buildQuery(state: { limit?: number; startAfterId?: string }): FakeQuery {
      return {
        orderBy() {
          return buildQuery(state);
        },
        limit(n: number) {
          return buildQuery({ ...state, limit: n });
        },
        startAfter(doc: FakeSnapshotDoc) {
          return buildQuery({ ...state, startAfterId: doc.id });
        },
        async get() {
          const prefix = `${path}/`;
          let ids = [...existing]
            .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
            .map((p) => p.slice(prefix.length))
            .sort();

          if (state.startAfterId) {
            const idx = ids.indexOf(state.startAfterId);
            ids = idx >= 0 ? ids.slice(idx + 1) : ids;
          }
          if (state.limit !== undefined) {
            ids = ids.slice(0, state.limit);
          }

          const docs = ids.map((id) => ({ id, ref: docRef(`${path}/${id}`) }));
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      };
    }

    return {
      path,
      firestore: db,
      doc(id: string) {
        return docRef(`${path}/${id}`);
      },
      ...buildQuery({}),
    };
  }

  const db: FakeFirestore = {
    collection(name: string) {
      return collectionRef(name);
    },
    bulkWriter(): FakeBulkWriter {
      const pending: FakeDocRef[] = [];
      return {
        delete(ref: FakeDocRef) {
          pending.push(ref);
        },
        async close() {
          if (pendingCloseFailure) {
            const error = pendingCloseFailure;
            pendingCloseFailure = null;
            throw error;
          }
          for (const ref of pending) existing.delete(ref.path);
        },
      };
    },
  };

  return {
    db,
    seed(path: string) {
      existing.add(path);
    },
    exists(path: string) {
      return existing.has(path);
    },
    listUnder(prefix: string) {
      return [...existing].filter((p) => p.startsWith(prefix)).sort();
    },
    failNextBulkWriterClose(error: Error) {
      pendingCloseFailure = error;
    },
  };
}
