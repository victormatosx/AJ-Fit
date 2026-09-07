import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(),
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn()),
}));
vi.mock('../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('../pushNotifications', () => ({
  clearPushTokenMemory: vi.fn(),
  getCurrentPushToken: vi.fn(),
  getNotificationPermissionStatus: vi.fn(),
  getPushToken: vi.fn(),
}));

import {
  createPushDeviceRegistrationService,
  type PushDeviceReleaseResult,
} from '../pushDeviceRegistration';
import type { PushTokenSnapshot } from '../pushNotifications';

const INSTALLATION_FOR_TEST = '10000000-0000-4000-8000-000000000001';
const TOKEN: PushTokenSnapshot = {
  expoPushToken: 'ExponentPushToken[token-aaaaaaaa]',
  nativeToken: { type: 'android', data: 'native-token-aaaaaaaa' },
  obtainedAt: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface SyncInput {
  installationSecret: string;
  sessionBindingId: string;
  expectedOwnershipVersion: number;
  [key: string]: unknown;
}

function fixture(overrides: Record<string, unknown> = {}) {
  const secure = new Map<string, string>();
  const local = new Map<string, string>();
  let uuid = 0;
  let ownershipVersion = 0;
  const syncRemote = vi.fn(async (_input: SyncInput) => ({
    installationId: INSTALLATION_FOR_TEST,
    ownershipVersion: ++ownershipVersion,
    ownerChanged: ownershipVersion > 1,
    pushEnabled: true,
    status: 'synced' as const,
    tokenChanged: true,
  }));
  const releaseRemote = vi.fn(async () => ({
    installationId: INSTALLATION_FOR_TEST,
    ownershipVersion,
    ownerChanged: false,
    pushEnabled: false,
    status: 'released' as const,
    tokenChanged: true,
  }));
  const dependencies = {
    platform: 'android',
    now: () => 1_000,
    randomUUID: () => {
      uuid += 1;
      return `${String(uuid).padStart(8, '0')}-0000-4000-8000-000000000001`;
    },
    hash: vi.fn(async (value: string) => `hash:${value}`),
    secureGet: vi.fn(async (key: string) => secure.get(key) ?? null),
    secureSet: vi.fn(async (key: string, value: string) => { secure.set(key, value); }),
    localGet: vi.fn(async (key: string) => local.get(key) ?? null),
    localSet: vi.fn(async (key: string, value: string) => { local.set(key, value); }),
    permissionStatus: vi.fn(async () => 'granted' as const),
    currentToken: vi.fn(() => TOKEN),
    acquireToken: vi.fn(async () => TOKEN),
    clearTokenMemory: vi.fn(),
    syncRemote,
    releaseRemote,
    development: true,
    info: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
  return {
    service: createPushDeviceRegistrationService(dependencies as never),
    dependencies,
    syncRemote,
    releaseRemote,
    local,
  };
}

describe('push device registration client', () => {
  it('registers a granted device with installation proof and a session binding', async () => {
    const { service, syncRemote } = fixture();
    await service.setAuthenticatedUser('user-A');

    expect(syncRemote).toHaveBeenCalledTimes(1);
    expect(syncRemote.mock.calls[0]?.[0]).toMatchObject({
      expectedOwnershipVersion: 0,
      platform: 'android',
      permissionStatus: 'granted',
      expoPushToken: TOKEN.expoPushToken,
      nativePushToken: TOKEN.nativeToken,
    });
    expect(syncRemote.mock.calls[0]?.[0].installationSecret).toMatch(/^[0-9a-f-]{36}$/);
    expect(syncRemote.mock.calls[0]?.[0].sessionBindingId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('syncs denied permission without acquiring or sending tokens', async () => {
    const { service, dependencies, syncRemote } = fixture({
      permissionStatus: vi.fn(async () => 'denied' as const),
      currentToken: vi.fn(() => null),
    });
    await service.setAuthenticatedUser('user-A');

    expect(syncRemote.mock.calls[0]?.[0]).not.toHaveProperty('expoPushToken');
    expect(dependencies.acquireToken).not.toHaveBeenCalled();
  });

  it('forces a new sync on native token refresh', async () => {
    const { service, syncRemote } = fixture();
    await service.setAuthenticatedUser('user-A');
    await service.refreshCurrentDeviceToken('user-A', {
      ...TOKEN,
      expoPushToken: 'ExponentPushToken[token-bbbbbbbb]',
    });
    expect(syncRemote).toHaveBeenCalledTimes(2);
  });

  it('never makes B wait for a slow release of A', async () => {
    const slow = deferred<{
      installationId: string;
      ownershipVersion: number;
      ownerChanged: false;
      pushEnabled: false;
      status: 'stale-release';
      tokenChanged: false;
    }>();
    const releaseRemote = vi.fn(() => slow.promise);
    const { service, syncRemote } = fixture({ releaseRemote });

    await service.setAuthenticatedUser('user-A');
    const switchToB = service.setAuthenticatedUser('user-B');
    await expect(switchToB).resolves.toBeUndefined();

    expect(syncRemote).toHaveBeenCalledTimes(2);
    expect(service.getAuthenticatedUser()).toBe('user-B');
    expect(releaseRemote).toHaveBeenCalledWith(expect.objectContaining({
      ownerUid: 'user-A',
      ownershipVersion: 1,
    }));

    slow.resolve({
      installationId: '10000000-0000-4000-8000-000000000001',
      ownershipVersion: 2,
      ownerChanged: false,
      pushEnabled: false,
      status: 'stale-release',
      tokenChanged: false,
    });
    await vi.waitFor(() => expect(releaseRemote).toHaveBeenCalledTimes(1));
    expect(service.getAuthenticatedUser()).toBe('user-B');
  });

  it('retries the newer B sync with CAS but never retries A after A becomes stale', async () => {
    const delayedA = deferred<{
      installationId: string;
      ownershipVersion: number;
      ownerChanged: false;
      pushEnabled: true;
      status: 'synced';
      tokenChanged: true;
    }>();
    let call = 0;
    const syncRemote = vi.fn(async (input: SyncInput) => {
      call += 1;
      if (call === 1) return delayedA.promise;
      if (call === 2) {
        return {
          installationId: INSTALLATION_FOR_TEST,
          ownershipVersion: 1,
          ownerChanged: false,
          pushEnabled: true,
          status: 'stale-sync' as const,
          tokenChanged: false,
        };
      }
      return {
        installationId: INSTALLATION_FOR_TEST,
        ownershipVersion: input.expectedOwnershipVersion + 1,
        ownerChanged: true,
        pushEnabled: true,
        status: 'synced' as const,
        tokenChanged: false,
      };
    });
    const { service } = fixture({ syncRemote });

    const a = service.setAuthenticatedUser('user-A');
    await vi.waitFor(() => expect(syncRemote).toHaveBeenCalledTimes(1));
    await service.setAuthenticatedUser('user-B');
    delayedA.resolve({
      installationId: INSTALLATION_FOR_TEST,
      ownershipVersion: 1,
      ownerChanged: false,
      pushEnabled: true,
      status: 'synced',
      tokenChanged: true,
    });
    await a;

    expect(syncRemote).toHaveBeenCalledTimes(3);
    expect(syncRemote.mock.calls.map(([input]) => input.expectedOwnershipVersion))
      .toEqual([0, 0, 1]);
    expect(service.getAuthenticatedUser()).toBe('user-B');
  });

  it('keeps an offline release pending and retries it without blocking auth', async () => {
    let offline = true;
    const releaseRemote = vi.fn(async () => {
      if (offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      return {
        installationId: '10000000-0000-4000-8000-000000000001',
        ownershipVersion: 1,
        ownerChanged: false,
        pushEnabled: false,
        status: 'released' as const,
        tokenChanged: true,
      };
    });
    const { service } = fixture({ releaseRemote });
    await service.setAuthenticatedUser('user-A');

    const first: PushDeviceReleaseResult = await service.queueCurrentDeviceRelease('user-A');
    expect(first.status).toBe('failed');
    offline = false;
    await service.retryPendingDeviceBindings(null);
    expect(releaseRemote).toHaveBeenCalledTimes(2);
  });

  it('clears token memory but never unregisters the native provider on logout', async () => {
    const { service, dependencies } = fixture();
    await service.setAuthenticatedUser('user-A');
    const release = service.queueCurrentDeviceRelease('user-A');
    await vi.waitFor(() => expect(dependencies.clearTokenMemory).toHaveBeenCalled());
    await release;
    expect(dependencies).not.toHaveProperty('invalidateToken');
  });
});
