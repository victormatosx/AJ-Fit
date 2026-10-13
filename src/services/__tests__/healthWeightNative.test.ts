import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(),
}));

const platform = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' }));
vi.mock('react-native', () => ({ Platform: platform }));

const healthKit = vi.hoisted(() => ({
  isHealthDataAvailable: vi.fn(() => true),
  queryQuantitySamplesWithAnchor: vi.fn(),
}));
vi.mock('@kingstinct/react-native-healthkit', () => healthKit);

const healthConnect = vi.hoisted(() => ({
  initialize: vi.fn(async () => true),
  getGrantedPermissions: vi.fn(async () => [{ accessType: 'read', recordType: 'Weight' }]),
  readRecords: vi.fn(),
  getChanges: vi.fn(),
}));
vi.mock('react-native-health-connect', () => healthConnect);

import {
  HealthWeightNativeError,
  normalizeAndroidWeightRecord,
  normalizeIosWeightSample,
  readAndroidWeightChanges,
  readAndroidWeightHistoryPage,
  readIosWeightChanges,
} from '../healthWeightNative';

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
  healthKit.isHealthDataAvailable.mockReturnValue(true);
  healthConnect.initialize.mockResolvedValue(true);
  healthConnect.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'Weight' }]);
});

describe('health native weight normalization', () => {
  it('normalizes HealthKit kilograms, timestamp, id, and bundle origin', () => {
    expect(normalizeIosWeightSample({
      uuid: 'hk-1',
      quantity: 73.25,
      startDate: new Date('2026-05-01T12:30:00Z'),
      sourceRevision: { source: { bundleIdentifier: 'com.apple.Health' } },
    })).toMatchObject({
      platform: 'ios',
      sourceId: 'hk-1',
      sourceApp: 'com.apple.Health',
      weightKg: 73.25,
      measuredAt: new Date('2026-05-01T12:30:00Z'),
    });
  });

  it('normalizes Health Connect MassResult in kilograms', () => {
    expect(normalizeAndroidWeightRecord({
      recordType: 'Weight',
      time: '2026-05-01T12:30:00Z',
      weight: { inKilograms: 80.5 },
      metadata: { id: 'hc-1', dataOrigin: 'com.vendor.scale' },
    })).toMatchObject({ platform: 'android', sourceId: 'hc-1', sourceApp: 'com.vendor.scale', weightKg: 80.5 });
  });

  it('rejects invalid timestamp/id/unit values rather than fabricating a sample', () => {
    expect(normalizeIosWeightSample({ uuid: '', quantity: 70, startDate: 'bad' })).toBeNull();
    expect(normalizeAndroidWeightRecord({ time: 'bad', weight: { inKilograms: 70 }, metadata: {} })).toBeNull();
  });
});

describe('native reads', () => {
  it('reads an anchored HealthKit page in kg and does not interpret an empty result as denied', async () => {
    healthKit.queryQuantitySamplesWithAnchor.mockResolvedValue({ samples: [], deletedSamples: [], newAnchor: 'anchor-1' });
    await expect(readIosWeightChanges(new Date('2026-01-01Z'), null)).resolves.toEqual({
      samples: [], deletedSourceIds: [], nextCursor: 'anchor-1', hasMore: false, cursorExpired: false,
    });
    expect(healthKit.queryQuantitySamplesWithAnchor).toHaveBeenCalledWith(
      'HKQuantityTypeIdentifierBodyMass',
      expect.objectContaining({ unit: 'kg', limit: 200 }),
    );
  });

  it('paginates Health Connect history and preserves its page token', async () => {
    platform.OS = 'android';
    healthConnect.readRecords.mockResolvedValue({ records: [], pageToken: 'page-2' });
    await expect(readAndroidWeightHistoryPage(new Date('2026-01-01Z'))).resolves.toEqual({
      samples: [], nextPageToken: 'page-2',
    });
  });

  it('returns a typed permission error when Android weight access was revoked', async () => {
    platform.OS = 'android';
    healthConnect.getGrantedPermissions.mockResolvedValue([]);
    const rejection = readAndroidWeightChanges('token');
    await expect(rejection).rejects.toBeInstanceOf(HealthWeightNativeError);
    await rejection.catch((error: HealthWeightNativeError) => expect(error.code).toBe('permission_required'));
  });

  it('preserves Android change pagination and token expiry signals', async () => {
    platform.OS = 'android';
    healthConnect.getChanges.mockResolvedValue({
      upsertionChanges: [], deletionChanges: [], nextChangesToken: 'next', hasMore: true, changesTokenExpired: true,
    });
    await expect(readAndroidWeightChanges('old')).resolves.toMatchObject({
      nextCursor: 'next', hasMore: true, cursorExpired: true,
    });
  });
});
