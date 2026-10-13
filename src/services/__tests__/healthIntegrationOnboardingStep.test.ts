import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStore = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => localStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      localStore.set(key, value);
    }),
  },
}));

import {
  clearHealthIntegrationOnboardingPendingConfirmation,
  clearHealthIntegrationOnboardingStepSessionState,
  getLastKnownHealthIntegrationOnboardingPendingConfirmation,
  getLastKnownHealthIntegrationOnboardingStepSeen,
  markHealthIntegrationOnboardingPendingConfirmation,
  markHealthIntegrationOnboardingStepSeen,
  readHealthIntegrationOnboardingPendingConfirmation,
  readHealthIntegrationOnboardingStepSeen,
} from '../healthIntegrationOnboardingStep';

beforeEach(() => {
  localStore.clear();
  vi.clearAllMocks();
});

describe('healthIntegrationOnboardingStep', () => {
  it('defaults to not-seen for a uid never written', async () => {
    await expect(readHealthIntegrationOnboardingStepSeen('uid-fresh-1')).resolves.toBe(false);
  });

  it('persists and reads back a decision ("Conectar" or "Agora não" both mark it seen)', async () => {
    await markHealthIntegrationOnboardingStepSeen('uid-persist-1');
    await expect(readHealthIntegrationOnboardingStepSeen('uid-persist-1')).resolves.toBe(true);
    expect(getLastKnownHealthIntegrationOnboardingStepSeen('uid-persist-1')).toBe(true);
  });

  it('one uid never leaks its decision into another uid read', async () => {
    await markHealthIntegrationOnboardingStepSeen('uid-a');
    await expect(readHealthIntegrationOnboardingStepSeen('uid-b')).resolves.toBe(false);
    await expect(readHealthIntegrationOnboardingStepSeen('uid-a')).resolves.toBe(true);
  });

  describe('logout', () => {
    it('clears the in-memory hint but preserves the persisted decision', async () => {
      await markHealthIntegrationOnboardingStepSeen('uid-logout-1');

      clearHealthIntegrationOnboardingStepSessionState('uid-logout-1');
      expect(getLastKnownHealthIntegrationOnboardingStepSeen('uid-logout-1')).toBeUndefined();

      await expect(readHealthIntegrationOnboardingStepSeen('uid-logout-1')).resolves.toBe(true);
    });

    it('is a no-op for a uid that never decided anything', () => {
      expect(() => clearHealthIntegrationOnboardingStepSessionState('uid-never-seen')).not.toThrow();
    });
  });

  describe('concurrent operations', () => {
    it('writes for different uids run independently without mixing results', async () => {
      await Promise.all([
        markHealthIntegrationOnboardingStepSeen('uid-parallel-a'),
        readHealthIntegrationOnboardingStepSeen('uid-parallel-b'),
      ]);
      await expect(readHealthIntegrationOnboardingStepSeen('uid-parallel-a')).resolves.toBe(true);
      await expect(readHealthIntegrationOnboardingStepSeen('uid-parallel-b')).resolves.toBe(false);
    });
  });

  describe('pending confirmation — "Conectar" chosen pre-auth, still needs an explicit post-auth tap', () => {
    it('defaults to not-pending for a uid never written', async () => {
      await expect(readHealthIntegrationOnboardingPendingConfirmation('uid-fresh-2')).resolves.toBe(false);
    });

    it('records a pending confirmation independently of "seen"', async () => {
      await markHealthIntegrationOnboardingPendingConfirmation('uid-pending-1');
      await expect(readHealthIntegrationOnboardingPendingConfirmation('uid-pending-1')).resolves.toBe(true);
      expect(getLastKnownHealthIntegrationOnboardingPendingConfirmation('uid-pending-1')).toBe(true);
      // Not settled yet — the confirmation sheet hasn't been answered.
      await expect(readHealthIntegrationOnboardingStepSeen('uid-pending-1')).resolves.toBe(false);
    });

    it('clearing the pending confirmation persists false, not just absence', async () => {
      await markHealthIntegrationOnboardingPendingConfirmation('uid-pending-2');
      await clearHealthIntegrationOnboardingPendingConfirmation('uid-pending-2');
      await expect(readHealthIntegrationOnboardingPendingConfirmation('uid-pending-2')).resolves.toBe(false);
      expect(getLastKnownHealthIntegrationOnboardingPendingConfirmation('uid-pending-2')).toBe(false);
    });

    it('resolving it (the real call site always pairs both) leaves the uid fully settled', async () => {
      const uid = 'uid-pending-3';
      await markHealthIntegrationOnboardingPendingConfirmation(uid);
      await Promise.all([
        clearHealthIntegrationOnboardingPendingConfirmation(uid),
        markHealthIntegrationOnboardingStepSeen(uid),
      ]);
      await expect(readHealthIntegrationOnboardingPendingConfirmation(uid)).resolves.toBe(false);
      await expect(readHealthIntegrationOnboardingStepSeen(uid)).resolves.toBe(true);
    });

    it('logout clears the in-memory pending hint but preserves the persisted value', async () => {
      await markHealthIntegrationOnboardingPendingConfirmation('uid-logout-2');
      clearHealthIntegrationOnboardingStepSessionState('uid-logout-2');
      expect(getLastKnownHealthIntegrationOnboardingPendingConfirmation('uid-logout-2')).toBeUndefined();
      await expect(readHealthIntegrationOnboardingPendingConfirmation('uid-logout-2')).resolves.toBe(true);
    });
  });
});
