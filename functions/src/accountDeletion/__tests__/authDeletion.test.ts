import { describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase-admin/auth';

import { canRunAuthDeletion, executeAuthDeletion } from '../authDeletion';
import { initialStepRecords, beginStepAttempt, completeStepAttempt } from '../steps';
import { currentPolicy } from '../policy';
import type { AccountDeletionStepName, AccountDeletionStepRecord } from '../types';

type FakeAdminAuth = Pick<Auth, 'deleteUser'>;

function fakeAdminAuth(overrides: { deleteUser?: ReturnType<typeof vi.fn> } = {}): FakeAdminAuth {
  return {
    deleteUser: (overrides.deleteUser ?? vi.fn().mockResolvedValue(undefined)) as unknown as Auth['deleteUser'],
  };
}

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

describe('executeAuthDeletion — happy path', () => {
  it('deletes the given uid', async () => {
    const admin = fakeAdminAuth();
    const outcome = await executeAuthDeletion('uid-1', admin);
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(admin.deleteUser).toHaveBeenCalledWith('uid-1');
  });

  it('never calls getUser — only deleteUser is invoked', async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    const getUser = vi.fn();
    await executeAuthDeletion('uid-1', { deleteUser, getUser } as unknown as Auth);
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('executeAuthDeletion — idempotency', () => {
  it('user already absent (auth/user-not-found) is logical success (ALREADY_DELETED), never a fatal error', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(authError('auth/user-not-found')) });
    const outcome = await executeAuthDeletion('uid-1', admin);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' });
  });

  it('a duplicate call after a successful delete stays logically successful', async () => {
    const admin = fakeAdminAuth({
      deleteUser: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(authError('auth/user-not-found')),
    });
    const first = await executeAuthDeletion('uid-1', admin);
    const second = await executeAuthDeletion('uid-1', admin);
    expect(first).toEqual({ kind: 'SUCCEEDED' });
    expect(second).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' });
    // Both collapse to SUCCEEDED one level up via resolveStepStatusFromOutcome
    // — this executor only needs to report the outcome correctly.
  });
});

describe('executeAuthDeletion — error classification', () => {
  it('classifies transient network/internal errors as retryable (UNAVAILABLE)', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(authError('auth/network-request-failed')) });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
  });

  it('classifies auth/internal-error as retryable (UNAVAILABLE)', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(authError('auth/internal-error')) });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
  });

  it('classifies configuration errors as terminal (MISSING_REQUIRED_CONFIGURATION)', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(authError('auth/invalid-uid')) });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toEqual({
      kind: 'FAILED',
      code: 'MISSING_REQUIRED_CONFIGURATION',
    });
  });

  it('classifies auth/project-not-found as terminal (MISSING_REQUIRED_CONFIGURATION)', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(authError('auth/project-not-found')) });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toEqual({
      kind: 'FAILED',
      code: 'MISSING_REQUIRED_CONFIGURATION',
    });
  });

  it('classifies an unrecognized error as retryable (INTERNAL_TRANSIENT) — never silently terminal by default', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue(new Error('something odd')) });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toEqual({ kind: 'FAILED', code: 'INTERNAL_TRANSIENT' });
  });

  it('never throws — always resolves an outcome, even for a non-Error rejection', async () => {
    const admin = fakeAdminAuth({ deleteUser: vi.fn().mockRejectedValue('a non-Error rejection') });
    await expect(executeAuthDeletion('uid-1', admin)).resolves.toMatchObject({ kind: 'FAILED' });
  });
});

describe('executeAuthDeletion — retry safety', () => {
  it('a transient failure followed by a retry eventually succeeds', async () => {
    const admin = fakeAdminAuth({
      deleteUser: vi.fn().mockRejectedValueOnce(authError('auth/internal-error')).mockResolvedValueOnce(undefined),
    });
    const first = await executeAuthDeletion('uid-1', admin);
    expect(first).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
    const second = await executeAuthDeletion('uid-1', admin);
    expect(second).toEqual({ kind: 'SUCCEEDED' });
  });
});

describe('executeAuthDeletion — uid isolation', () => {
  it('only ever acts on the uid it was given, never a hardcoded/other uid', async () => {
    const admin = fakeAdminAuth();
    await executeAuthDeletion('uid-A', admin);
    expect(admin.deleteUser).toHaveBeenCalledWith('uid-A');
    expect(admin.deleteUser).not.toHaveBeenCalledWith('uid-B');
  });
});

// ─── Preconditions (Fase 10 §9/§10/§25) ──────────────────────────────────

const ALL_STEPS: readonly AccountDeletionStepName[] = [
  'ACCOUNT_ACCESS_LOCK',
  'PROVIDER_REVOCATION',
  'VAULT_KEY_DESTRUCTION',
  'FIRESTORE_CLEANUP',
  'STORAGE_CLEANUP',
  'RETAINED_DATA_PROCESSING',
  'REVENUECAT_PROCESSING',
  'AUTH_DELETION',
];

function succeed(record: AccountDeletionStepRecord, now = 1): AccountDeletionStepRecord {
  const running = beginStepAttempt('x', record, now);
  return completeStepAttempt('x', running, { kind: 'SUCCEEDED' }, now, currentPolicy().retry);
}

function skipByPolicy(record: AccountDeletionStepRecord, now = 1): AccountDeletionStepRecord {
  const running = beginStepAttempt('x', record, now);
  return completeStepAttempt('x', running, { kind: 'SKIPPED_BY_POLICY', reason: 'test' }, now, currentPolicy().retry);
}

function failRetryable(record: AccountDeletionStepRecord, now = 1): AccountDeletionStepRecord {
  const running = beginStepAttempt('x', record, now);
  return completeStepAttempt('x', running, { kind: 'FAILED', code: 'UNAVAILABLE' }, now, currentPolicy().retry);
}

describe('canRunAuthDeletion — preconditions', () => {
  it('all earlier steps SUCCEEDED: AUTH_DELETION is runnable', () => {
    const steps = initialStepRecords();
    const mutated = { ...steps };
    for (const name of ALL_STEPS) {
      if (name === 'AUTH_DELETION') continue;
      mutated[name] = succeed(mutated[name]);
    }
    expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(true);
  });

  it('REVENUECAT_PROCESSING = SKIPPED_BY_POLICY (policy v1) does not block AUTH_DELETION', () => {
    const steps = initialStepRecords();
    const mutated = { ...steps };
    for (const name of ALL_STEPS) {
      if (name === 'AUTH_DELETION') continue;
      mutated[name] = name === 'REVENUECAT_PROCESSING' ? skipByPolicy(mutated[name]) : succeed(mutated[name]);
    }
    expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(true);
  });

  it('RETAINED_DATA_PROCESSING = SKIPPED_BY_POLICY (support/coupon RETAIN) does not block AUTH_DELETION', () => {
    const steps = initialStepRecords();
    const mutated = { ...steps };
    for (const name of ALL_STEPS) {
      if (name === 'AUTH_DELETION') continue;
      mutated[name] = name === 'RETAINED_DATA_PROCESSING' ? skipByPolicy(mutated[name]) : succeed(mutated[name]);
    }
    expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(true);
  });

  it.each(ALL_STEPS.filter((n) => n !== 'AUTH_DELETION'))(
    '%s still PENDING blocks AUTH_DELETION',
    (pendingStep) => {
      const steps = initialStepRecords();
      const mutated = { ...steps };
      for (const name of ALL_STEPS) {
        if (name === 'AUTH_DELETION' || name === pendingStep) continue;
        mutated[name] = succeed(mutated[name]);
      }
      // pendingStep stays PENDING (untouched)
      expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(false);
    },
  );

  it('an earlier step FAILED_RETRYABLE blocks AUTH_DELETION', () => {
    const steps = initialStepRecords();
    const mutated = { ...steps };
    for (const name of ALL_STEPS) {
      if (name === 'AUTH_DELETION') continue;
      mutated[name] = name === 'FIRESTORE_CLEANUP' ? failRetryable(mutated[name]) : succeed(mutated[name]);
    }
    expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(false);
  });

  it('an earlier step FAILED_TERMINAL blocks AUTH_DELETION (never bypassed)', () => {
    const steps = initialStepRecords();
    const mutated = { ...steps };
    for (const name of ALL_STEPS) {
      if (name === 'AUTH_DELETION') continue;
      if (name === 'VAULT_KEY_DESTRUCTION') {
        // Exhaust retry budget to reach FAILED_TERMINAL deterministically.
        let record = mutated[name];
        for (let i = 0; i < currentPolicy().retry.maxAttempts; i++) {
          record = failRetryable(record, i + 1);
          if (record.status === 'FAILED_TERMINAL') break;
          record = { ...record, nextAttemptAt: null }; // allow immediate re-attempt in this test
        }
        mutated[name] = record;
        continue;
      }
      mutated[name] = succeed(mutated[name]);
    }
    expect(mutated.VAULT_KEY_DESTRUCTION.status).toBe('FAILED_TERMINAL');
    expect(canRunAuthDeletion(currentPolicy(), mutated)).toBe(false);
  });
});
