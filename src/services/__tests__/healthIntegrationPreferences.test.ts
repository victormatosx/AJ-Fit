import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => localStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      localStore.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      localStore.delete(key);
    }),
  },
}));

import {
  clearHealthIntegrationSessionState,
  getLastKnownHealthIntegrationIntent,
  readHealthIntegrationIntent,
  setHealthIntegrationIntent,
} from '../healthIntegrationPreferences';

beforeEach(() => {
  localStore.clear();
  vi.clearAllMocks();
});

describe('healthIntegrationPreferences', () => {
  it('defaults to not_configured for a uid never written', async () => {
    await expect(readHealthIntegrationIntent('uid-fresh-1')).resolves.toBe('not_configured');
  });

  it('persists and reads back the chosen intent', async () => {
    await setHealthIntegrationIntent('uid-persist-1', 'enabled');
    await expect(readHealthIntegrationIntent('uid-persist-1')).resolves.toBe('enabled');
    expect(getLastKnownHealthIntegrationIntent('uid-persist-1')).toBe('enabled');
  });

  it('disconnect persists disabled, distinct from never-configured', async () => {
    await setHealthIntegrationIntent('uid-disable-1', 'enabled');
    await setHealthIntegrationIntent('uid-disable-1', 'disabled');
    await expect(readHealthIntegrationIntent('uid-disable-1')).resolves.toBe('disabled');
  });

  it('a corrupted/unexpected stored value falls back to not_configured instead of throwing', async () => {
    localStore.set('ajfit.health-integration.intent.v1:uid-corrupt-1', '{"not":"a valid intent"}');
    await expect(readHealthIntegrationIntent('uid-corrupt-1')).resolves.toBe('not_configured');
  });

  describe('logout', () => {
    it('clears the in-memory hint but preserves the persisted value', async () => {
      await setHealthIntegrationIntent('uid-logout-1', 'enabled');

      clearHealthIntegrationSessionState('uid-logout-1');
      expect(getLastKnownHealthIntegrationIntent('uid-logout-1')).toBeUndefined();

      // The whole point: a fresh read (as the next sign-in would do) still
      // finds the choice this account made before logging out.
      await expect(readHealthIntegrationIntent('uid-logout-1')).resolves.toBe('enabled');
    });

    it('re-reading after logout repopulates the in-memory hint from the preserved value', async () => {
      await setHealthIntegrationIntent('uid-logout-2', 'disabled');
      clearHealthIntegrationSessionState('uid-logout-2');

      await readHealthIntegrationIntent('uid-logout-2');
      expect(getLastKnownHealthIntegrationIntent('uid-logout-2')).toBe('disabled');
    });

    it('a write started just before logout is allowed to finish and still persists', async () => {
      const uid = 'uid-logout-race-1';
      // No `await` on the set — logout fires while the AsyncStorage write may
      // still be queued, simulating a fast sign-out right after a connect tap.
      const setPromise = setHealthIntegrationIntent(uid, 'enabled');
      clearHealthIntegrationSessionState(uid);

      await expect(setPromise).resolves.toBe('enabled');
      await expect(readHealthIntegrationIntent(uid)).resolves.toBe('enabled');
    });

    it('is a no-op for a uid that never set anything (no crash, nothing to preserve)', () => {
      expect(() => clearHealthIntegrationSessionState('uid-never-seen')).not.toThrow();
    });
  });

  describe('account switching', () => {
    it("one uid's intent never leaks into another uid's read", async () => {
      await setHealthIntegrationIntent('uid-a', 'enabled');
      await expect(readHealthIntegrationIntent('uid-b')).resolves.toBe('not_configured');
      await expect(readHealthIntegrationIntent('uid-a')).resolves.toBe('enabled');
    });

    it('logging out of A and into a different uid B never shows A\'s intent for B', async () => {
      await setHealthIntegrationIntent('uid-switch-a', 'enabled');
      clearHealthIntegrationSessionState('uid-switch-a');

      // B signs in — nothing in memory should reference A anymore, and B
      // starts from its own, unrelated default.
      expect(getLastKnownHealthIntegrationIntent('uid-switch-b')).toBeUndefined();
      await expect(readHealthIntegrationIntent('uid-switch-b')).resolves.toBe('not_configured');
    });

    it('re-login as the same uid after logout recovers exactly what it left behind, not a reset value', async () => {
      const uid = 'uid-relogin-1';
      await setHealthIntegrationIntent(uid, 'enabled');
      clearHealthIntegrationSessionState(uid);

      // Simulates the uid signing back in: nothing has primed the cache yet.
      expect(getLastKnownHealthIntegrationIntent(uid)).toBeUndefined();
      await expect(readHealthIntegrationIntent(uid)).resolves.toBe('enabled');
    });
  });

  describe('concurrent operations', () => {
    it('two concurrent writes for the same uid do not corrupt storage — one of the two values wins cleanly', async () => {
      const uid = 'uid-concurrent-1';
      await Promise.all([
        setHealthIntegrationIntent(uid, 'enabled'),
        setHealthIntegrationIntent(uid, 'disabled'),
      ]);
      await expect(readHealthIntegrationIntent(uid)).resolves.toMatch(/^(enabled|disabled)$/);
    });

    it('writes for different uids run independently without blocking or mixing results', async () => {
      await Promise.all([
        setHealthIntegrationIntent('uid-parallel-a', 'enabled'),
        setHealthIntegrationIntent('uid-parallel-b', 'disabled'),
      ]);
      const [a, b] = await Promise.all([
        readHealthIntegrationIntent('uid-parallel-a'),
        readHealthIntegrationIntent('uid-parallel-b'),
      ]);
      expect(a).toBe('enabled');
      expect(b).toBe('disabled');
    });

    it('a read racing a write for the same uid never observes a torn/partial value', async () => {
      const uid = 'uid-race-read-1';
      await setHealthIntegrationIntent(uid, 'enabled');
      const [writeResult, readResult] = await Promise.all([
        setHealthIntegrationIntent(uid, 'disabled'),
        readHealthIntegrationIntent(uid),
      ]);
      expect(writeResult).toBe('disabled');
      expect(['enabled', 'disabled']).toContain(readResult);
    });
  });
});
