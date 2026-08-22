import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('firebase-functions/v2/https', async () => {
  class HttpsError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { HttpsError };
});

import { requireActiveAccount } from '../activeAccountGuard';

function fakeDb(existsByPath: Record<string, boolean>) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: existsByPath[`${name}/${id}`] === true }),
      }),
    }),
  } as never;
}

describe('requireActiveAccount', () => {
  it('resolves (does not throw) when no lock document exists for the uid', async () => {
    const db = fakeDb({});
    await expect(requireActiveAccount('uid-1', db)).resolves.toBeUndefined();
  });

  it('throws failed-precondition when a lock document exists', async () => {
    const db = fakeDb({ 'accountDeletionLocks/uid-1': true });
    await expect(requireActiveAccount('uid-1', db)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('only checks the exact uid given — another uid having a lock never blocks this one', async () => {
    const db = fakeDb({ 'accountDeletionLocks/uid-2': true });
    await expect(requireActiveAccount('uid-1', db)).resolves.toBeUndefined();
  });

  it("checks existence only — not any field inside the lock document's status", async () => {
    // The fake here only models existence (matching real Firestore semantics
    // this guard relies on) — this test documents that the guard has no
    // status-inspection code path to bypass at all.
    const db = fakeDb({ 'accountDeletionLocks/uid-1': true });
    await expect(requireActiveAccount('uid-1', db)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});
