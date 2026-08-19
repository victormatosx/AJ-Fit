import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same fake-Firestore-transaction pattern as `../../__tests__/repository.test.ts`
 * (per-document version numbers, a real conflict-retry loop, reads yielding
 * to the event loop so concurrent transactions genuinely interleave) —
 * extended here with the minimal query surface (`where(...).limit(n).get()`)
 * this module's candidate query needs. Firestore Emulator/production
 * integration is proven separately by
 * `../../__tests__/accountDeletionReconciliation.integration.test.ts`.
 */
function fakeFirestore() {
  const docs = new Map<string, { data: Record<string, unknown>; version: number }>();

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

  function collectionRef(name: string) {
    return {
      doc: (id: string) => ({
        path: `${name}/${id}`,
        async get() {
          await microtask();
          return readSnapshot(`${name}/${id}`);
        },
        async set(data: unknown) {
          await microtask();
          docs.set(`${name}/${id}`, { data: structuredClone(data) as Record<string, unknown>, version: versionOf(`${name}/${id}`) + 1 });
        },
        async delete() {
          await microtask();
          docs.delete(`${name}/${id}`);
        },
      }),
      where(field: string, op: 'in', values: readonly string[]) {
        if (op !== 'in') throw new Error(`fake-firestore: unsupported operator ${op}`);
        return {
          limit(n: number) {
            return {
              async get() {
                await microtask();
                const matches = [...docs.entries()]
                  .filter(([path, entry]) => path.startsWith(`${name}/`) && values.includes(entry.data[field] as string))
                  .slice(0, n);
                return { docs: matches.map(([, entry]) => ({ data: () => structuredClone(entry.data) })) };
              },
            };
          },
        };
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
      docs.set(path, { data: structuredClone(data) as Record<string, unknown>, version: versionOf(path) + 1 });
    }

    return result;
  }

  return {
    docs,
    db: {
      collection: (name: string) => collectionRef(name),
      runTransaction,
    },
  };
}

const fake = vi.hoisted(() => fakeFirestore());
vi.mock('../../../lib/firebaseAdmin', () => ({ db: fake.db }));

import { createAccountDeletionRecord } from '../../record';
import { currentPolicy } from '../../policy';
import {
  effectiveNextAttemptAt,
  isRecordDueNow,
  persistAccountDeletionRecordChange,
  queryReconciliationCandidates,
  readAccountDeletionRecord,
  tryAcquireReconciliationLease,
} from '../recordAccess';
import type { AccountDeletionRecord } from '../../types';

const POLICY = currentPolicy();

function makeRecord(overrides: Partial<AccountDeletionRecord> = {}): AccountDeletionRecord {
  const base = createAccountDeletionRecord({
    deletionId: 'del-1',
    uid: 'uid-1',
    policy: POLICY,
    now: 1000,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    linkedProviders: [],
  });
  return { ...base, ...overrides };
}

async function seed(record: AccountDeletionRecord) {
  await fake.db.collection('accountDeletions').doc(record.deletionId).set(record);
}

async function seedLock(uid: string, activeDeletionId: string, status: AccountDeletionRecord['status']) {
  await fake.db.collection('accountDeletionLocks').doc(uid).set({ uid, activeDeletionId, status, revision: 0 });
}

beforeEach(() => {
  fake.docs.clear();
});

describe('readAccountDeletionRecord', () => {
  it('returns null when nothing exists — never invents a record', async () => {
    expect(await readAccountDeletionRecord('missing')).toBeNull();
  });

  it('returns the persisted record when it exists', async () => {
    await seed(makeRecord());
    const record = await readAccountDeletionRecord('del-1');
    expect(record?.uid).toBe('uid-1');
  });
});

describe('queryReconciliationCandidates', () => {
  it('returns REQUESTED/PROCESSING/RETRY_SCHEDULED but excludes COMPLETED/FAILED_TERMINAL', async () => {
    await seed(makeRecord({ deletionId: 'del-requested', status: 'REQUESTED' }));
    await seed(makeRecord({ deletionId: 'del-processing', status: 'PROCESSING' }));
    await seed(makeRecord({ deletionId: 'del-retry', status: 'RETRY_SCHEDULED' }));
    await seed(makeRecord({ deletionId: 'del-completed', status: 'COMPLETED', completedAt: 2000 }));
    await seed(makeRecord({ deletionId: 'del-terminal', status: 'FAILED_TERMINAL' }));

    const candidates = await queryReconciliationCandidates(10);
    const ids = candidates.map((c) => c.deletionId).sort();
    expect(ids).toEqual(['del-processing', 'del-requested', 'del-retry']);
  });

  it('never returns more than the bound', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seed(makeRecord({ deletionId: `del-${i}`, status: 'REQUESTED' }));
    }
    const candidates = await queryReconciliationCandidates(2);
    expect(candidates.length).toBe(2);
  });
});

describe('isRecordDueNow / effectiveNextAttemptAt', () => {
  it('REQUESTED and PROCESSING are always due, regardless of any step timing', () => {
    expect(isRecordDueNow(makeRecord({ status: 'REQUESTED' }), 999)).toBe(true);
    expect(isRecordDueNow(makeRecord({ status: 'PROCESSING' }), 999)).toBe(true);
  });

  it('RETRY_SCHEDULED with a future nextAttemptAt is NOT due yet', () => {
    const record = makeRecord({
      status: 'RETRY_SCHEDULED',
      steps: {
        ...makeRecord().steps,
        ACCOUNT_ACCESS_LOCK: {
          status: 'FAILED_RETRYABLE',
          attemptCount: 1,
          lastAttemptAt: 1000,
          nextAttemptAt: 5000,
          lastErrorCode: 'UNAVAILABLE',
          completedAt: null,
        },
      },
    });
    expect(effectiveNextAttemptAt(record)).toBe(5000);
    expect(isRecordDueNow(record, 1000)).toBe(false);
    expect(isRecordDueNow(record, 5000)).toBe(true);
  });
});

describe('persistAccountDeletionRecordChange', () => {
  it('applies the mutation and increments revision when the expected revision matches', async () => {
    const record = makeRecord();
    await seed(record);
    await seedLock('uid-1', 'del-1', 'REQUESTED');

    const result = await persistAccountDeletionRecordChange('del-1', 0, (current) => ({
      ...current,
      status: 'PROCESSING',
      updatedAt: 2000,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revision).toBe(1);
      expect(result.value.status).toBe('PROCESSING');
    }
  });

  it('mirrors a changed global status onto the lock document (Fase 1 lockDocumentAfterStatusChange, first real caller)', async () => {
    await seed(makeRecord());
    await seedLock('uid-1', 'del-1', 'REQUESTED');

    await persistAccountDeletionRecordChange('del-1', 0, (current) => ({ ...current, status: 'PROCESSING' }));

    const lockSnap = await fake.db.collection('accountDeletionLocks').doc('uid-1').get();
    const lockData = lockSnap.data() as { status: string; revision: number };
    expect(lockData.status).toBe('PROCESSING');
    expect(lockData.revision).toBe(1);
  });

  it('rejects (never overwrites) when the expected revision is stale', async () => {
    await seed(makeRecord());

    const result = await persistAccountDeletionRecordChange('del-1', 5, (current) => ({
      ...current,
      status: 'PROCESSING',
    }));

    expect(result.ok).toBe(false);
    const stillPersisted = await readAccountDeletionRecord('del-1');
    expect(stillPersisted?.status).toBe('REQUESTED');
    expect(stillPersisted?.revision).toBe(0);
  });
});

describe('tryAcquireReconciliationLease', () => {
  it('acquires the lease and bumps revision when none is active', async () => {
    await seed(makeRecord());
    const result = await tryAcquireReconciliationLease('del-1', 'worker-A', 1000, 60_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.lease).toEqual({ ownerId: 'worker-A', expiresAt: 61_000 });
      expect(result.record.revision).toBe(1);
    }
  });

  it('refuses to acquire while another owner holds an active lease', async () => {
    await seed(makeRecord({ lease: { ownerId: 'worker-A', expiresAt: 10_000 } }));
    const result = await tryAcquireReconciliationLease('del-1', 'worker-B', 5000, 60_000);
    expect(result).toEqual({ ok: false, reason: 'LEASE_HELD' });
  });

  it('allows a second worker to acquire once the first lease has expired', async () => {
    await seed(makeRecord({ lease: { ownerId: 'worker-A', expiresAt: 1000 } }));
    const result = await tryAcquireReconciliationLease('del-1', 'worker-B', 1001, 60_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.lease?.ownerId).toBe('worker-B');
  });

  it('returns NOT_FOUND for a nonexistent record — never invents one', async () => {
    const result = await tryAcquireReconciliationLease('missing', 'worker-A', 1000, 60_000);
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
