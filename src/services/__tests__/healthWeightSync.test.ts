import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ platform: 'ios' as 'ios' | 'android' }));
vi.mock('../healthIntegration', () => ({ getHealthPlatform: () => state.platform }));

const native = vi.hoisted(() => ({
  ios: vi.fn(),
  androidHistory: vi.fn(),
  androidChanges: vi.fn(),
}));
vi.mock('../healthWeightNative', () => ({
  HealthWeightNativeError: class HealthWeightNativeError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  readIosWeightChanges: native.ios,
  readAndroidWeightHistoryPage: native.androidHistory,
  readAndroidWeightChanges: native.androidChanges,
}));

const persistence = vi.hoisted(() => ({ importSamples: vi.fn() }));
vi.mock('../healthWeightSamples', () => ({ importHealthWeightSamples: persistence.importSamples }));

const checkpoints = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../healthWeightSyncCheckpoint', () => ({
  createHealthWeightSyncCheckpoint: (platform: 'ios' | 'android') => ({
    version: 1,
    platform,
    historyStartIso: '2026-01-01T00:00:00.000Z',
    cursor: null,
    lastSuccessfulAtIso: null,
    ignoreMeasuredBeforeIso: null,
  }),
  effectiveHealthWeightHistoryStart: (checkpoint: { historyStartIso: string }) => new Date(checkpoint.historyStartIso),
  readHealthWeightSyncCheckpoint: checkpoints.read,
  writeHealthWeightSyncCheckpoint: checkpoints.write,
}));

import { syncHealthWeightSamples } from '../healthWeightSync';

const normalized = {
  platform: 'ios' as const,
  sourceId: 'one',
  sourceApp: 'com.apple.Health',
  measuredAt: new Date('2026-05-01T12:00:00Z'),
  weightKg: 70,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.platform = 'ios';
  checkpoints.read.mockResolvedValue(null);
  checkpoints.write.mockResolvedValue(undefined);
  persistence.importSamples.mockResolvedValue({
    imported: 1,
    skippedDuplicates: 0,
    skippedInvalid: 0,
    latestMeasuredAt: normalized.measuredAt,
    partialFailure: false,
  });
});

describe('health weight sync orchestration', () => {
  it('advances a HealthKit anchor only after each page has persisted', async () => {
    const events: string[] = [];
    native.ios
      .mockImplementationOnce(async () => ({ samples: [normalized], deletedSourceIds: [], nextCursor: 'a1', hasMore: true, cursorExpired: false }))
      .mockImplementationOnce(async () => ({ samples: [normalized], deletedSourceIds: [], nextCursor: 'a2', hasMore: false, cursorExpired: false }));
    persistence.importSamples.mockImplementation(async () => {
      events.push('persist');
      return { imported: 1, skippedDuplicates: 0, skippedInvalid: 0, latestMeasuredAt: normalized.measuredAt, partialFailure: false };
    });
    checkpoints.write.mockImplementation(async (_uid: string, checkpoint: { cursor: string }) => {
      events.push(`checkpoint:${checkpoint.cursor}`);
    });

    const result = await syncHealthWeightSamples('uid-ios');
    expect(result.imported).toBe(2);
    expect(events).toEqual(['persist', 'checkpoint:a1', 'persist', 'checkpoint:a2']);
  });

  it('never advances the checkpoint when persistence reports a partial failure', async () => {
    native.ios.mockResolvedValue({ samples: [normalized], deletedSourceIds: [], nextCursor: 'unsafe', hasMore: false, cursorExpired: false });
    persistence.importSamples.mockResolvedValue({
      imported: 0, skippedDuplicates: 0, skippedInvalid: 0, latestMeasuredAt: null, partialFailure: true,
    });
    await expect(syncHealthWeightSamples('uid-partial')).resolves.toMatchObject({ status: 'error' });
    expect(checkpoints.write).not.toHaveBeenCalled();
  });

  it('establishes an Android change token before paginated history, then commits it after persistence', async () => {
    state.platform = 'android';
    const events: string[] = [];
    native.androidChanges.mockImplementation(async () => {
      events.push('changes-token');
      return { samples: [], deletedSourceIds: [], nextCursor: 'token-1', hasMore: false, cursorExpired: false };
    });
    native.androidHistory.mockImplementation(async () => {
      events.push('history');
      return { samples: [{ ...normalized, platform: 'android' }], nextPageToken: null };
    });
    persistence.importSamples.mockImplementation(async () => {
      events.push('persist');
      return { imported: 1, skippedDuplicates: 0, skippedInvalid: 0, latestMeasuredAt: normalized.measuredAt, partialFailure: false };
    });
    checkpoints.write.mockImplementation(async () => { events.push('checkpoint'); });

    await syncHealthWeightSamples('uid-android');
    expect(events).toEqual(['changes-token', 'history', 'persist', 'persist', 'checkpoint']);
  });

  it('uses the stored Android token for incremental imports without rescanning history', async () => {
    state.platform = 'android';
    checkpoints.read.mockResolvedValue({
      version: 1, platform: 'android', historyStartIso: '2026-01-01T00:00:00.000Z', cursor: 'stored', lastSuccessfulAtIso: null, ignoreMeasuredBeforeIso: null,
    });
    native.androidChanges.mockResolvedValue({ samples: [], deletedSourceIds: [], nextCursor: 'next', hasMore: false, cursorExpired: false });
    await syncHealthWeightSamples('uid-incremental');
    expect(native.androidChanges).toHaveBeenCalledWith('stored');
    expect(native.androidHistory).not.toHaveBeenCalled();
    expect(checkpoints.write).toHaveBeenCalledWith('uid-incremental', expect.objectContaining({ cursor: 'next' }));
  });

  it('logically cancels stale work before persistence after a disconnect/account transition', async () => {
    let current = true;
    native.ios.mockImplementation(async () => {
      current = false;
      return { samples: [normalized], deletedSourceIds: [], nextCursor: 'a1', hasMore: false, cursorExpired: false };
    });
    await expect(syncHealthWeightSamples('uid-stale', { shouldContinue: () => current })).rejects.toThrow();
    expect(persistence.importSamples).not.toHaveBeenCalled();
    expect(checkpoints.write).not.toHaveBeenCalled();
  });

  it('single-flights concurrent requests for one uid while keeping different accounts isolated', async () => {
    let release: (() => void) | undefined;
    native.ios.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ samples: [], deletedSourceIds: [], nextCursor: 'a', hasMore: false, cursorExpired: false });
    }));
    const a1 = syncHealthWeightSamples('uid-a');
    const a2 = syncHealthWeightSamples('uid-a');
    await vi.waitFor(() => expect(native.ios).toHaveBeenCalledTimes(1));
    release!();
    await Promise.all([a1, a2]);

    native.ios.mockResolvedValue({ samples: [], deletedSourceIds: [], nextCursor: 'b', hasMore: false, cursorExpired: false });
    await Promise.all([syncHealthWeightSamples('uid-a'), syncHealthWeightSamples('uid-b')]);
    expect(native.ios).toHaveBeenCalledTimes(3);
    expect(checkpoints.write).toHaveBeenCalledWith('uid-a', expect.anything());
    expect(checkpoints.write).toHaveBeenCalledWith('uid-b', expect.anything());
  });
});
