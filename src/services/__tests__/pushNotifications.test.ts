import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Linking: { openSettings: vi.fn(async () => undefined) },
  Platform: { OS: 'android' },
}));
vi.mock('expo', () => ({ isRunningInExpoGo: () => false }));
vi.mock('expo-constants', () => ({
  default: {
    easConfig: { projectId: 'project-id' },
    expoConfig: { extra: { eas: { projectId: 'project-id' } } },
    // A dev-launcher manifest may populate this. It must not be interpreted
    // as proof that the custom development build is Expo Go.
    expoGoConfig: { developer: { tool: 'expo-cli' } },
  },
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  addPushTokenListener: vi.fn(),
  setNotificationHandler: vi.fn(),
}));
vi.mock('../../../modules/ajfit-rest-activity', () => ({
  getAJFitRestActivityNativeModule: () => null,
}));

import {
  createPushNotificationsService,
  isPushSupported as isDefaultPushSupported,
  parsePushPayload,
  type PushNotificationsDependencies,
} from '../pushNotifications';

function fixture(overrides: Partial<PushNotificationsDependencies> = {}) {
  let tokenListener: ((token: { type: 'ios' | 'android'; data: string }) => void) | null = null;
  const remove = vi.fn();
  const notifications = {
    AndroidImportance: { DEFAULT: 3 },
    AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1 },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    getPermissionsAsync: vi.fn(async () => ({ granted: false, status: 'undetermined' })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: 'granted' })),
    setNotificationChannelAsync: vi.fn(async () => null),
    getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android', data: 'native-token' })),
    getExpoPushTokenAsync: vi.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[token]' })),
    addNotificationReceivedListener: vi.fn(() => ({ remove })),
    addNotificationResponseReceivedListener: vi.fn(() => ({ remove })),
    addPushTokenListener: vi.fn((listener) => {
      tokenListener = listener;
      return { remove };
    }),
    getLastNotificationResponse: vi.fn(() => null),
    clearLastNotificationResponse: vi.fn(),
    setNotificationHandler: vi.fn(),
  };
  const dependencies: PushNotificationsDependencies = {
    notifications: notifications as never,
    platform: 'android',
    isExpoGo: false,
    nativeApiAvailable: true,
    projectId: 'project-id',
    now: () => 100,
    development: true,
    recordAndroidPermissionRequest: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
  return {
    service: createPushNotificationsService(dependencies),
    notifications,
    dependencies,
    emitToken: (token: { type: 'ios' | 'android'; data: string }) => tokenListener?.(token),
  };
}

describe('push notification runtime', () => {
  it('does not misclassify a development-client manifest as Expo Go', () => {
    expect(isDefaultPushSupported()).toBe(true);
  });

  it('is passive: initialization never prompts or requests a token', () => {
    const { service, notifications } = fixture();
    const dispose = service.initializeRuntime();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    dispose();
  });

  it('creates the general Android channel before the explicit permission prompt', async () => {
    const { service, notifications } = fixture();
    await expect(service.requestNotificationPermission()).resolves.toBe('granted');
    expect(notifications.setNotificationChannelAsync.mock.invocationCallOrder[0])
      .toBeLessThan(notifications.requestPermissionsAsync.mock.invocationCallOrder[0]!);
  });

  it('still prompts when the optional Rest Timer compatibility hook fails', async () => {
    const { service, notifications } = fixture({
      recordAndroidPermissionRequest: vi.fn(async () => {
        throw new Error('old native binary');
      }),
    });

    await expect(service.requestNotificationPermission()).resolves.toBe('granted');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not request a token while permission is denied', async () => {
    const { service, notifications } = fixture();
    notifications.getPermissionsAsync.mockResolvedValue({
      granted: false,
      status: 'denied',
    } as never);

    await expect(service.getPushToken()).resolves.toBeNull();
    expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it('obtains native and Expo tokens only after permission is granted', async () => {
    const { service, notifications } = fixture();
    notifications.getPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
    } as never);

    await expect(service.getPushToken()).resolves.toMatchObject({
      expoPushToken: 'ExponentPushToken[token]',
      nativeToken: { type: 'android', data: 'native-token' },
    });
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'project-id',
      devicePushToken: { type: 'android', data: 'native-token' },
    });
  });

  it('supports physical iOS and Android when the native API is available', () => {
    expect(fixture({ platform: 'ios' }).service.getPushSupportStatus()).toEqual({
      supported: true,
      reasonCode: 'SUPPORTED',
    });
    expect(fixture({ platform: 'android' }).service.isPushSupported()).toBe(true);
  });

  it('reports precise reasons for genuinely unsupported environments', async () => {
    const expoGo = fixture({ isExpoGo: true });
    const web = fixture({ platform: 'web' }).service;
    const missingNativeApi = fixture({ nativeApiAvailable: false }).service;

    expect(expoGo.service.getPushSupportStatus().reasonCode).toBe('EXPO_GO');
    expect(web.getPushSupportStatus().reasonCode).toBe('UNSUPPORTED_PLATFORM');
    expect(missingNativeApi.getPushSupportStatus().reasonCode).toBe('NATIVE_API_MISSING');
    await expect(expoGo.service.getNotificationPermissionStatus()).resolves.toBe('unsupported');
    await expect(missingNativeApi.getNotificationPermissionStatus()).resolves.toBe('unsupported');
    expect(expoGo.notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(expoGo.dependencies.info).toHaveBeenCalledWith('push_unsupported', {
      platform: 'android',
      reasonCode: 'EXPO_GO',
    });
  });

  it.each([
    ['not-determined', 0],
    ['denied', 1],
  ] as const)('does not turn iOS permission %s into unsupported', async (expected, iosStatus) => {
    const { service, notifications } = fixture({ platform: 'ios' });
    notifications.getPermissionsAsync.mockResolvedValue({
      granted: false,
      status: expected === 'denied' ? 'denied' : 'undetermined',
      ios: { status: iosStatus },
    } as never);

    expect(service.isPushSupported()).toBe(true);
    await expect(service.getNotificationPermissionStatus()).resolves.toBe(expected);
  });

  it('refreshes an Expo token from the native token listener', async () => {
    const { service, notifications, emitToken } = fixture();
    notifications.getPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
    } as never);
    const listener = vi.fn();
    service.subscribeToPushTokenChanges(listener);
    service.initializeRuntime();

    emitToken({ type: 'android', data: 'new-native-token' });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  });

  it('clears only in-memory token state on logout', async () => {
    const { service, notifications } = fixture();
    notifications.getPermissionsAsync.mockResolvedValue({
      granted: true,
      status: 'granted',
    } as never);
    await service.getPushToken();
    service.clearPushTokenMemory();
    expect(service.getCurrentPushToken()).toBeNull();
    expect('unregisterForNotificationsAsync' in notifications).toBe(false);
  });
});

describe('push payload parsing', () => {
  it('accepts only the foundation QA payload', () => {
    expect(parsePushPayload({ type: 'QA_TEST', notificationId: 'qa-1' }))
      .toEqual({ type: 'QA_TEST', notificationId: 'qa-1' });
  });

  it.each(['WORKOUT_DAY', 'MISSED_WORKOUT', 'BILLING_ISSUE'])(
    'does not route product type %s in Phase 1',
    (type) => {
      expect(parsePushPayload({ type, notificationId: 'id' })).toBeNull();
    },
  );

  it('rejects malformed and nested-only payloads', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload({ type: 'QA_TEST' })).toBeNull();
    expect(parsePushPayload({ data: { type: 'QA_TEST', notificationId: 'qa' } })).toBeNull();
  });
});
