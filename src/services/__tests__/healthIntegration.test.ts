import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' | 'web' }));
const linking = vi.hoisted(() => ({
  canOpenURL: vi.fn(async () => true),
  openURL: vi.fn(async () => undefined),
  openSettings: vi.fn(async () => undefined),
}));
vi.mock('react-native', () => ({
  Platform: platform,
  Linking: linking,
}));

const healthKitMock = vi.hoisted(() => ({
  isHealthDataAvailable: vi.fn(() => true),
  requestAuthorization: vi.fn(async () => true),
}));
vi.mock('@kingstinct/react-native-healthkit', () => healthKitMock);

const healthConnectMock = vi.hoisted(() => ({
  getSdkStatus: vi.fn(async () => 3),
  initialize: vi.fn(async () => true),
  requestPermission: vi.fn(async (): Promise<{ accessType: string; recordType: string }[]> => [
    { accessType: 'read', recordType: 'Weight' },
  ]),
  getGrantedPermissions: vi.fn(async (): Promise<{ accessType: string; recordType: string }[]> => []),
  openHealthConnectSettings: vi.fn(),
}));
vi.mock('react-native-health-connect', () => healthConnectMock);

const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('../../lib/logger', () => ({ logInfo: logs.info, logError: logs.error }));

import { HealthIntegrationError } from '../../types/healthIntegration';
import {
  checkHealthAvailability,
  getGrantedHealthPermissions,
  getHealthPlatform,
  openNativeHealthSettings,
  requestHealthPermissions,
} from '../healthIntegration';

beforeEach(() => {
  platform.OS = 'ios';
  vi.clearAllMocks();
  healthKitMock.isHealthDataAvailable.mockReturnValue(true);
  healthKitMock.requestAuthorization.mockResolvedValue(true);
  healthConnectMock.getSdkStatus.mockResolvedValue(3);
  healthConnectMock.initialize.mockResolvedValue(true);
  healthConnectMock.requestPermission.mockResolvedValue([{ accessType: 'read', recordType: 'Weight' }]);
  healthConnectMock.getGrantedPermissions.mockResolvedValue([]);
  linking.canOpenURL.mockResolvedValue(true);
});

describe('getHealthPlatform', () => {
  it('maps ios/android and falls back to unsupported', () => {
    platform.OS = 'ios';
    expect(getHealthPlatform()).toBe('ios');
    platform.OS = 'android';
    expect(getHealthPlatform()).toBe('android');
    platform.OS = 'web';
    expect(getHealthPlatform()).toBe('unsupported');
  });
});

describe('checkHealthAvailability', () => {
  it('iOS: available when HealthKit reports data available', async () => {
    platform.OS = 'ios';
    healthKitMock.isHealthDataAvailable.mockReturnValue(true);
    await expect(checkHealthAvailability()).resolves.toEqual({ status: 'available' });
  });

  it('iOS: unavailable when HealthKit reports no data', async () => {
    platform.OS = 'ios';
    healthKitMock.isHealthDataAvailable.mockReturnValue(false);
    await expect(checkHealthAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider_missing',
    });
  });

  it.each([
    [3, { status: 'available' }],
    [1, { status: 'unavailable', reason: 'provider_missing' }],
    [2, { status: 'unavailable', reason: 'provider_update_required' }],
  ] as const)('Android: SDK status %i maps correctly', async (sdkStatus, expected) => {
    platform.OS = 'android';
    healthConnectMock.getSdkStatus.mockResolvedValue(sdkStatus);
    await expect(checkHealthAvailability()).resolves.toEqual(expected);
  });

  it('Android: unknown SDK status is reported as check_failed, not silently available', async () => {
    platform.OS = 'android';
    healthConnectMock.getSdkStatus.mockResolvedValue(99);
    const result = await checkHealthAvailability();
    expect(result.status).toBe('unavailable');
    expect(result).toMatchObject({ reason: 'check_failed' });
  });

  it('unsupported platform short-circuits without touching either native module', async () => {
    platform.OS = 'web';
    await expect(checkHealthAvailability()).resolves.toEqual({ status: 'unsupported' });
    expect(healthKitMock.isHealthDataAvailable).not.toHaveBeenCalled();
    expect(healthConnectMock.getSdkStatus).not.toHaveBeenCalled();
  });

  it('a thrown native error becomes a safe unavailable result, not an unhandled rejection', async () => {
    platform.OS = 'android';
    healthConnectMock.getSdkStatus.mockRejectedValue(new Error('boom'));
    await expect(checkHealthAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'check_failed',
    });
  });
});

describe('requestHealthPermissions', () => {
  it('iOS: never claims a granted read permission — only that the dialog resolved', async () => {
    platform.OS = 'ios';
    healthKitMock.requestAuthorization.mockResolvedValue(true);
    await expect(requestHealthPermissions()).resolves.toEqual({
      platform: 'ios',
      permissionsRequested: true,
    });
    expect(healthKitMock.requestAuthorization).toHaveBeenCalledWith({
      toRead: ['HKQuantityTypeIdentifierBodyMass'],
      toShare: ['HKWorkoutTypeIdentifier'],
    });
  });

  it('Android: requests exactly the MVP scope (weight read, exercise write) — nothing else', async () => {
    platform.OS = 'android';
    await requestHealthPermissions();
    expect(healthConnectMock.requestPermission).toHaveBeenCalledWith([
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'write', recordType: 'ExerciseSession' },
    ]);
  });

  it('Android: filters out permissions outside MVP scope even if the OS reports them granted', async () => {
    platform.OS = 'android';
    healthConnectMock.requestPermission.mockResolvedValue([
      { accessType: 'read', recordType: 'Weight' },
      // Reproduces the exact Fase 0 finding: a stray grant from an earlier
      // test build that this integration never asks for.
      { accessType: 'write', recordType: 'CyclingPedalingCadence' },
    ]);
    const result = await requestHealthPermissions();
    expect(result).toEqual({
      platform: 'android',
      granted: [{ accessType: 'read', recordType: 'Weight' }],
    });
  });

  it('Android: provider not installed/initialized is a typed, recognizable error', async () => {
    platform.OS = 'android';
    healthConnectMock.initialize.mockResolvedValue(false);
    const rejection = requestHealthPermissions();
    await expect(rejection).rejects.toThrow(HealthIntegrationError);
    await rejection.catch((error: HealthIntegrationError) => {
      expect(error.code).toBe('provider_not_installed');
    });
  });

  it('a native throw during the permission dialog is wrapped, not leaked raw', async () => {
    platform.OS = 'android';
    healthConnectMock.requestPermission.mockRejectedValue(new Error('native crash'));
    const rejection = requestHealthPermissions();
    await expect(rejection).rejects.toThrow(HealthIntegrationError);
    await rejection.catch((error: HealthIntegrationError) => {
      expect(error.code).toBe('permission_request_failed');
      expect(error.cause).toBeInstanceOf(Error);
    });
  });

  it('concurrent calls share one in-flight request and only prompt the OS once', async () => {
    platform.OS = 'android';
    let resolveRequest: (value: { accessType: 'read'; recordType: 'Weight' }[]) => void;
    healthConnectMock.requestPermission.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const first = requestHealthPermissions();
    const second = requestHealthPermissions();
    resolveRequest!([{ accessType: 'read', recordType: 'Weight' }]);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(healthConnectMock.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('a later, independent call is not deduped against an already-settled request', async () => {
    platform.OS = 'android';
    await requestHealthPermissions();
    await requestHealthPermissions();
    expect(healthConnectMock.requestPermission).toHaveBeenCalledTimes(2);
  });
});

describe('getGrantedHealthPermissions', () => {
  it('iOS always returns the non-committal shape — callers must not read it as "granted"', async () => {
    platform.OS = 'ios';
    await expect(getGrantedHealthPermissions()).resolves.toEqual({
      platform: 'ios',
      permissionsRequested: false,
    });
  });

  it('Android reports only MVP-scoped grants, filtering out anything else', async () => {
    platform.OS = 'android';
    healthConnectMock.getGrantedPermissions.mockResolvedValue([
      { accessType: 'write', recordType: 'ExerciseSession' },
      { accessType: 'write', recordType: 'CyclingPedalingCadence' },
      { accessType: 'write', recordType: 'Weight' },
    ]);
    await expect(getGrantedHealthPermissions()).resolves.toEqual({
      platform: 'android',
      granted: [{ accessType: 'write', recordType: 'ExerciseSession' }],
    });
  });

  it('a native query failure degrades to an empty grant list, not a thrown error', async () => {
    platform.OS = 'android';
    healthConnectMock.getGrantedPermissions.mockRejectedValue(new Error('boom'));
    await expect(getGrantedHealthPermissions()).resolves.toEqual({
      platform: 'android',
      granted: [],
    });
  });
});

describe('openNativeHealthSettings', () => {
  it('iOS: opens the Health app when possible', async () => {
    platform.OS = 'ios';
    linking.canOpenURL.mockResolvedValue(true);
    await openNativeHealthSettings();
    expect(linking.openURL).toHaveBeenCalledWith('x-apple-health://');
    expect(linking.openSettings).not.toHaveBeenCalled();
  });

  it('iOS: falls back to system Settings when the Health app cannot be opened', async () => {
    platform.OS = 'ios';
    linking.canOpenURL.mockResolvedValue(false);
    await openNativeHealthSettings();
    expect(linking.openSettings).toHaveBeenCalled();
  });

  it('Android: opens Health Connect settings', async () => {
    platform.OS = 'android';
    await openNativeHealthSettings();
    expect(healthConnectMock.openHealthConnectSettings).toHaveBeenCalled();
  });
});
