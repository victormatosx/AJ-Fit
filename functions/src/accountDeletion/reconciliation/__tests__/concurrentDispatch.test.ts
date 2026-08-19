import { afterEach, expect, it, vi } from 'vitest';

/**
 * Fase 15: proves the property immediate-dispatch and the 15-minute
 * scheduler now both depend on — two independent callers
 * (`onAccountDeletionRequested`'s trigger and `cleanupPendingAccountDeletions`'s
 * batch) racing `processAccountDeletionRecord` against the SAME `deletionId`
 * must never both make progress on the same step.
 *
 * `recordAccess.ts`/`dispatcher.ts` are mocked, but the LEASE decision
 * itself is backed by the REAL, already-unit-tested pure primitives from
 * `../../concurrency.ts` (`canAcquireLease`/`acquireLease`) rather than a
 * second hand-rolled "is it locked" check — this test would be worthless if
 * it re-implemented the exact logic it's trying to verify.
 */
const readAccountDeletionRecord = vi.hoisted(() => vi.fn());
const isRecordDueNow = vi.hoisted(() => vi.fn());
const persistAccountDeletionRecordChange = vi.hoisted(() => vi.fn());
const tryAcquireReconciliationLease = vi.hoisted(() => vi.fn());
const runTopLevelStep = vi.hoisted(() => vi.fn());
const runProviderSubStep = vi.hoisted(() => vi.fn());

vi.mock('../recordAccess', () => ({
  readAccountDeletionRecord,
  isRecordDueNow,
  persistAccountDeletionRecordChange,
  tryAcquireReconciliationLease,
  effectiveNextAttemptAt: vi.fn(),
}));
vi.mock('../dispatcher', () => ({ runTopLevelStep, runProviderSubStep }));
vi.mock('../../../lib/firebaseAdmin', () => ({
  db: { collection: () => ({ doc: () => ({ set: vi.fn().mockResolvedValue(undefined) }) }) },
}));

import { createAccountDeletionRecord } from '../../record';
import { currentPolicy } from '../../policy';
import { canAcquireLease, acquireLease, compareAndSet } from '../../concurrency';
import { processAccountDeletionRecord } from '../processRecord';
import type { AccountDeletionRecord } from '../../types';

afterEach(() => {
  vi.clearAllMocks();
});

it('immediate dispatch racing the scheduler on the same deletionId: exactly one caller advances the step, the other observes LEASE_HELD', async () => {
  const POLICY = currentPolicy();
  let stored: AccountDeletionRecord = createAccountDeletionRecord({
    deletionId: 'del-race',
    uid: 'uid-race',
    policy: POLICY,
    now: 1000,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    linkedProviders: [],
  });

  readAccountDeletionRecord.mockImplementation(async () => stored);
  isRecordDueNow.mockReturnValue(true);
  runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' });

  // Real lease primitives (`../../concurrency.ts`, unchanged) — the SAME
  // check `recordAccess.ts`'s real `tryAcquireReconciliationLease` performs
  // inside a Firestore transaction, here run synchronously against the
  // shared in-memory `stored` to make the race deterministic and assertable.
  tryAcquireReconciliationLease.mockImplementation(async (_id: string, ownerId: string, now: number) => {
    if (!canAcquireLease(stored, now)) return { ok: false, reason: 'LEASE_HELD' };
    const result = compareAndSet(stored, stored.revision, (c) => ({
      ...c,
      lease: acquireLease(ownerId, now, 60_000),
    }));
    if (!result.ok) return { ok: false, reason: 'LEASE_HELD' };
    stored = result.value;
    return { ok: true, record: stored };
  });

  persistAccountDeletionRecordChange.mockImplementation(
    async (_id: string, expectedRevision: number, mutate: (c: AccountDeletionRecord) => Omit<AccountDeletionRecord, 'revision'>) => {
      if (stored.revision !== expectedRevision) {
        return { ok: false, reason: 'REVISION_MISMATCH', currentRevision: stored.revision };
      }
      const mutated = mutate(stored);
      stored = { ...mutated, revision: stored.revision + 1 } as AccountDeletionRecord;
      return { ok: true, value: stored };
    },
  );

  // "Immediate" (trigger) and "scheduler" callers race for the SAME
  // deletionId, same instant, different ownerIds — exactly the Fase 15
  // scenario (trigger fires the moment the record commits; the scheduler's
  // batch may independently pick it up in the same window).
  const [immediateOutcome, schedulerOutcome] = await Promise.all([
    processAccountDeletionRecord('del-race', { ownerId: 'immediate-1', now: 1000, maxStepsPerInvocation: 1 }),
    processAccountDeletionRecord('del-race', { ownerId: 'scheduler-1', now: 1000, maxStepsPerInvocation: 1 }),
  ]);

  const outcomes = [immediateOutcome, schedulerOutcome];
  const progressed = outcomes.filter((o) => o.kind === 'PROGRESSED');
  const leaseHeld = outcomes.filter((o) => o.kind === 'LEASE_HELD');

  // Exactly one caller made progress; the other backed off cleanly — never
  // both, never neither, never a double-executed step.
  expect(progressed).toHaveLength(1);
  expect(leaseHeld).toHaveLength(1);
  expect(runTopLevelStep).toHaveBeenCalledTimes(1);
  expect(stored.lease).toBeNull(); // released by persistAccountDeletionRecordChange's checkpoint
});
