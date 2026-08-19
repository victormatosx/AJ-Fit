import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A faithful-enough fake of Firestore's transaction semantics: per-document
 * version numbers, reads recorded per attempt, and a real conflict-retry
 * loop — NOT just a plain in-memory map. `tx.get` yields to the event loop
 * (via a macrotask) so that two `runTransaction` calls kicked off together
 * (`Promise.all`) genuinely INTERLEAVE their reads before either commits,
 * which is what makes the concurrency tests below meaningful rather than
 * accidentally-sequential. Firestore Emulator/production integration is
 * still a separate, unaddressed concern — see the Fase 4 report's "E2E
 * EMULATOR PENDENTE" note.
 */
function fakeFirestore() {
  const docs = new Map<string, { data: unknown; version: number }>();

  function versionOf(path: string): number {
    return docs.get(path)?.version ?? 0;
  }

  function readSnapshot(path: string) {
    const entry = docs.get(path);
    return {
      exists: entry !== undefined,
      data: () => (entry ? structuredClone(entry.data) : undefined),
    };
  }

  function microtask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function docRef(path: string) {
    return {
      path,
      async get() {
        await microtask();
        return readSnapshot(path);
      },
    };
  }

  async function runTransaction<T>(fn: (tx: unknown) => Promise<T>, attempt = 0): Promise<T> {
    const readVersions = new Map<string, number>();
    const pendingWrites = new Map<string, unknown>();

    const tx = {
      get: async (ref: { path: string }) => {
        await microtask();
        if (!readVersions.has(ref.path)) readVersions.set(ref.path, versionOf(ref.path));
        return readSnapshot(ref.path);
      },
      set: (ref: { path: string }, data: unknown) => {
        pendingWrites.set(ref.path, data);
      },
    };

    const result = await fn(tx);
    await microtask();

    for (const [path, versionAtRead] of readVersions) {
      if (versionOf(path) !== versionAtRead) {
        if (attempt >= 10) throw new Error('fake-firestore: too many transaction retries');
        return runTransaction(fn, attempt + 1);
      }
    }

    for (const [path, data] of pendingWrites) {
      docs.set(path, { data: structuredClone(data), version: versionOf(path) + 1 });
    }

    return result;
  }

  return {
    docs,
    db: {
      collection: (name: string) => ({
        doc: (id: string) => docRef(`${name}/${id}`),
      }),
      runTransaction,
    },
  };
}

const fake = vi.hoisted(() => fakeFirestore());
vi.mock('../../lib/firebaseAdmin', () => ({ db: fake.db }));

import { AccountDeletionRepositoryError, FirestoreAccountDeletionRepository } from '../repository';
import { currentPolicy } from '../policy';

const POLICY = currentPolicy();

function baseParams(overrides: Partial<Parameters<InstanceType<typeof FirestoreAccountDeletionRepository>['createOrReuse']>[0]> = {}) {
  return {
    uid: 'uid-1',
    candidateDeletionId: 'del-candidate-1',
    policy: POLICY,
    linkedProviders: [] as const,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    now: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  fake.docs.clear();
});

describe('FirestoreAccountDeletionRepository.createOrReuse — first call', () => {
  it('creates a new record and lock atomically', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const result = await repo.createOrReuse(baseParams());

    expect(result.deduplicated).toBe(false);
    expect(result.blockedTerminalFailure).toBe(false);
    expect(result.record.deletionId).toBe('del-candidate-1');
    expect(result.record.uid).toBe('uid-1');
    expect(result.record.status).toBe('REQUESTED');
    expect(fake.docs.has('accountDeletionLocks/uid-1')).toBe(true);
    expect(fake.docs.has('accountDeletions/del-candidate-1')).toBe(true);
  });

  it('freezes the provider snapshot server-side into the record', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const result = await repo.createOrReuse(
      baseParams({ linkedProviders: ['apple.com', 'google.com'] }),
    );
    expect(result.record.providerRevocation.apple.linked).toBe(true);
    expect(result.record.providerRevocation.google.linked).toBe(true);
    expect(result.record.providerRevocation.apple.step.status).toBe('PENDING');
  });
});

describe('FirestoreAccountDeletionRepository.createOrReuse — duplicate/idempotent calls', () => {
  it('sequential duplicate calls (§46, §57 lost-response-retry) return the SAME deletionId, never a second record', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const first = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-A' }));
    const second = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-B' }));
    const third = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-C' }));

    expect(first.record.deletionId).toBe('del-A');
    expect(second.record.deletionId).toBe('del-A');
    expect(third.record.deletionId).toBe('del-A');
    expect(second.deduplicated).toBe(true);
    expect(third.deduplicated).toBe(true);

    // Exactly one record document exists.
    const recordDocs = [...fake.docs.keys()].filter((k) => k.startsWith('accountDeletions/'));
    expect(recordDocs).toEqual(['accountDeletions/del-A']);
  });

  it('an empty valid payload (no fields) still works end to end through the repository boundary', async () => {
    // The repository itself has no payload concept — this documents that
    // nothing about createOrReuse depends on anything beyond uid/policy/
    // providers/metadata, consistent with the handler's closed contract.
    const repo = new FirestoreAccountDeletionRepository();
    await expect(repo.createOrReuse(baseParams())).resolves.toMatchObject({ deduplicated: false });
  });
});

describe('FirestoreAccountDeletionRepository.createOrReuse — real concurrency', () => {
  it('two near-simultaneous requests for the SAME uid converge on ONE deletionId (Fase 4 §14)', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const [a, b] = await Promise.all([
      repo.createOrReuse(baseParams({ candidateDeletionId: 'del-from-A' })),
      repo.createOrReuse(baseParams({ candidateDeletionId: 'del-from-B' })),
    ]);

    expect(a.record.deletionId).toBe(b.record.deletionId);
    // Exactly one of the two calls actually created the record.
    expect([a.deduplicated, b.deduplicated].filter((d) => d === false)).toHaveLength(1);

    const recordDocs = [...fake.docs.keys()].filter((k) => k.startsWith('accountDeletions/'));
    expect(recordDocs).toHaveLength(1);
  });

  it('two DIFFERENT uids racing concurrently never interfere with each other', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const [a, b] = await Promise.all([
      repo.createOrReuse(baseParams({ uid: 'uid-A', candidateDeletionId: 'del-A' })),
      repo.createOrReuse(baseParams({ uid: 'uid-B', candidateDeletionId: 'del-B' })),
    ]);

    expect(a.record.uid).toBe('uid-A');
    expect(b.record.uid).toBe('uid-B');
    expect(a.record.deletionId).not.toBe(b.record.deletionId);
    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(false);
  });

  it('five simultaneous requests for the same uid all converge on one operation', async () => {
    const repo = new FirestoreAccountDeletionRepository();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        repo.createOrReuse(baseParams({ candidateDeletionId: `del-${i}` })),
      ),
    );
    const ids = new Set(results.map((r) => r.record.deletionId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
  });
});

describe('FirestoreAccountDeletionRepository.createOrReuse — existing operation states', () => {
  async function seedLockAndRecord(status: 'REQUESTED' | 'PROCESSING' | 'RETRY_SCHEDULED' | 'COMPLETED' | 'FAILED_TERMINAL') {
    const repo = new FirestoreAccountDeletionRepository();
    const created = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-existing' }));
    // Directly mutate the fake store to simulate a workflow that has since
    // progressed — repository.createOrReuse itself never advances status;
    // that's the (not-yet-built) worker's job.
    const lockPath = 'accountDeletionLocks/uid-1';
    const recordPath = 'accountDeletions/del-existing';
    const lock = fake.docs.get(lockPath)!;
    fake.docs.set(lockPath, { data: { ...(lock.data as object), status }, version: lock.version + 1 });
    const record = fake.docs.get(recordPath)!;
    fake.docs.set(recordPath, { data: { ...(record.data as object), status }, version: record.version + 1 });
    return created;
  }

  it.each(['REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED'] as const)(
    'a new call while status=%s reuses the existing operation, never creating a second one',
    async (status) => {
      await seedLockAndRecord(status);
      const repo = new FirestoreAccountDeletionRepository();
      const result = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-new-attempt' }));
      expect(result.deduplicated).toBe(true);
      expect(result.record.deletionId).toBe('del-existing');
      expect(result.blockedTerminalFailure).toBe(false);
    },
  );

  it('COMPLETED is reused as logical success — no new operation, no error', async () => {
    await seedLockAndRecord('COMPLETED');
    const repo = new FirestoreAccountDeletionRepository();
    const result = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-new-attempt' }));
    expect(result.deduplicated).toBe(true);
    expect(result.blockedTerminalFailure).toBe(false);
    expect(result.record.status).toBe('COMPLETED');
  });

  it('FAILED_TERMINAL blocks a new operation and is flagged for reconciliation, never silently retried', async () => {
    await seedLockAndRecord('FAILED_TERMINAL');
    const repo = new FirestoreAccountDeletionRepository();
    const result = await repo.createOrReuse(baseParams({ candidateDeletionId: 'del-new-attempt' }));
    expect(result.blockedTerminalFailure).toBe(true);
    expect(result.record.deletionId).toBe('del-existing');
    expect(result.record.status).toBe('FAILED_TERMINAL');

    const recordDocs = [...fake.docs.keys()].filter((k) => k.startsWith('accountDeletions/'));
    expect(recordDocs).toEqual(['accountDeletions/del-existing']); // no second record created
  });
});

describe('FirestoreAccountDeletionRepository.createOrReuse — corrupted data', () => {
  it('throws AccountDeletionRepositoryError when the lock document is malformed', async () => {
    fake.docs.set('accountDeletionLocks/uid-1', { data: { garbage: true }, version: 1 });
    const repo = new FirestoreAccountDeletionRepository();
    await expect(repo.createOrReuse(baseParams())).rejects.toBeInstanceOf(AccountDeletionRepositoryError);
  });

  it('throws AccountDeletionRepositoryError when the lock points to a record that does not exist', async () => {
    fake.docs.set('accountDeletionLocks/uid-1', {
      data: { uid: 'uid-1', activeDeletionId: 'del-ghost', status: 'REQUESTED', revision: 0 },
      version: 1,
    });
    const repo = new FirestoreAccountDeletionRepository();
    await expect(repo.createOrReuse(baseParams())).rejects.toBeInstanceOf(AccountDeletionRepositoryError);
  });

  it('throws AccountDeletionRepositoryError when the referenced record is malformed', async () => {
    fake.docs.set('accountDeletionLocks/uid-1', {
      data: { uid: 'uid-1', activeDeletionId: 'del-broken', status: 'REQUESTED', revision: 0 },
      version: 1,
    });
    fake.docs.set('accountDeletions/del-broken', { data: { garbage: true }, version: 1 });
    const repo = new FirestoreAccountDeletionRepository();
    await expect(repo.createOrReuse(baseParams())).rejects.toBeInstanceOf(AccountDeletionRepositoryError);
  });
});
