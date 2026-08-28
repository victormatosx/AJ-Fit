import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('__DEV__ debug-token fallback (audit: ERR_APP_CHECK_TOKEN / confirmCommercialGate functions/unauthenticated)', () => {
    const globalWithDev = globalThis as typeof globalThis & { __DEV__?: boolean };

    afterEach(() => {
      delete globalWithDev.__DEV__;
      delete (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
        .FIREBASE_APPCHECK_DEBUG_TOKEN;
    });

    it('initializes via the debug-token exchange when the native module is absent AND __DEV__ is true', () => {
      globalWithDev.__DEV__ = true;
      mocks.available.mockReturnValue(false);

      const result = initializeFirebaseAppCheck({} as never);

      expect(result).toEqual({ name: 'app-check-instance' });
      expect(mocks.initialize).toHaveBeenCalledTimes(1);
      expect(
        (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
          .FIREBASE_APPCHECK_DEBUG_TOKEN,
      ).toBe(true);
    });

    it('never sets the debug-token flag when the native module IS available, even in __DEV__ (production attestation path untouched)', () => {
      globalWithDev.__DEV__ = true;
      mocks.available.mockReturnValue(true);

      initializeFirebaseAppCheck({} as never);

      expect(
        (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: unknown })
          .FIREBASE_APPCHECK_DEBUG_TOKEN,
      ).toBeUndefined();
    });

    it('still returns null outside __DEV__ when the native module is absent — no debug fallback in production', () => {
      globalWithDev.__DEV__ = false;
      mocks.available.mockReturnValue(false);

      expect(initializeFirebaseAppCheck({} as never)).toBeNull();
      expect(mocks.initialize).not.toHaveBeenCalled();
    });
  });

  it('reuses one JS App Check instance across Fast Refresh', () => {
    const app = { name: '[DEFAULT]' };
    const first = initializeFirebaseAppCheck(app as never);
    const second = initializeFirebaseAppCheck(app as never);

    expect(first).toBe(second);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });
});
