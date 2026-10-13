import { createHash } from 'node:crypto';
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

const platformState = vi.hoisted(() => ({ platform: 'ios' as 'ios' | 'android' | 'unsupported' }));
vi.mock('../healthIntegration', () => ({ getHealthPlatform: () => platformState.platform }));

const intentState = vi.hoisted(() => ({ intent: 'enabled' as 'not_configured' | 'enabled' | 'disabled' }));
vi.mock('../healthIntegrationPreferences', () => ({
  readHealthIntegrationIntent: vi.fn(async () => intentState.intent),
  getLastKnownHealthIntegrationIntent: vi.fn(() => intentState.intent),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex'),
}));

const FakeHealthWorkoutNativeError = vi.hoisted(() => class FakeHealthWorkoutNativeError extends Error {
  code: 'permission_required' | 'unavailable' | 'native_error';
  constructor(code: 'permission_required' | 'unavailable' | 'native_error', message: string) {
    super(message);
    this.name = 'HealthWorkoutNativeError';
    this.code = code;
  }
});
const native = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('../healthWorkoutNative', async () => {
  const actual = await vi.importActual<typeof import('../healthWorkoutNative')>('../healthWorkoutNative');
  return {
    HealthWorkoutNativeError: FakeHealthWorkoutNativeError,
    writeHealthWorkout: native.write,
    healthWorkoutNativeIdentity: actual.healthWorkoutNativeIdentity,
  };
});

const executions = vi.hoisted(() => ({
  loadWorkoutExecution: vi.fn(),
  listWorkoutExecutionsFinishedSince: vi.fn(async () => []),
}));
vi.mock('../workoutExecutions', () => executions);

const schedule = vi.hoisted(() => ({ hasScheduledSessionCompletion: vi.fn(async () => true) }));
vi.mock('../workoutSchedule', () => schedule);

import {
  exportConfirmedHealthWorkoutExecution,
  isTerminalHealthWorkoutExecution,
  processHealthWorkoutExports,
  queueConfirmedHealthWorkoutExecution,
} from '../healthWorkoutExport';
import { healthWorkoutNativeIdentity } from '../healthWorkoutNative';
import { readHealthWorkoutExportState, setHealthWorkoutExportIntentState } from '../healthWorkoutExportStore';

function timestamp(iso: string) {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'exec-1',
    programId: 'program-1',
    sessionIndex: 0,
    sessionName: 'Treino A',
    scheduledLocalDate: '2030-05-01',
    status: 'COMPLETED',
    startedAt: timestamp('2030-05-01T08:00:00Z'),
    finishedAt: timestamp('2030-05-01T09:00:00Z'),
    completion: { plannedSets: 10, completedSets: 10, percentageBasisPoints: 10_000 },
    ...overrides,
  } as never;
}

beforeEach(() => {
  storage.data.clear();
  vi.clearAllMocks();
  platformState.platform = 'ios';
  intentState.intent = 'enabled';
  schedule.hasScheduledSessionCompletion.mockResolvedValue(true);
  executions.listWorkoutExecutionsFinishedSince.mockResolvedValue([]);
  native.write.mockResolvedValue({ platform: 'ios', nativeIdentity: 'native-id-1', nativeRecordId: 'native-record-1' });
});

describe('isTerminalHealthWorkoutExecution', () => {
  it('accepts COMPLETED and PARTIALLY_COMPLETED with a completion summary and a valid payload', () => {
    expect(isTerminalHealthWorkoutExecution(execution())).toBe(true);
    expect(isTerminalHealthWorkoutExecution(execution({ status: 'PARTIALLY_COMPLETED' }))).toBe(true);
  });

  it('rejects IN_PROGRESS and ABANDONED regardless of other fields', () => {
    expect(isTerminalHealthWorkoutExecution(execution({ status: 'IN_PROGRESS' }))).toBe(false);
    expect(isTerminalHealthWorkoutExecution(execution({ status: 'ABANDONED' }))).toBe(false);
  });

  it('rejects a terminal status missing the completion summary', () => {
    expect(isTerminalHealthWorkoutExecution(execution({ completion: undefined }))).toBe(false);
  });

  it('rejects when end is not after start or finishedAt is absent', () => {
    expect(isTerminalHealthWorkoutExecution(execution({ finishedAt: null }))).toBe(false);
    expect(isTerminalHealthWorkoutExecution(execution({ finishedAt: timestamp('2030-05-01T07:00:00Z') }))).toBe(false);
  });
});

describe('queueConfirmedHealthWorkoutExecution — gating before any native write', () => {
  it('does nothing when the user has not enabled export', async () => {
    intentState.intent = 'disabled';
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
  });

  it('does nothing for an execution still IN_PROGRESS (optimistic UI state is never enough)', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ status: 'IN_PROGRESS', finishedAt: null }));
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
  });

  it('does nothing for an ABANDONED execution', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ status: 'ABANDONED' }));
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
  });

  it('does nothing when the deterministic schedule authority has not confirmed completion', async () => {
    schedule.hasScheduledSessionCompletion.mockResolvedValue(false);
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
  });

  it('queues a COMPLETED execution once both Firestore terminal state and schedule authority agree', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(true);
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('pending');
  });

  it('queues a PARTIALLY_COMPLETED execution the same as COMPLETED', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ status: 'PARTIALLY_COMPLETED' }));
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(true);
  });

  it('does not re-queue an execution that was already enqueued (idempotent across repeated finish callbacks)', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(Object.keys(state.records)).toHaveLength(1);
  });

  it('never queues a workout finished before the current enabled cutoff (no silent historical backfill)', async () => {
    await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2030-06-01T00:00:00Z'));
    executions.loadWorkoutExecution.mockResolvedValue(execution({ finishedAt: timestamp('2030-05-01T09:00:00Z') }));
    expect(await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1')).toBe(false);
  });

  it('cancels mid-flight when shouldContinue turns false (UID switch / logout safety)', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await expect(queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1', () => false)).rejects.toThrow();
  });
});

describe('exportConfirmedHealthWorkoutExecution — native write after confirmation', () => {
  it('writes to the native store only after queueing succeeds, then marks the record succeeded', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    const result = await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'success', exported: 1 });
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1']).toMatchObject({ status: 'succeeded', nativeRecordId: 'native-record-1' });
  });

  it('exports a PARTIALLY_COMPLETED execution through the exact same confirmed-finish path as COMPLETED', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ status: 'PARTIALLY_COMPLETED' }));
    const result = await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'success', exported: 1 });
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('succeeded');
  });

  it('passes real start/end times and the trimmed session name through to the native write', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ sessionName: '  Treino B  ' }));
    await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(native.write).toHaveBeenCalledWith('uid-1', expect.objectContaining({
      executionId: 'exec-1',
      sessionName: 'Treino B',
      startDate: new Date('2030-05-01T08:00:00Z'),
      endDate: new Date('2030-05-01T09:00:00Z'),
    }));
  });

  it('is idempotent: repeating the finish callback after success never writes to the native store again', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(native.write).toHaveBeenCalledTimes(1);
  });

  it('never exports before authoritative confirmation arrives', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution({ status: 'IN_PROGRESS', finishedAt: null }));
    await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(native.write).not.toHaveBeenCalled();
  });

  it('recovers via reconciliation when the callable response was lost but the backend confirmed completion', async () => {
    // Simulate the app restarting before the fast-path queue ever ran: nothing
    // queued yet, but the backend already wrote a terminal execution.
    executions.listWorkoutExecutionsFinishedSince.mockResolvedValue([execution()]);
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await setHealthWorkoutExportIntentState('uid-1', 'ios', 'enabled', new Date('2030-01-01T00:00:00Z'));
    const result = await processHealthWorkoutExports('uid-1', { reconcile: true });
    expect(result).toMatchObject({ status: 'success', exported: 1 });
    expect(native.write).toHaveBeenCalledTimes(1);
  });

  it('survives a simulated app restart: a persisted pending record is picked up without re-queueing', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    // "Restart": a brand-new process would call processHealthWorkoutExports
    // straight from persisted state, with no in-memory queue.
    const result = await processHealthWorkoutExports('uid-1', { reconcile: false });
    expect(result).toMatchObject({ status: 'success', exported: 1 });
  });
});

describe('native failure handling, permissions, and retries', () => {
  it('schedules a retry on a generic native failure without losing the record', async () => {
    native.write.mockRejectedValue(new FakeHealthWorkoutNativeError('native_error', 'boom'));
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    const result = await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(result).toMatchObject({ status: 'error', pending: 1 });
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('retryable_error');
    expect(state.records['exec-1'].nextAttemptAtIso).not.toBeNull();
  });

  it('does not retry a retryable_error before its scheduled time unless forced', async () => {
    native.write.mockRejectedValueOnce(new FakeHealthWorkoutNativeError('native_error', 'boom'));
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    native.write.mockResolvedValue({ platform: 'ios', nativeIdentity: 'native-id-1', nativeRecordId: 'native-record-1' });
    await processHealthWorkoutExports('uid-1', { force: false, reconcile: false });
    expect(native.write).toHaveBeenCalledTimes(1);
    await processHealthWorkoutExports('uid-1', { force: true, reconcile: false });
    expect(native.write).toHaveBeenCalledTimes(2);
  });

  it('surfaces permission_required distinctly and schedules a retry', async () => {
    native.write.mockRejectedValue(new FakeHealthWorkoutNativeError('permission_required', 'no perms'));
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    const result = await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(result?.status).toBe('permission_required');
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('permission_required');
  });

  it('surfaces unavailable distinctly and schedules a retry', async () => {
    native.write.mockRejectedValue(new FakeHealthWorkoutNativeError('unavailable', 'not there'));
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    const result = await exportConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    expect(result?.status).toBe('unavailable');
  });

  it('blocks and does not retry an execution whose payload is structurally invalid', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    executions.loadWorkoutExecution.mockResolvedValue(execution({ sessionName: '' }));
    const result = await processHealthWorkoutExports('uid-1', { force: true, reconcile: false });
    expect(result.status).toBe('error');
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('blocked_invalid');
    await processHealthWorkoutExports('uid-1', { force: true, reconcile: false });
    expect(native.write).not.toHaveBeenCalled();
  });

  it('stops dispatching further records in the same run once one provider-level failure occurs', async () => {
    executions.loadWorkoutExecution.mockImplementation(async (_uid: string, executionId: string) =>
      execution({ executionId }));
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-2');
    native.write.mockRejectedValue(new FakeHealthWorkoutNativeError('permission_required', 'no perms'));
    await processHealthWorkoutExports('uid-1', { reconcile: false });
    expect(native.write).toHaveBeenCalledTimes(1);
  });
});

describe('account switching, logout, and disconnect', () => {
  it('does not export anything for an account with no enabled intent', async () => {
    intentState.intent = 'not_configured';
    const result = await processHealthWorkoutExports('uid-1', { reconcile: true });
    expect(result.status).toBe('no_data');
    expect(native.write).not.toHaveBeenCalled();
  });

  it('stops dispatching while disconnected, without exporting the still-pending record', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    intentState.intent = 'disabled';
    const result = await processHealthWorkoutExports('uid-1', { reconcile: false });
    expect(native.write).not.toHaveBeenCalled();
    expect(result.status).toBe('no_data');
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('pending');
  });

  it('suppresses the stale pending record (instead of silently exporting it) on the next reconnect', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    intentState.intent = 'disabled';
    await processHealthWorkoutExports('uid-1', { reconcile: false });
    intentState.intent = 'enabled';
    await processHealthWorkoutExports('uid-1', { reconcile: false });
    expect(native.write).not.toHaveBeenCalled();
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('suppressed');
  });

  it('finishes a native write already in flight when disabled mid-run, but refuses to start the next one', async () => {
    executions.loadWorkoutExecution.mockImplementation(async (_uid: string, executionId: string) =>
      execution({ executionId }));
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-1');
    await queueConfirmedHealthWorkoutExecution('uid-1', 'exec-2');
    let resolveFirstWrite: ((value: { platform: 'ios'; nativeIdentity: string; nativeRecordId: string }) => void) | undefined;
    native.write.mockImplementationOnce(() => new Promise((resolve) => { resolveFirstWrite = resolve; }));
    const run = processHealthWorkoutExports('uid-1', { reconcile: false });
    await vi.waitFor(() => expect(native.write).toHaveBeenCalledTimes(1));
    // The user disconnects while exec-1's native write is still pending —
    // the write already handed to the OS is never aborted (no cancellation
    // API exists), but exec-2 must never be dispatched afterward.
    intentState.intent = 'disabled';
    resolveFirstWrite?.({ platform: 'ios', nativeIdentity: 'native-id-1', nativeRecordId: 'native-record-1' });
    await run;
    expect(native.write).toHaveBeenCalledTimes(1);
    const state = await readHealthWorkoutExportState('uid-1', 'ios');
    expect(state.records['exec-1'].status).toBe('succeeded');
    expect(state.records['exec-2'].status).toBe('pending');
  });

  it('keeps separate accounts fully isolated on the same device/platform', async () => {
    executions.loadWorkoutExecution.mockResolvedValue(execution());
    await queueConfirmedHealthWorkoutExecution('uid-a', 'exec-1');
    const stateB = await readHealthWorkoutExportState('uid-b', 'ios');
    expect(stateB.records).toEqual({});
  });
});

describe('deterministic native identity reuse', () => {
  it('derives the same native identity for a given uid/platform/execution every time', async () => {
    const first = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-1');
    const second = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-1');
    expect(first).toBe(second);
  });
});
