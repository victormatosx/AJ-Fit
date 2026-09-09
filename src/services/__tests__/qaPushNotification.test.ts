import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  randomUUID: vi.fn(() => '10000000-0000-4000-8000-000000000001'),
  currentUid: 'user-A' as string | null,
  getPermission: vi.fn(async () => 'granted' as const),
  currentToken: vi.fn(() => ({ expoPushToken: 'never-expose-me' })),
  requestToken: vi.fn(async () => ({ expoPushToken: 'never-expose-me' })),
  sync: vi.fn(async () => ({ status: 'synced' as const })),
  refresh: vi.fn(async () => ({ status: 'synced' as const })),
  updatePermission: vi.fn(async () => ({ status: 'synced' as const })),
}));

vi.mock('expo-crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => mocks.callable) }));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('../pushDeviceRegistration', () => ({
  getAuthenticatedPushUser: () => mocks.currentUid,
  refreshCurrentDeviceToken: mocks.refresh,
  syncCurrentDeviceBinding: mocks.sync,
  updatePushPermissionState: mocks.updatePermission,
}));
vi.mock('../pushNotifications', () => ({
  getCurrentPushToken: mocks.currentToken,
  getNotificationPermissionStatus: mocks.getPermission,
  requestPushTokenForDevelopment: mocks.requestToken,
}));

import {
  loadQaPushDiagnostics,
  QA_PUSH_NOTIFICATION_TYPES,
  qaPushErrorMessage,
  refreshQaPushRegistration,
  sendQaPushNotification,
} from '../qaPushNotification';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUid = 'user-A';
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
      permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false,
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('does nothing after logout and reports stale identity', async () => {
    mocks.currentUid = null;
    await expect(loadQaPushDiagnostics('user-A')).resolves.toEqual({
      permission: 'error', registration: 'stale-identity', expoPushTokenPresent: false,
    });
    expect(mocks.getPermission).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('maps useful errors without reflecting backend data or secrets', () => {
    expect(qaPushErrorMessage({ code: 'functions/permission-denied', token: 'secret' }))
      .toBe('Esta conta não está autorizada para QA de push.');
    expect(qaPushErrorMessage(new Error('ExponentPushToken[secret]')))
      .not.toContain('secret');
  });
});
