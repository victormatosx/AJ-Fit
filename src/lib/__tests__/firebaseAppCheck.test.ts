import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  nativeToken: vi.fn(),
  available: vi.fn(),
  platform: 'ios',
  providerOptions: null as null | { getToken: () => Promise<unknown> },
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));

vi.mock('firebase/app-check', () => ({
  CustomProvider: class {
    constructor(options: { getToken: () => Promise<unknown> }) {
      mocks.providerOptions = options;
    }
  },
  initializeAppCheck: mocks.initialize,
}));

vi.mock('../nativeAppCheck', () => ({
  getNativeAppCheckToken: mocks.nativeToken,
  isNativeAppCheckAvailable: mocks.available,
}));

import { initializeFirebaseAppCheck } from '../firebaseAppCheck';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = 'ios';
  mocks.providerOptions = null;
  mocks.available.mockReturnValue(true);
  mocks.nativeToken.mockResolvedValue({
    token: 'opaque',
    expireTimeMillis: Date.now() + 60_000,
  });
  mocks.initialize.mockReturnValue({ name: 'app-check-instance' });
  delete (globalThis as typeof globalThis & { __ajFitFirebaseAppCheck?: unknown })
    .__ajFitFirebaseAppCheck;
});

describe('Firebase JS CustomProvider bridge', () => {
  it('initializes App Check on the exact Firebase JS app supplied by firebase.ts', async () => {
    const app = { name: '[DEFAULT]' };

    const result = initializeFirebaseAppCheck(app as never);

    expect(result).toEqual({ name: 'app-check-instance' });
    expect(mocks.initialize).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
    );
    await expect(mocks.providerOptions!.getToken()).resolves.toMatchObject({ token: 'opaque' });
    expect(mocks.nativeToken).toHaveBeenCalledWith(false);
  });

  it('does not initialize in Expo Go/web when the native attestation module is absent', () => {
    mocks.available.mockReturnValue(false);
    expect(initializeFirebaseAppCheck({} as never)).toBeNull();
    expect(mocks.initialize).not.toHaveBeenCalled();

    mocks.available.mockReturnValue(true);
    mocks.platform = 'web';
    expect(initializeFirebaseAppCheck({} as never)).toBeNull();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('reuses one JS App Check instance across Fast Refresh', () => {
    const app = { name: '[DEFAULT]' };
    const first = initializeFirebaseAppCheck(app as never);
    const second = initializeFirebaseAppCheck(app as never);

    expect(first).toBe(second);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });
});
