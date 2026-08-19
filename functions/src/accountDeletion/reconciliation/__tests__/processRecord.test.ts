import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit-level: `recordAccess.ts` (already proven against a fake Firestore in
 * `recordAccess.test.ts`) and `dispatcher.ts` (already proven in
 * `dispatcher.test.ts`) are both mocked here so these tests isolate exactly
 * what `processAccountDeletionRecord` itself is responsible for: choosing
 * what to do next, applying the REAL state-machine transitions, and
 * checkpointing. No real sleep is ever used to prove retry timing — `now` is
 * always an explicit injected number.
 */
const readAccountDeletionRecord = vi.hoisted(() => vi.fn());
const queryReconciliationCandidates = vi.hoisted(() => vi.fn());
const isRecordDueNow = vi.hoisted(() => vi.fn());
const effectiveNextAttemptAt = vi.hoisted(() => vi.fn());
const persistAccountDeletionRecordChange = vi.hoisted(() => vi.fn());
const tryAcquireReconciliationLease = vi.hoisted(() => vi.fn());
const runTopLevelStep = vi.hoisted(() => vi.fn());
const runProviderSubStep = vi.hoisted(() => vi.fn());

vi.mock('../recordAccess', () => ({
  readAccountDeletionRecord,
  queryReconciliationCandidates,
  isRecordDueNow,
  effectiveNextAttemptAt,
  persistAccountDeletionRecordChange,
  tryAcquireReconciliationLease,
}));
vi.mock('../dispatcher', () => ({ runTopLevelStep, runProviderSubStep }));

// `finalizeCompletedRecord`'s best-effort minimization write goes through
// the real `db` singleton — faked here so COMPLETED tests never attempt a
// real network call. A rejection here must never fail the overall outcome
// (see `processRecord.ts`'s doc comment on this being best-effort).
vi.mock('../../../lib/firebaseAdmin', () => ({
  db: { collection: () => ({ doc: () => ({ set: vi.fn().mockResolvedValue(undefined) }) }) },
}));

import { createAccountDeletionRecord } from '../../record';
import { currentPolicy } from '../../policy';
import { processAccountDeletionRecord } from '../processRecord';
import type { AccountDeletionRecord } from '../../types';

const POLICY = currentPolicy();

function baseRecord(overrides: Partial<AccountDeletionRecord> = {}): AccountDeletionRecord {
  const record = createAccountDeletionRecord({
    deletionId: 'del-1',
    uid: 'uid-1',
    policy: POLICY,
    now: 1000,
    requestMetadata: { subscriptionActiveAtRequest: null, requestAuthTimeSeconds: 0 },
    linkedProviders: [],
  });
  return { ...record, ...overrides };
}

/** Wires the mocks so the record is durably "persisted" in a plain in-memory map for this one test's use. */
function wireHappyPathPersistence(initial: AccountDeletionRecord) {
  let stored = initial;
  readAccountDeletionRecord.mockImplementation(async () => stored);
  isRecordDueNow.mockReturnValue(true);
  tryAcquireReconciliationLease.mockImplementation(async (_id: string, ownerId: string, now: number) => {
    stored = { ...stored, lease: { ownerId, expiresAt: now + 60_000 }, revision: stored.revision + 1 };
    return { ok: true, record: stored };
  });
  persistAccountDeletionRecordChange.mockImplementation(async (_id: string, expectedRevision: number, mutate: (c: AccountDeletionRecord) => Omit<AccountDeletionRecord, 'revision'>) => {
    if (stored.revision !== expectedRevision) return { ok: false, reason: 'REVISION_MISMATCH', currentRevision: stored.revision };
    const mutated = mutate(stored);
    stored = { ...mutated, revision: stored.revision + 1 } as AccountDeletionRecord;
    return { ok: true, value: stored };
  });
  return () => stored;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('processAccountDeletionRecord — guard rails', () => {
  it('NOT_FOUND for a deletionId with no record — never invents one', async () => {
    readAccountDeletionRecord.mockResolvedValue(null);
    const outcome = await processAccountDeletionRecord('missing', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'NOT_FOUND' });
    expect(tryAcquireReconciliationLease).not.toHaveBeenCalled();
  });

  it('ALREADY_TERMINAL for COMPLETED — never touched, never reprocessed', async () => {
    readAccountDeletionRecord.mockResolvedValue(baseRecord({ status: 'COMPLETED', completedAt: 999 }));
    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'ALREADY_TERMINAL', status: 'COMPLETED' });
    expect(tryAcquireReconciliationLease).not.toHaveBeenCalled();
  });

  it('ALREADY_TERMINAL for FAILED_TERMINAL — never auto-retried', async () => {
    readAccountDeletionRecord.mockResolvedValue(baseRecord({ status: 'FAILED_TERMINAL' }));
    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'ALREADY_TERMINAL', status: 'FAILED_TERMINAL' });
  });

  it('NOT_DUE for RETRY_SCHEDULED before nextAttemptAt — zero executor invocation', async () => {
    readAccountDeletionRecord.mockResolvedValue(baseRecord({ status: 'RETRY_SCHEDULED' }));
    isRecordDueNow.mockReturnValue(false);
    effectiveNextAttemptAt.mockReturnValue(5000);

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'NOT_DUE', nextAttemptAt: 5000 });
    expect(runTopLevelStep).not.toHaveBeenCalled();
    expect(tryAcquireReconciliationLease).not.toHaveBeenCalled();
  });

  it('LEASE_HELD when another owner holds the lease — never blocks/retries within this call', async () => {
    readAccountDeletionRecord.mockResolvedValue(baseRecord({ status: 'REQUESTED' }));
    isRecordDueNow.mockReturnValue(true);
    tryAcquireReconciliationLease.mockResolvedValue({ ok: false, reason: 'LEASE_HELD' });

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'LEASE_HELD' });
    expect(runTopLevelStep).not.toHaveBeenCalled();
  });
});

describe('processAccountDeletionRecord — main gate: an abandoned REQUESTED record reconciles fully', () => {
  it('walks every required step for an all-SKIPPED_BY_POLICY-eligible policy chain to COMPLETED', async () => {
    const initial = baseRecord({ status: 'REQUESTED' });
    const getStored = wireHappyPathPersistence(initial);

    runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' });
    runProviderSubStep.mockResolvedValue({ kind: 'SUCCEEDED' }); // unreachable (no linked providers -> already SKIPPED_BY_POLICY)

    const outcome = await processAccountDeletionRecord('del-1', {
      ownerId: 'w1',
      now: 1000,
      maxStepsPerInvocation: 10,
    });

    expect(outcome.kind).toBe('PROGRESSED');
    if (outcome.kind === 'PROGRESSED') {
      expect(outcome.finalStatus).toBe('COMPLETED');
    }
    expect(getStored().status).toBe('COMPLETED');
    expect(getStored().completedAt).not.toBeNull();
    // Never called for Google/Apple — both provider sub-steps started SKIPPED_BY_POLICY (no linked providers).
    expect(runProviderSubStep).not.toHaveBeenCalled();
  });

  it('checkpoints after EVERY step — never holds the whole workflow only in memory', async () => {
    const initial = baseRecord({ status: 'REQUESTED' });
    wireHappyPathPersistence(initial);
    runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' });

    await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000, maxStepsPerInvocation: 10 });

    // 7 non-provider required steps in policy v1 (8 total minus PROVIDER_REVOCATION,
    // which resolves without an executor call since nothing is linked) — each
    // one is its own persist call.
    expect(persistAccountDeletionRecordChange.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it('respects maxStepsPerInvocation — a record needing more steps continues on a LATER call, never in one unbounded loop', async () => {
    const initial = baseRecord({ status: 'REQUESTED' });
    wireHappyPathPersistence(initial);
    runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' });

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000, maxStepsPerInvocation: 2 });
    expect(outcome).toEqual({ kind: 'PROGRESSED', stepsExecuted: 2, finalStatus: 'PROCESSING' });
  });
});

describe('processAccountDeletionRecord — retry scheduling never busy-waits', () => {
  it('a FAILED_RETRYABLE outcome stops the loop at RETRY_SCHEDULED without exhausting maxStepsPerInvocation', async () => {
    const initial = baseRecord({ status: 'REQUESTED' });
    wireHappyPathPersistence(initial);
    runTopLevelStep.mockResolvedValue({ kind: 'FAILED', code: 'UNAVAILABLE' });

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000, maxStepsPerInvocation: 10 });
    expect(outcome).toEqual({ kind: 'PROGRESSED', stepsExecuted: 1, finalStatus: 'RETRY_SCHEDULED' });
  });
});

describe('processAccountDeletionRecord — provider-terminal-failure blocks the point of no return', () => {
  it('a terminal Apple failure reaches FAILED_TERMINAL and never runs VAULT_KEY_DESTRUCTION', async () => {
    const initial = baseRecord({ status: 'REQUESTED' });
    wireHappyPathPersistence({
      ...initial,
      providerRevocation: {
        apple: { linked: true, step: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, lastErrorCode: null, completedAt: null } },
        google: initial.providerRevocation.google,
      },
    });
    runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' }); // ACCOUNT_ACCESS_LOCK succeeds
    runProviderSubStep.mockResolvedValue({ kind: 'FAILED', code: 'IDENTITY_MISMATCH' }); // terminal

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000, maxStepsPerInvocation: 10 });
    expect(outcome).toEqual({ kind: 'PROGRESSED', stepsExecuted: 2, finalStatus: 'FAILED_TERMINAL' });
    expect(runTopLevelStep).not.toHaveBeenCalledWith('VAULT_KEY_DESTRUCTION', expect.anything());
  });
});

describe('processAccountDeletionRecord — stale worker protection (CAS)', () => {
  it('rejects a write when the revision has moved since the lease was acquired — never regresses state', async () => {
    readAccountDeletionRecord.mockResolvedValue(baseRecord({ status: 'REQUESTED', revision: 3 }));
    isRecordDueNow.mockReturnValue(true);
    tryAcquireReconciliationLease.mockResolvedValue({
      ok: true,
      record: baseRecord({ status: 'REQUESTED', revision: 4, lease: { ownerId: 'w1', expiresAt: 9999 } }),
    });
    runTopLevelStep.mockResolvedValue({ kind: 'SUCCEEDED' });
    persistAccountDeletionRecordChange.mockResolvedValue({ ok: false, reason: 'REVISION_MISMATCH', currentRevision: 9 });

    const outcome = await processAccountDeletionRecord('del-1', { ownerId: 'w1', now: 1000 });
    expect(outcome).toEqual({ kind: 'STALE_WRITE_REJECTED', stepsExecuted: 0 });
  });
});
