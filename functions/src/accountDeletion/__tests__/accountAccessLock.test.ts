import { describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase-admin/auth';

import { lockAccountAccess } from '../accountAccessLock';

type FakeAdminAuth = Pick<Auth, 'updateUser' | 'revokeRefreshTokens'>;

function fakeAdminAuth(
  overrides: { updateUser?: ReturnType<typeof vi.fn>; revokeRefreshTokens?: ReturnType<typeof vi.fn> } = {},
): FakeAdminAuth {
  return {
    updateUser: (overrides.updateUser ?? vi.fn().mockResolvedValue(undefined)) as unknown as Auth['updateUser'],
    revokeRefreshTokens: (overrides.revokeRefreshTokens ??
      vi.fn().mockResolvedValue(undefined)) as unknown as Auth['revokeRefreshTokens'],
  };
}

function authError(code: string) {
  return Object.assign(new Error(code), { code });
}

describe('lockAccountAccess — happy path', () => {
  it('disables the user then revokes refresh tokens, in that order', async () => {
    const calls: string[] = [];
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockImplementation(async () => {
        calls.push('updateUser');
      }),
      revokeRefreshTokens: vi.fn().mockImplementation(async () => {
        calls.push('revokeRefreshTokens');
      }),
    });

    const outcome = await lockAccountAccess('uid-1', admin);

    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(admin.updateUser).toHaveBeenCalledWith('uid-1', { disabled: true });
    expect(admin.revokeRefreshTokens).toHaveBeenCalledWith('uid-1');
    expect(calls).toEqual(['updateUser', 'revokeRefreshTokens']);
  });
});

describe('lockAccountAccess — idempotency', () => {
  it('calling it twice in a row both succeed (both Admin Auth calls are naturally idempotent)', async () => {
    const admin = fakeAdminAuth();
    await expect(lockAccountAccess('uid-1', admin)).resolves.toEqual({ kind: 'SUCCEEDED' });
    await expect(lockAccountAccess('uid-1', admin)).resolves.toEqual({ kind: 'SUCCEEDED' });
    expect(admin.updateUser).toHaveBeenCalledTimes(2);
    expect(admin.revokeRefreshTokens).toHaveBeenCalledTimes(2);
  });

  it('user-not-found on updateUser resolves as logical success (ALREADY_DELETED), not a fatal error', async () => {
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockRejectedValue(authError('auth/user-not-found')),
    });
    const outcome = await lockAccountAccess('uid-1', admin);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' });
    // Idempotency happens one level up (errors.ts's resolveStepStatusFromOutcome
    // collapses ALREADY_DELETED into SUCCEEDED) — this executor only needs to
    // report the outcome correctly, never invent special-case status logic.
    expect(admin.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('user-not-found on revokeRefreshTokens also resolves as logical success', async () => {
    const admin = fakeAdminAuth({
      revokeRefreshTokens: vi.fn().mockRejectedValue(authError('auth/user-not-found')),
    });
    const outcome = await lockAccountAccess('uid-1', admin);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'ALREADY_DELETED' });
  });
});

describe('lockAccountAccess — partial failure and retry safety', () => {
  it('disable succeeds, revoke fails transiently -> retryable outcome, disable already applied', async () => {
    const admin = fakeAdminAuth({
      revokeRefreshTokens: vi.fn().mockRejectedValue(authError('auth/internal-error')),
    });
    const outcome = await lockAccountAccess('uid-1', admin);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
    expect(admin.updateUser).toHaveBeenCalledOnce(); // already applied — a retry will redo it safely, not skip it
  });

  it('a retry after a transient revoke failure completes successfully, redoing disable safely', async () => {
    const admin = fakeAdminAuth({
      revokeRefreshTokens: vi
        .fn()
        .mockRejectedValueOnce(authError('auth/internal-error'))
        .mockResolvedValueOnce(undefined),
    });
    const first = await lockAccountAccess('uid-1', admin);
    expect(first).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });

    const second = await lockAccountAccess('uid-1', admin);
    expect(second).toEqual({ kind: 'SUCCEEDED' });
    expect(admin.updateUser).toHaveBeenCalledTimes(2); // redone safely, not skipped
  });

  it('disable itself fails transiently -> retryable, revoke never attempted this round', async () => {
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockRejectedValue(authError('auth/network-request-failed')),
    });
    const outcome = await lockAccountAccess('uid-1', admin);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
    expect(admin.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe('lockAccountAccess — error classification', () => {
  it('classifies configuration errors as terminal (MISSING_REQUIRED_CONFIGURATION)', async () => {
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockRejectedValue(authError('auth/invalid-uid')),
    });
    await expect(lockAccountAccess('uid-1', admin)).resolves.toEqual({
      kind: 'FAILED',
      code: 'MISSING_REQUIRED_CONFIGURATION',
    });
  });

  it('classifies an unrecognized error as retryable (INTERNAL_TRANSIENT) — never silently terminal by default', async () => {
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockRejectedValue(new Error('something odd')),
    });
    await expect(lockAccountAccess('uid-1', admin)).resolves.toEqual({
      kind: 'FAILED',
      code: 'INTERNAL_TRANSIENT',
    });
  });

  it('never throws — always resolves an outcome', async () => {
    const admin = fakeAdminAuth({
      updateUser: vi.fn().mockRejectedValue('a non-Error rejection'),
    });
    await expect(lockAccountAccess('uid-1', admin)).resolves.toMatchObject({ kind: 'FAILED' });
  });
});

describe('lockAccountAccess — uid isolation', () => {
  it('only ever acts on the uid it was given', async () => {
    const admin = fakeAdminAuth();
    await lockAccountAccess('uid-A', admin);
    expect(admin.updateUser).toHaveBeenCalledWith('uid-A', { disabled: true });
    expect(admin.revokeRefreshTokens).toHaveBeenCalledWith('uid-A');
    expect(admin.updateUser).not.toHaveBeenCalledWith('uid-B', expect.anything());
  });
});
