import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import {
  enqueueHealthWorkoutExport,
  healthWorkoutExportLastSuccess,
  healthWorkoutExportPendingCount,
  markHealthWorkoutExportFailed,
  markHealthWorkoutExportSucceeded,
  markHealthWorkoutExportWriting,
  readHealthWorkoutExportState,
  setHealthWorkoutExportIntentState,
} from '../healthWorkoutExportStore';

beforeEach(() => {
  storage.data.clear();
  vi.clearAllMocks();
});

describe('health workout export store — persistence and recovery', () => {
  it('starts empty and not_configured for an uid never seen before', async () => {
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state).toMatchObject({ version: 1, platform: 'ios', enabledAtIso: null, lastIntent: 'not_configured', records: {} });
  });

  it('enqueues a record exactly once per executionId', async () => {
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-1', new Date('2026-05-01T00:00:00Z'));
    await markHealthWorkoutExportWriting('uid-1', 'ios', 'exec-1');
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-1', new Date('2026-05-01T00:00:00Z'));
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].attemptCount).toBe(1);
    expect(Object.keys(state.records)).toHaveLength(1);
  });

  it('recovers a crash mid-write (status "writing") as pending with an "interrupted" error on next read', async () => {
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-1', new Date('2026-05-01T00:00:00Z'));
    await markHealthWorkoutExportWriting('uid-1', 'ios', 'exec-1');
    // Simulate app restart: re-parse the persisted JSON from scratch.
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('pending');
    expect(state.records['exec-1'].lastErrorCode).toBe('interrupted');
  });

  it('marks success with the native record id and clears retry scheduling', async () => {
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-1', new Date('2026-05-01T00:00:00Z'));
    await markHealthWorkoutExportFailed('uid-1', 'ios', 'exec-1', {
      status: 'retryable_error', errorCode: 'native_error', nextAttemptAt: new Date('2026-05-01T01:00:00Z'),
    });
    const state = await markHealthWorkoutExportSucceeded('uid-1', 'ios', 'exec-1', 'native-abc');
    expect(state.records['exec-1']).toMatchObject({ status: 'succeeded', nativeRecordId: 'native-abc', nextAttemptAtIso: null, lastErrorCode: null });
  });

  it('never resurrects a succeeded or suppressed record via a failure report (idempotency floor)', async () => {
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-1', new Date('2026-05-01T00:00:00Z'));
    await markHealthWorkoutExportSucceeded('uid-1', 'ios', 'exec-1', 'native-abc');
    const state = await markHealthWorkoutExportFailed('uid-1', 'ios', 'exec-1', {
      status: 'retryable_error', errorCode: 'native_error', nextAttemptAt: null,
    });
    expect(state.records['exec-1'].status).toBe('succeeded');
  });

  it('suppresses all unfinished records and renews the cutoff on a disconnect→reconnect cycle, keeping successes', async () => {
    await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2026-01-01T00:00:00Z'));
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-done', new Date('2026-01-02T00:00:00Z'));
    await markHealthWorkoutExportSucceeded('uid-1', 'ios', 'exec-done', 'native-1');
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-pending', new Date('2026-01-03T00:00:00Z'));

    await setHealthWorkoutExportIntentState('uid-1', 'ios', 'disabled', new Date('2026-02-01T00:00:00Z'));
    const reconnected = await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2026-03-01T00:00:00Z'));

    expect(reconnected.enabledAtIso).toBe('2026-03-01T00:00:00.000Z');
    expect(reconnected.records['exec-done'].status).toBe('succeeded');
    expect(reconnected.records['exec-pending'].status).toBe('suppressed');
    expect(reconnected.records['exec-pending'].nextAttemptAtIso).toBeNull();
  });

  it('does not touch state when the intent is re-set to its current value', async () => {
    const first = await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2026-01-01T00:00:00Z'));
    const second = await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2026-06-01T00:00:00Z'));
    expect(second.enabledAtIso).toBe(first.enabledAtIso);
  });

  it('keeps per-uid and per-platform state fully isolated', async () => {
    await enqueueHealthWorkoutExport('uid-a', 'ios', 'exec-1', new Date('2026-01-01T00:00:00Z'));
    await enqueueHealthWorkoutExport('uid-b', 'ios', 'exec-1', new Date('2026-01-01T00:00:00Z'));
    await markHealthWorkoutExportSucceeded('uid-a', 'ios', 'exec-1', 'native-a');
    const stateA = await readHealthWorkoutExportState('uid-a', 'ios');
    const stateB = await readHealthWorkoutExportState('uid-b', 'ios');
    expect(stateA.records['exec-1'].status).toBe('succeeded');
    expect(stateB.records['exec-1'].status).toBe('pending');
  });

  it('discards corrupt or foreign-platform JSON instead of throwing', async () => {
    storage.data.set('ajfit.health-workout-export.v1:uid-1:ios', '{not json');
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records).toEqual({});
  });

  it('computes pending count across every non-terminal status and the latest success timestamp', async () => {
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-pending', new Date('2026-01-01T00:00:00Z'));
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-success-1', new Date('2026-01-01T00:00:00Z'));
    await markHealthWorkoutExportSucceeded('uid-1', 'ios', 'exec-success-1', 'n1', new Date('2026-01-05T00:00:00Z'));
    await enqueueHealthWorkoutExport('uid-1', 'ios', 'exec-success-2', new Date('2026-01-01T00:00:00Z'));
    await markHealthWorkoutExportSucceeded('uid-1', 'ios', 'exec-success-2', 'n2', new Date('2026-01-10T00:00:00Z'));
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(healthWorkoutExportPendingCount(state)).toBe(1);
    expect(healthWorkoutExportLastSuccess(state)).toEqual(new Date('2026-01-10T00:00:00Z'));
  });
});
