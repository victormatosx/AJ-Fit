import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearRestSession: vi.fn(),
  cleanupNative: vi.fn(),
}));

vi.mock('../restSessionStorage', () => ({
  clearRestSession: mocks.clearRestSession,
}));
vi.mock('../../lib/restLiveActivity', () => ({
  restLiveActivity: { cleanup: mocks.cleanupNative },
}));

import { cleanupRestSessionArtifacts } from '../restSessionCleanup';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearRestSession.mockResolvedValue(undefined);
  mocks.cleanupNative.mockResolvedValue(undefined);
});

describe('cleanupRestSessionArtifacts', () => {
  it('clears storage and the native surface together', async () => {
    await cleanupRestSessionArtifacts();
    expect(mocks.clearRestSession).toHaveBeenCalledOnce();
    expect(mocks.cleanupNative).toHaveBeenCalledOnce();
  });

  it('is fail-open when either independent cleanup rejects', async () => {
    mocks.clearRestSession.mockRejectedValueOnce(new Error('storage'));
    mocks.cleanupNative.mockRejectedValueOnce(new Error('native'));
    await expect(cleanupRestSessionArtifacts()).resolves.toBeUndefined();
  });
});
