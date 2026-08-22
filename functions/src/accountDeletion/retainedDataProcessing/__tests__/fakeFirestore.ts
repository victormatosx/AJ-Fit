/**
 * Minimal in-memory fake of the slice of the Firestore Admin SDK this
 * module actually uses: `collection().where().orderBy().limit()
 * .startAfter().get()`, `doc().get()/.delete()`, nested `collection()`
 * under a doc, and `firestore.bulkWriter()`. Unlike Fase 6's
 * `firestoreCleanup/__tests__/fakeFirestore.ts`, documents here carry real
 * field data — `supportTickets` ownership is a `where('userId', '==', uid)`
 * query, not a path-prefix scan.
 */

export interface FakeDocRef {
  path: string;
  id: string;
  get(): Promise<{ exists: boolean; id: string; data(): Record<string, unknown> | undefined }>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}

interface FakeSnapshotDoc {
  id: string;
  ref: FakeDocRef;
}

interface FakeQuery {
  get(): Promise<{ empty: boolean; size: number; docs: FakeSnapshotDoc[] }>;
  where(field: string, op: '==', value: unknown): FakeQuery;
  orderBy(field: string): FakeQuery;
  limit(n: number): FakeQuery;
  startAfter(id: string): FakeQuery;
}

export interface FakeCollectionRef extends FakeQuery {
  path: string;
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
  /** Seeds a document with field data at an explicit path, e.g. `seed('supportTickets/t1', {userId:'uid-1'})`. */
  seed(path: string, data: Record<string, unknown>): void;
  exists(path: string): boolean;
  listUnder(prefix: string): string[];
  failNextBulkWriterClose(error: Error): void;
  failNextGet(error: Error): void;
}

export function createFakeFirestore(): FakeFirestoreHarness {
  const existing = new Map<string, Record<string, unknown>>();
  let pendingCloseFailure: Error | null = null;
  let pendingGetFailure: Error | null = null;

  function docRef(path: string): FakeDocRef {
    return {
      path,
      id: path.split('/').pop() as string,
      async get() {
        return { exists: existing.has(path), id: path.split('/').pop() as string, data: () => existing.get(path) };
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
    function buildQuery(state: {
      whereField?: string;
      whereValue?: unknown;
      limit?: number;
      startAfterId?: string;
    }): FakeQuery {
      return {
        where(field: string, _op: '==', value: unknown) {
          return buildQuery({ ...state, whereField: field, whereValue: value });
        },
        orderBy() {
          return buildQuery(state);
        },
        limit(n: number) {
          return buildQuery({ ...state, limit: n });
        },
        startAfter(id: string) {
          return buildQuery({ ...state, startAfterId: id });
        },
        async get() {
          if (pendingGetFailure) {
            const error = pendingGetFailure;
            pendingGetFailure = null;
            throw error;
          }

          const prefix = `${path}/`;
          let ids = [...existing.keys()]
            .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
            .map((p) => p.slice(prefix.length))
            .sort();

          if (state.whereField) {
            ids = ids.filter((id) => existing.get(`${path}/${id}`)?.[state.whereField as string] === state.whereValue);
          }
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
    seed(path: string, data: Record<string, unknown>) {
      existing.set(path, data);
    },
    exists(path: string) {
      return existing.has(path);
    },
    listUnder(prefix: string) {
      return [...existing.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
    failNextBulkWriterClose(error: Error) {
      pendingCloseFailure = error;
    },
    failNextGet(error: Error) {
      pendingGetFailure = error;
    },
  };
}
