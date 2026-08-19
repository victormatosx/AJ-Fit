/**
 * A minimal in-memory Firestore that models the parts the recovery repository
 * actually depends on: document reads, `Transaction.create`'s must-not-exist
 * precondition, and optimistic-concurrency abort/retry.
 *
 * WHY A FAKE RATHER THAN THE EMULATOR
 * -----------------------------------
 * The concurrency requirements are about INTERLEAVING: two generations racing
 * for one uid, a writer committing between another transaction's read and its
 * commit, a selector taken in that same window. Against the real emulator
 * those orderings are timing-dependent and therefore flaky; here they are
 * scheduled explicitly via `onBeforeCommit`, so a test either proves the
 * invariant deterministically or fails every time.
 *
 * The Firestore rules for `_mfaRecovery` are separately verified against the
 * real emulator in `firestore-tests/mfaRecovery.rules.test.ts` — this fake
 * never stands in for that.
 *
 * Semantics modelled, matching Firestore:
 *   - all reads in a transaction must precede its writes (not enforced here,
 *     but the repository is written that way);
 *   - `create` fails the COMMIT with gRPC code 6 (ALREADY_EXISTS) if the
 *     document exists — it does not throw when staged;
 *   - if any document read during the transaction changed before commit, the
 *     whole callback is retried against fresh data.
 */

export const FIRESTORE_ALREADY_EXISTS = 6;

interface StoredDoc {
  data: Record<string, unknown>;
  version: number;
}

interface DocRef {
  readonly key: string;
}

interface Snapshot {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

type StagedWrite =
  | { kind: 'create'; key: string; data: Record<string, unknown> }
  | { kind: 'update'; key: string; patch: Record<string, unknown> }
  | { kind: 'set'; key: string; data: Record<string, unknown> };

export interface FakeFirestoreOptions {
  /**
   * Called just before each commit attempt, with the attempt number (1-based).
   * Mutate the store here to simulate another writer winning the race.
   */
  onBeforeCommit?: (attempt: number, store: Map<string, StoredDoc>) => void;
  /** Transaction retry budget, mirroring Firestore's own bounded retries. */
  maxAttempts?: number;
}

export class TransactionAbortedError extends Error {
  constructor() {
    super('TRANSACTION_ABORTED');
    this.name = 'TransactionAbortedError';
  }
}

export function createFakeFirestore(options: FakeFirestoreOptions = {}) {
  const store = new Map<string, StoredDoc>();
  const maxAttempts = options.maxAttempts ?? 5;

  let commitAttempts = 0;

  function snapshotOf(key: string): Snapshot {
    const stored = store.get(key);
    return {
      exists: stored !== undefined,
      // Returned by value so a caller mutating the result cannot reach into
      // the store, exactly like the real client.
      data: () => (stored ? { ...stored.data } : undefined),
    };
  }

  function docRef(collection: string, id: string): DocRef & { get: () => Promise<Snapshot> } {
    const key = `${collection}/${id}`;
    return { key, get: async () => snapshotOf(key) };
  }

  const db = {
    collection(collection: string) {
      return { doc: (id: string) => docRef(collection, id) };
    },

    async runTransaction<T>(
      callback: (transaction: {
        get: (ref: DocRef) => Promise<Snapshot>;
        create: (ref: DocRef, data: Record<string, unknown>) => void;
        update: (ref: DocRef, patch: Record<string, unknown>) => void;
        set: (ref: DocRef, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ): Promise<T> {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const readVersions = new Map<string, number>();
        const writes: StagedWrite[] = [];

        const transaction = {
          get: async (ref: DocRef) => {
            readVersions.set(ref.key, store.get(ref.key)?.version ?? -1);
            return snapshotOf(ref.key);
          },
          create: (ref: DocRef, data: Record<string, unknown>) => {
            writes.push({ kind: 'create', key: ref.key, data });
          },
          update: (ref: DocRef, patch: Record<string, unknown>) => {
            writes.push({ kind: 'update', key: ref.key, patch });
          },
          set: (ref: DocRef, data: Record<string, unknown>) => {
            writes.push({ kind: 'set', key: ref.key, data });
          },
        };

        const result = await callback(transaction);

        commitAttempts += 1;
        options.onBeforeCommit?.(attempt, store);

        // Optimistic concurrency: anything we read must be unchanged.
        const stale = [...readVersions].some(
          ([key, version]) => (store.get(key)?.version ?? -1) !== version,
        );
        if (stale) {
          if (attempt === maxAttempts) {
            throw new TransactionAbortedError();
          }
          continue;
        }

        // `create` preconditions are evaluated at commit, like Firestore.
        for (const write of writes) {
          if (write.kind === 'create' && store.has(write.key)) {
            throw Object.assign(new Error('ALREADY_EXISTS'), {
              code: FIRESTORE_ALREADY_EXISTS,
            });
          }
        }

        for (const write of writes) {
          const previous = store.get(write.key);
          const nextVersion = (previous?.version ?? 0) + 1;

          if (write.kind === 'update') {
            store.set(write.key, {
              data: { ...(previous?.data ?? {}), ...write.patch },
              version: nextVersion,
            });
          } else {
            store.set(write.key, { data: { ...write.data }, version: nextVersion });
          }
        }

        return result;
      }

      throw new TransactionAbortedError();
    },
  };

  return {
    db,
    store,
    /** Raw document contents, or undefined. */
    read: (collection: string, id: string) => store.get(`${collection}/${id}`)?.data,
    /** Seeds a document without going through a transaction. */
    seed: (collection: string, id: string, data: Record<string, unknown>) => {
      store.set(`${collection}/${id}`, { data, version: 1 });
    },
    /** How many commit attempts were made across all transactions. */
    commitAttempts: () => commitAttempts,
  };
}
