import { describe, expect, it, vi } from 'vitest';

import { CLIENT_RECENT_AUTH_MAX_AGE_MS, hasRecentAuth } from '../recentAuth';

function userWithAuthTime(iso: string) {
  return { getIdTokenResult: vi.fn().mockResolvedValue({ authTime: iso }) };
}

describe('hasRecentAuth', () => {
  it('is false for a null user', async () => {
    await expect(hasRecentAuth(null)).resolves.toBe(false);
  });

  it('is true for a token minted right now', async () => {
    await expect(hasRecentAuth(userWithAuthTime(new Date().toISOString()))).resolves.toBe(true);
  });

  it('is true exactly at the boundary of the window', async () => {
    const at = new Date(Date.now() - CLIENT_RECENT_AUTH_MAX_AGE_MS);
    await expect(hasRecentAuth(userWithAuthTime(at.toISOString()))).resolves.toBe(true);
  });

  it('is false just past the window', async () => {
    const past = new Date(Date.now() - CLIENT_RECENT_AUTH_MAX_AGE_MS - 1000);
    await expect(hasRecentAuth(userWithAuthTime(past.toISOString()))).resolves.toBe(false);
  });

  it('is false for an unparsable authTime', async () => {
    await expect(hasRecentAuth(userWithAuthTime('not-a-date'))).resolves.toBe(false);
  });

  it('is false for an implausibly future authTime (negative age)', async () => {
    const future = new Date(Date.now() + 60_000);
    await expect(hasRecentAuth(userWithAuthTime(future.toISOString()))).resolves.toBe(false);
  });

  it('fails closed when getIdTokenResult rejects', async () => {
    const user = { getIdTokenResult: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(hasRecentAuth(user)).resolves.toBe(false);
  });

  it('honours a caller-supplied window', async () => {
    const at = new Date(Date.now() - 30_000);
    await expect(hasRecentAuth(userWithAuthTime(at.toISOString()), 60_000)).resolves.toBe(true);
    await expect(hasRecentAuth(userWithAuthTime(at.toISOString()), 10_000)).resolves.toBe(false);
  });
});
