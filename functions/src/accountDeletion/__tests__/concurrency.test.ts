import { describe, expect, it } from 'vitest';

import {
  acquireLease,
  canAcquireLease,
  compareAndSet,
  isLeaseActive,
  isLeaseOwnedBy,
  lockDocumentAfterCreate,
  lockDocumentAfterStatusChange,
  resolveDeletionRequest,
} from '../concurrency';
import type { AccountDeletionLockDocument } from '../types';

describe('resolveDeletionRequest — duplicate logical request', () => {
  it('creates a new deletion when no lock exists for the uid', () => {
    const result = resolveDeletionRequest({ existingLock: null, newDeletionId: 'del-a' });
    expect(result).toEqual({ kind: 'CREATED', deletionId: 'del-a' });
  });

  it('two near-simultaneous requests for the same uid resolve to ONE active deletionId', () => {
    // Request #1 creates the lock.
    const first = resolveDeletionRequest({ existingLock: null, newDeletionId: 'del-a' });
    expect(first.kind).toBe('CREATED');
    const lock = lockDocumentAfterCreate('uid-1', first.deletionId);

    // Request #2 arrives (already sees the lock a transaction created for #1)
    // and must reuse the same deletionId, never mint 'del-b'.
    const second = resolveDeletionRequest({ existingLock: lock, newDeletionId: 'del-b' });
    expect(second).toEqual({ kind: 'REUSED_EXISTING', deletionId: 'del-a' });
  });

  it('reuses the existing id while PROCESSING or RETRY_SCHEDULED', () => {
    for (const status of ['REQUESTED', 'PROCESSING', 'RETRY_SCHEDULED'] as const) {
      const lock: AccountDeletionLockDocument = { uid: 'uid-1', activeDeletionId: 'del-a', status, revision: 0 };
      expect(resolveDeletionRequest({ existingLock: lock, newDeletionId: 'del-b' })).toEqual({
        kind: 'REUSED_EXISTING',
        deletionId: 'del-a',
      });
    }
  });

  it('reuses (does not recreate) once already COMPLETED', () => {
    const lock: AccountDeletionLockDocument = { uid: 'uid-1', activeDeletionId: 'del-a', status: 'COMPLETED', revision: 3 };
    expect(resolveDeletionRequest({ existingLock: lock, newDeletionId: 'del-b' })).toEqual({
      kind: 'REUSED_EXISTING',
      deletionId: 'del-a',
    });
  });

  it('blocks a new deletion after a prior FAILED_TERMINAL outcome, pending reconciliation', () => {
    const lock: AccountDeletionLockDocument = { uid: 'uid-1', activeDeletionId: 'del-a', status: 'FAILED_TERMINAL', revision: 5 };
    expect(resolveDeletionRequest({ existingLock: lock, newDeletionId: 'del-b' })).toEqual({
      kind: 'BLOCKED_TERMINAL_FAILURE',
      deletionId: 'del-a',
    });
  });

  it('lockDocumentAfterStatusChange increments revision on every status change', () => {
    const lock = lockDocumentAfterCreate('uid-1', 'del-a');
    expect(lock.revision).toBe(0);
    const next = lockDocumentAfterStatusChange(lock, 'PROCESSING');
    expect(next.revision).toBe(1);
    expect(next.status).toBe('PROCESSING');
  });
});

describe('compareAndSet — two workers racing on the same record', () => {
  interface Counter {
    revision: number;
    value: number;
  }

  it('accepts a write when the expected revision matches current', () => {
    const current: Counter = { revision: 5, value: 10 };
    const result = compareAndSet(current, 5, (c) => ({ value: c.value + 1 }));
    expect(result).toEqual({ ok: true, value: { revision: 6, value: 11 } });
  });

  it('rejects worker B writing against a stale revision after worker A already advanced it', () => {
    // Both workers read revision 5.
    const readByA: Counter = { revision: 5, value: 10 };
    const readByB: Counter = { revision: 5, value: 10 };

    // Worker A wins the race and writes revision 6.
    const afterA = compareAndSet(readByA, 5, (c) => ({ value: c.value + 1 }));
    expect(afterA.ok).toBe(true);
    const stored = afterA.ok ? afterA.value : readByA;
    expect(stored.revision).toBe(6);

    // Worker B still believes revision is 5 and tries to write against the
    // NOW-STALE current state it read earlier — must be rejected, not silently
    // overwrite A's write.
    const afterB = compareAndSet(stored, readByB.revision, (c) => ({ value: c.value + 100 }));
    expect(afterB).toEqual({ ok: false, reason: 'REVISION_MISMATCH', currentRevision: 6 });
  });

  it('never lets revision regress: every accepted write increments by exactly 1', () => {
    let counter: Counter = { revision: 0, value: 0 };
    for (let i = 0; i < 5; i++) {
      const result = compareAndSet(counter, counter.revision, (c) => ({ value: c.value + 1 }));
      expect(result.ok).toBe(true);
      if (result.ok) counter = result.value;
    }
    expect(counter.revision).toBe(5);
    expect(counter.value).toBe(5);
  });
});

describe('lease helpers', () => {
  it('a lease is active only strictly before its expiry', () => {
    expect(isLeaseActive({ ownerId: 'w1', expiresAt: 1000 }, 999)).toBe(true);
    expect(isLeaseActive({ ownerId: 'w1', expiresAt: 1000 }, 1000)).toBe(false);
    expect(isLeaseActive(null, 999)).toBe(false);
  });

  it('a second worker cannot acquire an active lease', () => {
    const holder = { lease: acquireLease('worker-A', 0, 5000) };
    expect(canAcquireLease(holder, 100)).toBe(false);
    expect(canAcquireLease(holder, 5000)).toBe(true); // expired
  });

  it('only the current owner is recognized as holding an active lease', () => {
    const lease = acquireLease('worker-A', 0, 5000);
    expect(isLeaseOwnedBy(lease, 'worker-A', 100)).toBe(true);
    expect(isLeaseOwnedBy(lease, 'worker-B', 100)).toBe(false);
    expect(isLeaseOwnedBy(lease, 'worker-A', 5000)).toBe(false); // expired
  });
});
