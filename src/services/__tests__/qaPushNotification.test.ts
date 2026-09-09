import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  logInfo: vi.fn(),
  randomUUID: vi.fn(() => '10000000-0000-4000-8000-000000000001'),
  currentUid: 'user-A' as string | null,
  authenticated: true,
  getPermission: vi.fn(async () => 'granted' as const),
  getSupport: vi.fn(() => ({ supported: true, reasonCode: 'SUPPORTED' as const })),
  currentToken: vi.fn(() => ({ expoPushToken: 'never-expose-me' })),
  requestToken: vi.fn(async () => ({ expoPushToken: 'never-expose-me' })),
  sync: vi.fn(async () => ({ status: 'synced' as const })),
  refresh: vi.fn(async () => ({ status: 'synced' as const })),
  updatePermission: vi.fn(async () => ({ status: 'synced' as const })),
}));

vi.mock('expo-crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.callable;
  },
}));
vi.mock('../../lib/firebase', () => ({
  auth: { get currentUser() { return mocks.authenticated ? {} : null; } },
}));
vi.mock('../../lib/firebaseFunctions', () => ({
  functions: {},
  FUNCTIONS_REGION: 'us-central1',
}));
vi.mock('../../lib/logger', () => ({
  errorCode: (cause: unknown) => typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined,
  logInfo: mocks.logInfo,
  sanitizeLogText: (value: string) => value.replace(/ExponentPushToken\[[^\]]+\]/g, '[redacted]'),
}));
vi.mock('../pushDeviceRegistration', () => ({
  getAuthenticatedPushUser: () => mocks.currentUid,
  refreshCurrentDeviceToken: mocks.refresh,
  syncCurrentDeviceBinding: mocks.sync,
  updatePushPermissionState: mocks.updatePermission,
}));
vi.mock('../pushNotifications', () => ({
  getCurrentPushToken: mocks.currentToken,
  getNotificationPermissionStatus: mocks.getPermission,
  getPushSupportStatus: mocks.getSupport,
  requestPushTokenForDevelopment: mocks.requestToken,
}));

// The subject import stays below the hoisted module mocks by design.
// eslint-disable-next-line import/first
import {
  loadQaPushDiagnostics,
  QA_PUSH_NOTIFICATION_TYPES,
  qaPushErrorMessage,
  qaPushUnavailableMessage,
  QA_PUSH_CALLABLE_NAME,
  refreshQaPushRegistration,
  sendQaPushNotification,
} from '../qaPushNotification';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUid = 'user-A';
  mocks.authenticated = true;
  mocks.callable.mockResolvedValue({
    data: { status: 'PENDING_RECEIPTS', dispatchId: 'dispatch-1', acceptedCount: 1 },
  });
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
});

describe('QA push client boundary', () => {
  it('is unavailable outside DEV and never calls the backend', async () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    await expect(sendQaPushNotification('QA_TEST')).rejects.toThrow('qa_push_unavailable');
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('sends only an allowlisted type and a fresh request id', async () => {
    await expect(sendQaPushNotification('WORKOUT_DAY')).resolves.toMatchObject({
      status: 'PENDING_RECEIPTS', dispatchId: 'dispatch-1',
    });
    expect(mocks.callable).toHaveBeenCalledWith({
      notificationType: 'WORKOUT_DAY',
      qaRequestId: '10000000-0000-4000-8000-000000000001',
    });
    expect(mocks.callable.mock.calls[0]?.[0]).not.toHaveProperty('targetUid');
    expect(mocks.callable.mock.calls[0]?.[0]).not.toHaveProperty('title');
    expect(mocks.callable.mock.calls[0]?.[0]).not.toHaveProperty('body');
    expect(mocks.httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      QA_PUSH_CALLABLE_NAME,
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'qaPushNotification',
      'qa_push_callable_invoking',
      expect.objectContaining({
        notificationType: 'WORKOUT_DAY',
        authenticated: true,
        pushRegistered: true,
        region: 'us-central1',
      }),
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'qaPushNotification',
      'qa_push_callable_succeeded',
      expect.objectContaining({ notificationType: 'WORKOUT_DAY', status: 'PENDING_RECEIPTS' }),
    );
  });

  it('contains exactly the nine implemented QA preview types', () => {
    expect(QA_PUSH_NOTIFICATION_TYPES).toEqual([
      'QA_TEST',
      'WORKOUT_DAY',
      'RECOVERY_DAY',
      'MISSED_WORKOUT',
      'EVOLUTION_UNLOCKED',
      'PROGRAM_UPDATED',
      'EVOLUTION_APPROACHING',
      'BILLING_ISSUE',
      'PREMIUM_ENDED',
    ]);
  });

  it('loads diagnostics through the existing registration flow without exposing the token', async () => {
    const result = await loadQaPushDiagnostics('user-A');
    expect(result).toEqual({
      support: { supported: true, reasonCode: 'SUPPORTED' },
      permission: 'granted', registration: 'synced', expoPushTokenPresent: true,
    });
    expect(JSON.stringify(result)).not.toContain('never-expose-me');
    expect(mocks.sync).toHaveBeenCalledWith('user-A');
  });

  it('forces the existing token/device registration flow on explicit refresh', async () => {
    await expect(refreshQaPushRegistration('user-A')).resolves.toMatchObject({
      permission: 'granted', registration: 'synced', expoPushTokenPresent: true,
    });
    expect(mocks.requestToken).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith('user-A', expect.objectContaining({
      expoPushToken: 'never-expose-me',
    }));
  });

  it('isolates account switches while an async diagnostic is running', async () => {
    let releasePermission!: () => void;
    mocks.getPermission.mockImplementationOnce(() => new Promise((resolve) => {
      releasePermission = () => resolve('granted');
    }));
    const pending = loadQaPushDiagnostics('user-A');
    mocks.currentUid = 'user-B';
    releasePermission();
    await expect(pending).resolves.toEqual({
      support: { supported: true, reasonCode: 'SUPPORTED' },
      permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false,
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('does nothing after logout and reports stale identity', async () => {
    mocks.currentUid = null;
    await expect(loadQaPushDiagnostics('user-A')).resolves.toEqual({
      support: { supported: true, reasonCode: 'SUPPORTED' },
      permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false,
    });
    expect(mocks.getPermission).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('maps useful errors without reflecting backend data or secrets', () => {
    expect(qaPushErrorMessage({ code: 'functions/permission-denied', token: 'secret' }))
      .toContain('functions/permission-denied');
    expect(qaPushErrorMessage(new Error('ExponentPushToken[secret]')))
      .not.toContain('secret');
  });

  it.each([
    ['functions/permission-denied', 'functions/permission-denied'],
    ['functions/not-found', 'dispatchTestNotification'],
    ['functions/invalid-argument', 'backend publicado pode estar desatualizado'],
  ])('shows a visible, actionable message for %s', (code, expected) => {
    expect(qaPushErrorMessage(Object.assign(new Error('safe failure'), { code })))
      .toContain(expected);
  });

  it('rejects an unsupported type explicitly before invoking the callable', async () => {
    await expect(sendQaPushNotification('WEEK_COMPLETED' as never))
      .rejects.toThrow('qa_push_type_unsupported');
    expect(mocks.callable).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'qaPushNotification',
      'qa_push_callable_failed',
      expect.objectContaining({ notificationType: 'WEEK_COMPLETED' }),
    );
  });

  it('logs callable failure safely and rethrows it to the visible UI state', async () => {
    const cause = Object.assign(new Error('request failed ExponentPushToken[secret]'), {
      code: 'functions/invalid-argument',
      token: 'must-never-be-logged',
    });
    mocks.callable.mockRejectedValueOnce(cause);

    await expect(sendQaPushNotification('QA_TEST')).rejects.toBe(cause);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      'qaPushNotification',
      'qa_push_callable_failed',
      expect.objectContaining({
        notificationType: 'QA_TEST',
        errorCode: 'functions/invalid-argument',
        errorMessage: 'request failed [redacted]',
      }),
    );
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain('must-never-be-logged');
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain('ExponentPushToken[secret]');
  });

  it('provides an explicit rebuild message when the native API is missing', () => {
    expect(qaPushUnavailableMessage('NATIVE_API_MISSING')).toBe(
      'Push não está disponível neste build. Recompile o development build com suporte nativo a notifications.',
    );
    expect(qaPushUnavailableMessage('SUPPORTED')).toBeNull();
  });
});
