import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import { logWarn } from '../lib/logger';
import type {
  HealthWorkoutExportErrorCode,
  HealthWorkoutExportPlatform,
  HealthWorkoutNativePayload,
} from '../types/healthWorkoutExport';
import { getHealthPlatform } from './healthIntegration';

export class HealthWorkoutNativeError extends Error {
  constructor(
    readonly code: Extract<HealthWorkoutExportErrorCode, 'permission_required' | 'unavailable' | 'native_error'>,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HealthWorkoutNativeError';
  }
}

/**
 * A deterministic UUID-shaped 128-bit identifier. Health Connect recommends
 * client-provided record IDs and HealthKit's sync metadata accepts strings;
 * the UUID shape stays within conservative native length limits while the
 * hash keeps the uid/execution identity opaque to the health store UI.
 */
export async function healthWorkoutNativeIdentity(
  uid: string,
  platform: HealthWorkoutExportPlatform,
  executionId: string,
): Promise<string> {
  const digest = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([1, 'ajfit-workout', uid, platform, executionId]),
  );
  const chars = digest.slice(0, 32).toLowerCase().split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function validateHealthWorkoutNativePayload(payload: HealthWorkoutNativePayload): boolean {
  return payload.executionId.length > 0
    && payload.sessionName.length > 0
    && !Number.isNaN(payload.startDate.getTime())
    && !Number.isNaN(payload.endDate.getTime())
    && payload.endDate.getTime() > payload.startDate.getTime();
}

export function healthWorkoutModality(platform: HealthWorkoutExportPlatform): {
  semantic: 'strength_training';
  nativeValue: 'traditionalStrengthTraining' | 'STRENGTH_TRAINING';
} {
  return platform === 'ios'
    ? { semantic: 'strength_training', nativeValue: 'traditionalStrengthTraining' }
    : { semantic: 'strength_training', nativeValue: 'STRENGTH_TRAINING' };
}

async function writeIosWorkout(
  nativeIdentity: string,
  payload: HealthWorkoutNativePayload,
): Promise<string> {
  const HealthKit = await import('@kingstinct/react-native-healthkit');
  if (!HealthKit.isHealthDataAvailable()) {
    throw new HealthWorkoutNativeError('unavailable', 'Apple Health is unavailable.');
  }
  const authorization = HealthKit.authorizationStatusFor('HKWorkoutTypeIdentifier');
  if (authorization !== 2) {
    throw new HealthWorkoutNativeError('permission_required', 'Workout sharing is not authorized.');
  }

  // Best-effort reconciliation for the crash window after HealthKit saved
  // the workout but before AsyncStorage recorded success. A write-only grant
  // may legitimately make this query return no results; HKSyncIdentifier /
  // HKSyncVersion remain the native idempotency authority in that case.
  try {
    const existing = await HealthKit.queryWorkoutSamples({
      limit: 1,
      filter: {
        metadata: {
          withMetadataKey: 'HKSyncIdentifier',
          operatorType: 4,
          value: nativeIdentity,
        },
      },
    });
    const existingId = existing[0]?.uuid;
    existing.forEach((workout) => workout.dispose());
    if (existingId) return existingId;
  } catch (cause) {
    logWarn('health_workout_export', 'ios_reconciliation_query_failed', { cause });
  }

  try {
    const workout = await HealthKit.saveWorkoutSample(
      HealthKit.WorkoutActivityType.traditionalStrengthTraining,
      [],
      payload.startDate,
      payload.endDate,
      undefined,
      {
        HKSyncIdentifier: nativeIdentity,
        HKSyncVersion: 1,
        HKWorkoutBrandName: 'AJ Fit',
      },
    );
    const nativeRecordId = workout.uuid || nativeIdentity;
    workout.dispose();
    return nativeRecordId;
  } catch (cause) {
    throw new HealthWorkoutNativeError('native_error', 'Apple Health rejected the workout write.', cause);
  }
}

async function writeAndroidWorkout(
  nativeIdentity: string,
  payload: HealthWorkoutNativePayload,
): Promise<string> {
  const HealthConnect = await import('react-native-health-connect');
  const initialized = await HealthConnect.initialize();
  if (!initialized || await HealthConnect.getSdkStatus() !== 3) {
    throw new HealthWorkoutNativeError('unavailable', 'Health Connect is unavailable.');
  }
  const granted = await HealthConnect.getGrantedPermissions();
  if (!granted.some((permission) =>
    permission.accessType === 'write' && permission.recordType === 'ExerciseSession')) {
    throw new HealthWorkoutNativeError('permission_required', 'Exercise write permission is not granted.');
  }

  try {
    const ids = await HealthConnect.insertRecords([{
      recordType: 'ExerciseSession',
      exerciseType: HealthConnect.ExerciseType.STRENGTH_TRAINING,
      startTime: payload.startDate.toISOString(),
      endTime: payload.endDate.toISOString(),
      title: payload.sessionName,
      metadata: {
        clientRecordId: nativeIdentity,
        clientRecordVersion: 1,
        recordingMethod: HealthConnect.RecordingMethod.RECORDING_METHOD_ACTIVELY_RECORDED,
      },
    }]);
    return ids[0] || nativeIdentity;
  } catch (cause) {
    throw new HealthWorkoutNativeError('native_error', 'Health Connect rejected the workout write.', cause);
  }
}

export async function writeHealthWorkout(
  uid: string,
  payload: HealthWorkoutNativePayload,
): Promise<{ platform: HealthWorkoutExportPlatform; nativeIdentity: string; nativeRecordId: string }> {
  const platform = getHealthPlatform();
  if (platform === 'unsupported') {
    throw new HealthWorkoutNativeError('unavailable', 'Health integration is unsupported.');
  }
  if (!validateHealthWorkoutNativePayload(payload)) {
    throw new HealthWorkoutNativeError('native_error', 'Invalid workout payload.');
  }
  const nativeIdentity = await healthWorkoutNativeIdentity(uid, platform, payload.executionId);
  const nativeRecordId = platform === 'ios'
    ? await writeIosWorkout(nativeIdentity, payload)
    : await writeAndroidWorkout(nativeIdentity, payload);
  return { platform, nativeIdentity, nativeRecordId };
}

