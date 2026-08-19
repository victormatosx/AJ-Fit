import { describe, expect, it, vi } from 'vitest';

import { executeVaultKeyDestruction } from '../vaultKeyDestruction';

function authError(code: number) {
  return Object.assign(new Error(`grpc ${code}`), { code });
}

describe('executeVaultKeyDestruction — happy path', () => {
  it('deletes the vault document for the given uid', async () => {
    const deleteVaultDocument = vi.fn().mockResolvedValue(undefined);
    const outcome = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(deleteVaultDocument).toHaveBeenCalledWith('uid-1');
  });
});

describe('executeVaultKeyDestruction — idempotency (§20)', () => {
  it('an already-absent document is a silent success (plain Firestore delete never throws not-found)', async () => {
    const deleteVaultDocument = vi.fn().mockResolvedValue(undefined);
    const outcome = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
  });

  it('duplicate execution converges to the same final SUCCEEDED outcome', async () => {
    const deleteVaultDocument = vi.fn().mockResolvedValue(undefined);
    const first = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    const second = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    const third = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    for (const outcome of [first, second, third]) expect(outcome).toEqual({ kind: 'SUCCEEDED' });
    expect(deleteVaultDocument).toHaveBeenCalledTimes(3);
  });
});

describe('executeVaultKeyDestruction — error classification', () => {
  it.each([
    [4, 'DEADLINE_EXCEEDED'],
    [14, 'UNAVAILABLE'],
    [8, 'RESOURCE_EXHAUSTED'],
    [7, 'MISSING_REQUIRED_CONFIGURATION'],
  ] as const)('gRPC code %s maps to %s', async (code, expected) => {
    const deleteVaultDocument = vi.fn().mockRejectedValue(authError(code));
    await expect(executeVaultKeyDestruction('uid-1', { deleteVaultDocument })).resolves.toEqual({
      kind: 'FAILED',
      code: expected,
    });
  });

  it('classifies an unrecognized error as retryable (INTERNAL_TRANSIENT) — never silently terminal by default', async () => {
    const deleteVaultDocument = vi.fn().mockRejectedValue(new Error('something odd'));
    await expect(executeVaultKeyDestruction('uid-1', { deleteVaultDocument })).resolves.toEqual({
      kind: 'FAILED',
      code: 'INTERNAL_TRANSIENT',
    });
  });

  it('never throws — always resolves an outcome, even for a non-Error rejection', async () => {
    const deleteVaultDocument = vi.fn().mockRejectedValue('a non-Error rejection');
    await expect(executeVaultKeyDestruction('uid-1', { deleteVaultDocument })).resolves.toMatchObject({
      kind: 'FAILED',
    });
  });
});

describe('executeVaultKeyDestruction — retry after partial/transient failure', () => {
  it('a transient failure followed by a retry eventually succeeds, never recreating anything (§23/§25)', async () => {
    const deleteVaultDocument = vi
      .fn()
      .mockRejectedValueOnce(authError(14))
      .mockResolvedValueOnce(undefined);
    const first = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    expect(first).toEqual({ kind: 'FAILED', code: 'UNAVAILABLE' });
    const second = await executeVaultKeyDestruction('uid-1', { deleteVaultDocument });
    expect(second).toEqual({ kind: 'SUCCEEDED' });
  });
});

describe('executeVaultKeyDestruction — uid isolation', () => {
  it('only ever acts on the uid it was given', async () => {
    const deleteVaultDocument = vi.fn().mockResolvedValue(undefined);
    await executeVaultKeyDestruction('uid-A', { deleteVaultDocument });
    expect(deleteVaultDocument).toHaveBeenCalledWith('uid-A');
    expect(deleteVaultDocument).not.toHaveBeenCalledWith('uid-B');
  });
});
