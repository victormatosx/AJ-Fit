import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex'),
}));

const platformState = vi.hoisted(() => ({ platform: 'ios' as 'ios' | 'android' | 'unsupported' }));
vi.mock('../healthIntegration', () => ({ getHealthPlatform: () => platformState.platform }));

const healthKit = vi.hoisted(() => ({
  isHealthDataAvailable: vi.fn(() => true),
  authorizationStatusFor: vi.fn(() => 2),
  queryWorkoutSamples: vi.fn(async (): Promise<{ uuid: string; dispose: () => void }[]> => []),
  saveWorkoutSample: vi.fn(),
  WorkoutActivityType: { traditionalStrengthTraining: 'traditionalStrengthTraining' },
}));
vi.mock('@kingstinct/react-native-healthkit', () => healthKit);

const healthConnect = vi.hoisted(() => ({
  initialize: vi.fn(async () => true),
  getSdkStatus: vi.fn(async () => 3),
  getGrantedPermissions: vi.fn(async () => [{ accessType: 'write', recordType: 'ExerciseSession' }]),
  insertRecords: vi.fn(async () => ['hc-record-1']),
  ExerciseType: { STRENGTH_TRAINING: 'STRENGTH_TRAINING' },
  RecordingMethod: { RECORDING_METHOD_ACTIVELY_RECORDED: 'RECORDING_METHOD_ACTIVELY_RECORDED' },
}));
vi.mock('react-native-health-connect', () => healthConnect);

import {
  HealthWorkoutNativeError,
  healthWorkoutModality,
  healthWorkoutNativeIdentity,
  validateHealthWorkoutNativePayload,
  writeHealthWorkout,
} from '../healthWorkoutNative';

function payload(overrides: Partial<Parameters<typeof writeHealthWorkout>[1]> = {}) {
  return {
    executionId: 'exec-1',
    sessionName: 'Treino A',
    startDate: new Date('2026-05-01T08:00:00Z'),
    endDate: new Date('2026-05-01T09:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platformState.platform = 'ios';
  healthKit.isHealthDataAvailable.mockReturnValue(true);
  healthKit.authorizationStatusFor.mockReturnValue(2);
  healthKit.queryWorkoutSamples.mockResolvedValue([]);
  healthKit.saveWorkoutSample.mockResolvedValue({ uuid: 'hk-uuid-1', dispose: vi.fn() });
  healthConnect.initialize.mockResolvedValue(true);
  healthConnect.getSdkStatus.mockResolvedValue(3);
  healthConnect.getGrantedPermissions.mockResolvedValue([{ accessType: 'write', recordType: 'ExerciseSession' }]);
  healthConnect.insertRecords.mockResolvedValue(['hc-record-1']);
});

describe('health workout native identity and payload validation', () => {
  it('derives a deterministic, platform/uid/execution-scoped UUID-shaped identity', async () => {
    const first = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-1');
    const second = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-1');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces different identities across uid, platform, and execution', async () => {
    const base = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-1');
    const otherUid = await healthWorkoutNativeIdentity('uid-2', 'ios', 'exec-1');
    const otherPlatform = await healthWorkoutNativeIdentity('uid-1', 'android', 'exec-1');
    const otherExecution = await healthWorkoutNativeIdentity('uid-1', 'ios', 'exec-2');
    expect(new Set([base, otherUid, otherPlatform, otherExecution]).size).toBe(4);
  });

  it('rejects a payload whose end is not strictly after its start, or with missing fields', () => {
    expect(validateHealthWorkoutNativePayload(payload())).toBe(true);
    expect(validateHealthWorkoutNativePayload(payload({ endDate: new Date('2026-05-01T08:00:00Z') }))).toBe(false);
    expect(validateHealthWorkoutNativePayload(payload({ endDate: new Date('2026-05-01T07:00:00Z') }))).toBe(false);
    expect(validateHealthWorkoutNativePayload(payload({ sessionName: '' }))).toBe(false);
    expect(validateHealthWorkoutNativePayload(payload({ executionId: '' }))).toBe(false);
  });

  it('maps strength training to the correct native activity value per platform', () => {
    expect(healthWorkoutModality('ios')).toMatchObject({ semantic: 'strength_training', nativeValue: 'traditionalStrengthTraining' });
    expect(healthWorkoutModality('android')).toMatchObject({ semantic: 'strength_training', nativeValue: 'STRENGTH_TRAINING' });
  });
});

describe('writeHealthWorkout — iOS (HealthKit)', () => {
  it('rejects when Apple Health is unavailable', async () => {
    healthKit.isHealthDataAvailable.mockReturnValue(false);
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects when workout sharing authorization is not granted', async () => {
    healthKit.authorizationStatusFor.mockReturnValue(0);
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'permission_required' });
  });

  it('writes a strength-training sample with real start/end times and deterministic sync metadata', async () => {
    const result = await writeHealthWorkout('uid-1', payload());
    expect(result).toMatchObject({ platform: 'ios', nativeRecordId: 'hk-uuid-1' });
    expect(healthKit.saveWorkoutSample).toHaveBeenCalledWith(
      'traditionalStrengthTraining',
      [],
      payload().startDate,
      payload().endDate,
      undefined,
      expect.objectContaining({ HKSyncIdentifier: result.nativeIdentity, HKSyncVersion: 1 }),
    );
  });

  it('reconciles idempotently: an existing sample tagged with the same HKSyncIdentifier short-circuits the write', async () => {
    const dispose = vi.fn();
    healthKit.queryWorkoutSamples.mockResolvedValue([{ uuid: 'existing-uuid', dispose }]);
    const result = await writeHealthWorkout('uid-1', payload());
    expect(result.nativeRecordId).toBe('existing-uuid');
    expect(healthKit.saveWorkoutSample).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });

  it('surfaces a native_error without inventing a record id when HealthKit rejects the write', async () => {
    healthKit.saveWorkoutSample.mockRejectedValue(new Error('rejected'));
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'native_error' });
  });
});

describe('writeHealthWorkout — Android (Health Connect)', () => {
  beforeEach(() => { platformState.platform = 'android'; });

  it('rejects when Health Connect is unavailable', async () => {
    healthConnect.getSdkStatus.mockResolvedValue(1);
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects when ExerciseSession write permission is missing', async () => {
    healthConnect.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'ExerciseSession' }]);
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'permission_required' });
  });

  it('writes an ExerciseSession record with a deterministic clientRecordId for native idempotency', async () => {
    const result = await writeHealthWorkout('uid-1', payload());
    expect(result).toMatchObject({ platform: 'android', nativeRecordId: 'hc-record-1' });
    expect(healthConnect.insertRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        recordType: 'ExerciseSession',
        exerciseType: 'STRENGTH_TRAINING',
        startTime: payload().startDate.toISOString(),
        endTime: payload().endDate.toISOString(),
        metadata: expect.objectContaining({ clientRecordId: result.nativeIdentity, clientRecordVersion: 1 }),
      }),
    ]);
  });

  it('surfaces a native_error when Health Connect rejects the insert', async () => {
    healthConnect.insertRecords.mockRejectedValue(new Error('rejected'));
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toMatchObject({ code: 'native_error' });
  });
});

describe('writeHealthWorkout — platform guard', () => {
  it('rejects immediately on an unsupported platform without touching either native module', async () => {
    platformState.platform = 'unsupported';
    await expect(writeHealthWorkout('uid-1', payload())).rejects.toBeInstanceOf(HealthWorkoutNativeError);
    expect(healthKit.saveWorkoutSample).not.toHaveBeenCalled();
    expect(healthConnect.insertRecords).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload before any native call', async () => {
    await expect(writeHealthWorkout('uid-1', payload({ sessionName: '' }))).rejects.toMatchObject({ code: 'native_error' });
    expect(healthKit.saveWorkoutSample).not.toHaveBeenCalled();
  });
});
