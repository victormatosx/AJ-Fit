/**
 * Minimal in-memory fake for account-deletion resource tests. Transaction
 * callbacks are serialized by the JavaScript turn; the Firestore Emulator
 * suite proves real contention semantics.
 */

export interface FakeSnapshot {
  exists: boolean;
  ref: FakeDocRef;
  data(): Record<string, unknown> | undefined;
}
export interface FakeDocRef {
  path: string;
  id: string;
  get(): Promise<FakeSnapshot>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}

interface FakeSnapshotDoc extends FakeSnapshot {
  id: string;
  data(): Record<string, unknown>;
}

interface FakeQuery {
  get(): Promise<{ empty: boolean; size: number; docs: FakeSnapshotDoc[] }>;
  orderBy(field: string): FakeQuery;
  limit(n: number): FakeQuery;
  startAfter(doc: FakeSnapshotDoc): FakeQuery;
  where(field: string, operator: '==' | '<=', value: unknown): FakeQuery;
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

interface FakeTransaction {
  get(ref: FakeDocRef): Promise<FakeSnapshot>;
  set(ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void;
  delete(ref: FakeDocRef): void;
  update(ref: FakeDocRef, data: Record<string, unknown>): void;
}

export interface FakeFirestore {
  collection(name: string): FakeCollectionRef;
  bulkWriter(): FakeBulkWriter;
  recursiveDelete(ref: FakeDocRef): Promise<void>;
  runTransaction<T>(operation: (transaction: FakeTransaction) => Promise<T>): Promise<T>;
}

export interface FakeFirestoreHarness {
  db: FakeFirestore;
  seed(path: string, data?: Record<string, unknown>): void;
  exists(path: string): boolean;
  data(path: string): Record<string, unknown> | undefined;
  listUnder(prefix: string): string[];
  failNextBulkWriterClose(error: Error): void;
}

export function createFakeFirestore(): FakeFirestoreHarness {
  const existing = new Set<string>();
  const documents = new Map<string, Record<string, unknown>>();
  let pendingCloseFailure: Error | null = null;

  function write(path: string, data: Record<string, unknown>, merge = false) {
    existing.add(path);
    documents.set(path, merge ? { ...documents.get(path), ...data } : { ...data });
  }

  function remove(path: string) {
    existing.delete(path);
    documents.delete(path);
  }

  function snapshot(path: string): FakeSnapshot {
    return {
      exists: existing.has(path),
      ref: docRef(path),
      data: () => documents.get(path),
    };
  }

  function docRef(path: string): FakeDocRef {
    return {
      path,
      id: path.split('/').pop() as string,
      async get() {
        return snapshot(path);
      },
      async set(data, options) {
        write(path, data, options?.merge === true);
      },
      async delete() {
        remove(path);
      },
      collection(name: string) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(path: string): FakeCollectionRef {
    function buildQuery(state: {
      limit?: number;
      startAfterId?: string;
      filters: Array<{ field: string; operator: '==' | '<='; value: unknown }>;
    }): FakeQuery {
      return {
        orderBy() {
          return buildQuery(state);
        },
        limit(n) {
          return buildQuery({ ...state, limit: n });
        },
        startAfter(document) {
          return buildQuery({ ...state, startAfterId: document.id });
        },
        where(field, operator, value) {
          return buildQuery({
            ...state,
            filters: [...state.filters, { field, operator, value }],
          });
        },
        async get() {
          const prefix = `${path}/`;
          let ids = [...existing]
            .filter((candidate) =>
              candidate.startsWith(prefix) &&
              !candidate.slice(prefix.length).includes('/') &&
              state.filters.every(({ field, operator, value }) => {
                const actual = documents.get(candidate)?.[field];
                if (operator === '==') return actual === value;
                const comparable = (item: unknown) => typeof item === 'object'
                  && item !== null
                  && 'toMillis' in item
                  && typeof (item as { toMillis?: unknown }).toMillis === 'function'
                  ? (item as { toMillis(): number }).toMillis()
                  : item;
                return (comparable(actual) as number) <= (comparable(value) as number);
              }),
            )
            .map((candidate) => candidate.slice(prefix.length))
            .sort();

          if (state.startAfterId) {
            const index = ids.indexOf(state.startAfterId);
            ids = index >= 0 ? ids.slice(index + 1) : ids;
          }
          if (state.limit !== undefined) ids = ids.slice(0, state.limit);

          const docs: FakeSnapshotDoc[] = ids.map((id) => {
            const pathForDocument = `${path}/${id}`;
            return {
              id,
              exists: true,
              ref: docRef(pathForDocument),
              data: () => documents.get(pathForDocument) ?? {},
            };
          });
          return { empty: docs.length === 0, size: docs.length, docs };
        },
      };
    }

    return {
      path,
      firestore: db,
      doc(id) {
        return docRef(`${path}/${id}`);
      },
      ...buildQuery({ filters: [] }),
    };
  }

  const db: FakeFirestore = {
    collection(name) {
      return collectionRef(name);
    },
    bulkWriter() {
      const pending: FakeDocRef[] = [];
      return {
        delete(ref) {
          pending.push(ref);
        },
        async close() {
          if (pendingCloseFailure) {
            const error = pendingCloseFailure;
            pendingCloseFailure = null;
            throw error;
          }
          pending.forEach((ref) => remove(ref.path));
        },
      };
    },
    async recursiveDelete(ref) {
      [...existing]
        .filter((path) => path === ref.path || path.startsWith(`${ref.path}/`))
        .forEach(remove);
    },
    async runTransaction(operation) {
      const writes: Array<() => void> = [];
      const result = await operation({
        get: async (ref) => snapshot(ref.path),
        set: (ref, data, options) => {
          writes.push(() => write(ref.path, data, options?.merge === true));
        },
        delete: (ref) => {
          writes.push(() => remove(ref.path));
        },
        update: (ref, data) => {
          writes.push(() => write(ref.path, data, true));
        },
      });
      writes.forEach((commit) => commit());
      return result;
    },
  };

  return {
    db,
    seed(path, data = {}) {
      write(path, data);
    },
    exists(path) {
      return existing.has(path);
    },
    data(path) {
      return documents.get(path);
    },
    listUnder(prefix) {
      return [...existing].filter((path) => path.startsWith(prefix)).sort();
    },
    failNextBulkWriterClose(error) {
      pendingCloseFailure = error;
    },
  };
}
