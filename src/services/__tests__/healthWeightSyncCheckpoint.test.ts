import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(),
}));

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  },
}));

import {
  createHealthWeightSyncCheckpoint,
  effectiveHealthWeightHistoryStart,
  markImportedWeightsDeleted,
  readHealthWeightSyncCheckpoint,
  writeHealthWeightSyncCheckpoint,
} from '../healthWeightSyncCheckpoint';

beforeEach(() => storage.clear());

describe('health weight sync checkpoint', () => {
  it('uses a documented 180-day initial window', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const checkpoint = createHealthWeightSyncCheckpoint('ios', now);
    expect(now.getTime() - new Date(checkpoint.historyStartIso).getTime()).toBe(180 * 24 * 60 * 60 * 1000);
  });

  it('isolates cursors by uid and platform', async () => {
    await writeHealthWeightSyncCheckpoint('uid-a', {
      ...createHealthWeightSyncCheckpoint('ios'), cursor: 'anchor-a',
    });
    await expect(readHealthWeightSyncCheckpoint('uid-a', 'ios')).resolves.toMatchObject({ cursor: 'anchor-a' });
    await expect(readHealthWeightSyncCheckpoint('uid-b', 'ios')).resolves.toBeNull();
    await expect(readHealthWeightSyncCheckpoint('uid-a', 'android')).resolves.toBeNull();
  });

  it('falls back safely when stored JSON is corrupt', async () => {
    storage.set('ajfit.health-weight-sync.v1:uid-a:ios', '{bad');
    await expect(readHealthWeightSyncCheckpoint('uid-a', 'ios')).resolves.toBeNull();
  });

  it('records a deletion cutoff without discarding the incremental cursor', async () => {
    const initial = { ...createHealthWeightSyncCheckpoint('android'), cursor: 'changes-token' };
    await writeHealthWeightSyncCheckpoint('uid-a', initial);
    const deletedAt = new Date('2026-10-12T12:00:00Z');
    const next = await markImportedWeightsDeleted('uid-a', 'android', deletedAt);
    expect(next.cursor).toBe('changes-token');
    expect(effectiveHealthWeightHistoryStart(next)).toEqual(deletedAt);
  });
});
