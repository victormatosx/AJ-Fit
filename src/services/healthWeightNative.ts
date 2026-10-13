import { Platform } from 'react-native';

import type { HealthWeightSample } from '../types/healthWeightSync';
import { HEALTH_WEIGHT_PAGE_SIZE } from '../types/healthWeightSync';

export type HealthWeightNativeErrorCode = 'permission_required' | 'unavailable' | 'native_error';

export class HealthWeightNativeError extends Error {
  constructor(
    readonly code: HealthWeightNativeErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HealthWeightNativeError';
  }
}

type IosWeightLike = {
  uuid?: unknown;
  quantity?: unknown;
  startDate?: unknown;
  sourceRevision?: { source?: { bundleIdentifier?: unknown } };
};

type AndroidWeightLike = {
  recordType?: unknown;
  time?: unknown;
  weight?: { inKilograms?: unknown };
  metadata?: { id?: unknown; dataOrigin?: unknown };
};

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Pure normalization helpers are exported so native edge cases stay unit-testable. */
export function normalizeIosWeightSample(raw: IosWeightLike): HealthWeightSample | null {
  const measuredAt = validDate(raw.startDate);
  if (typeof raw.uuid !== 'string' || raw.uuid.length === 0 || !measuredAt || typeof raw.quantity !== 'number') return null;
  const bundle = raw.sourceRevision?.source?.bundleIdentifier;
  return {
    platform: 'ios',
    sourceId: raw.uuid,
    sourceApp: typeof bundle === 'string' && bundle.length > 0 ? bundle : null,
    measuredAt,
    weightKg: raw.quantity,
  };
}

export function normalizeAndroidWeightRecord(raw: AndroidWeightLike): HealthWeightSample | null {
  const measuredAt = validDate(raw.time);
  const id = raw.metadata?.id;
  const kg = raw.weight?.inKilograms;
  if (raw.recordType != null && raw.recordType !== 'Weight') return null;
  if (typeof id !== 'string' || id.length === 0 || !measuredAt || typeof kg !== 'number') return null;
  const origin = raw.metadata?.dataOrigin;
  return {
    platform: 'android',
    sourceId: id,
    sourceApp: typeof origin === 'string' && origin.length > 0 ? origin : null,
    measuredAt,
    weightKg: kg,
  };
}

export type NativeWeightChangePage = {
  samples: HealthWeightSample[];
  deletedSourceIds: string[];
  nextCursor: string;
  hasMore: boolean;
  cursorExpired: boolean;
};

export async function readIosWeightChanges(
  historyStart: Date,
  cursor: string | null,
): Promise<NativeWeightChangePage> {
  if (Platform.OS !== 'ios') throw new HealthWeightNativeError('unavailable', 'HealthKit is unavailable.');
  try {
    const HealthKit = await import('@kingstinct/react-native-healthkit');
    if (!HealthKit.isHealthDataAvailable()) {
      throw new HealthWeightNativeError('unavailable', 'HealthKit is unavailable.');
    }
    const page = await HealthKit.queryQuantitySamplesWithAnchor('HKQuantityTypeIdentifierBodyMass', {
      limit: HEALTH_WEIGHT_PAGE_SIZE,
      anchor: cursor ?? undefined,
      unit: 'kg',
      filter: { date: { startDate: historyStart, strictStartDate: true } },
    });
    const samples = page.samples
      .map((sample) => normalizeIosWeightSample(sample))
      .filter((sample): sample is HealthWeightSample => sample != null);
    const deletedSourceIds = page.deletedSamples
      .map((sample) => sample.uuid)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return {
      samples,
      deletedSourceIds,
      nextCursor: page.newAnchor,
      hasMore: page.samples.length + page.deletedSamples.length >= HEALTH_WEIGHT_PAGE_SIZE,
      cursorExpired: false,
    };
  } catch (cause) {
    if (cause instanceof HealthWeightNativeError) throw cause;
    throw new HealthWeightNativeError('native_error', 'Could not read HealthKit weight samples.', cause);
  }
}

async function assertAndroidWeightPermission(): Promise<typeof import('react-native-health-connect')> {
  if (Platform.OS !== 'android') {
    throw new HealthWeightNativeError('unavailable', 'Health Connect is unavailable.');
  }
  try {
    const HealthConnect = await import('react-native-health-connect');
    if (!(await HealthConnect.initialize())) {
      throw new HealthWeightNativeError('unavailable', 'Health Connect is unavailable.');
    }
    const granted = await HealthConnect.getGrantedPermissions();
    const canReadWeight = granted.some(
      (permission) => permission.accessType === 'read' && permission.recordType === 'Weight',
    );
    if (!canReadWeight) {
      throw new HealthWeightNativeError('permission_required', 'Weight read permission is not granted.');
    }
    return HealthConnect;
  } catch (cause) {
    if (cause instanceof HealthWeightNativeError) throw cause;
    throw new HealthWeightNativeError('native_error', 'Could not access Health Connect.', cause);
  }
}

export async function readAndroidWeightHistoryPage(
  historyStart: Date,
  pageToken?: string,
): Promise<{ samples: HealthWeightSample[]; nextPageToken: string | null }> {
  const HealthConnect = await assertAndroidWeightPermission();
  try {
    const page = await HealthConnect.readRecords('Weight', {
      timeRangeFilter: { operator: 'after', startTime: historyStart.toISOString() },
      ascendingOrder: true,
      pageSize: HEALTH_WEIGHT_PAGE_SIZE,
      pageToken,
    });
    return {
      samples: page.records
        .map((record) => normalizeAndroidWeightRecord({ ...record, recordType: 'Weight' }))
        .filter((sample): sample is HealthWeightSample => sample != null),
      nextPageToken: page.pageToken ?? null,
    };
  } catch (cause) {
    throw new HealthWeightNativeError('native_error', 'Could not read Health Connect weight history.', cause);
  }
}

export async function readAndroidWeightChanges(cursor: string | null): Promise<NativeWeightChangePage> {
  const HealthConnect = await assertAndroidWeightPermission();
  try {
    const page = await HealthConnect.getChanges(
      cursor ? { changesToken: cursor } : { recordTypes: ['Weight'] },
    );
    return {
      samples: page.upsertionChanges
        .map(({ record }) => normalizeAndroidWeightRecord(record))
        .filter((sample): sample is HealthWeightSample => sample != null),
      deletedSourceIds: page.deletionChanges
        .map(({ recordId }) => recordId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      nextCursor: page.nextChangesToken,
      hasMore: page.hasMore,
      cursorExpired: page.changesTokenExpired,
    };
  } catch (cause) {
    if (cause instanceof HealthWeightNativeError) throw cause;
    throw new HealthWeightNativeError('native_error', 'Could not read Health Connect changes.', cause);
  }
}
