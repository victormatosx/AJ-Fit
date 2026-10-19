import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeFirebaseAppCheck } from '../firebaseAppCheck';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  nativeToken: vi.fn(),
  available: vi.fn(),
  platform: 'ios',
  providerOptions: null as null | { getToken: () => Promise<unknown> },
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  tokenReadiness: vi.fn(),
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
  getToken: mocks.tokenReadiness,
}));

vi.mock('../nativeAppCheck', () => ({
  getNativeAppCheckToken: mocks.nativeToken,
  isNativeAppCheckAvailable: mocks.available,
}));

vi.mock('../logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logger')>();
  return { ...actual, logWarn: mocks.logWarn, logInfo: mocks.logInfo };
});

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
  mocks.tokenReadiness.mockResolvedValue({ token: 'synthetic-private-token-never-logged' });
  delete (globalThis as typeof globalThis & { __ajFitFirebaseAppCheck?: unknown })
    .__ajFitFirebaseAppCheck;
});

describe('Firebase JS CustomProvider bridge', () => {
  it('reports real-provider readiness once in native development without logging its token', async () => {
    const g = globalThis as typeof globalThis & { __DEV__?: boolean };
    g.__DEV__ = true;
    try {
      initializeFirebaseAppCheck({} as never);
      initializeFirebaseAppCheck({} as never);
      await Promise.resolve();
      expect(mocks.tokenReadiness).toHaveBeenCalledTimes(1);
      expect(mocks.logInfo).toHaveBeenCalledWith('app-check', 'native_provider_ready', { nativeAvailable: true });
      expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain('synthetic-private-token');
    } finally { delete g.__DEV__; }
  });
  it('does not perform the diagnostic token request in production', () => {
    initializeFirebaseAppCheck({} as never);
    expect(mocks.tokenReadiness).not.toHaveBeenCalled();
  });
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

  describe('failure diagnostics (smoke-test audit: functions/unauthenticated with app=MISSING)', () => {
    const globalWithDev = globalThis as typeof globalThis & { __DEV__?: boolean };

    afterEach(() => {
      delete globalWithDev.__DEV__;
    });

    it('rethrows the original error unchanged — diagnostics never mask or replace the real failure', async () => {
      globalWithDev.__DEV__ = true;
      const nativeError = Object.assign(new Error('boom'), { code: 'ERR_APP_CHECK_TOKEN' });
      mocks.nativeToken.mockRejectedValue(nativeError);

      initializeFirebaseAppCheck({} as never);

      await expect(mocks.providerOptions!.getToken()).rejects.toBe(nativeError);
    });

    it('logs a categorized diagnostic in __DEV__ without ever including the token value', async () => {
      globalWithDev.__DEV__ = true;
      const nativeError = Object.assign(new Error('Firebase App Check token request failed: [FIRAppCheckErrorDomain#1] server rejected debug token'), { code: 'ERR_APP_CHECK_TOKEN' });
      mocks.nativeToken.mockRejectedValue(nativeError);

      initializeFirebaseAppCheck({} as never);
      await mocks.providerOptions!.getToken().catch(() => {});

      expect(mocks.logWarn).toHaveBeenCalledWith(
        'app-check',
        'native_token_fetch_failed',
        expect.objectContaining({ category: 'NATIVE_ERROR', errorCode: 'ERR_APP_CHECK_TOKEN' }),
      );
      const loggedContext = mocks.logWarn.mock.calls[0][2];
      expect(JSON.stringify(loggedContext)).not.toMatch(/opaque|token.{0,20}[a-f0-9]{20}/i);
    });

    it('preserves the real NSError domain/code/description (sanitized) instead of a bare code — closes the "undefined reason" gap', async () => {
      globalWithDev.__DEV__ = true;
      const nativeError = Object.assign(
        new Error(
          'Firebase App Check token request failed: [FIRAppCheckErrorDomain#1] server rejected debug token',
        ),
        { code: 'ERR_APP_CHECK_TOKEN' },
      );
      mocks.nativeToken.mockRejectedValue(nativeError);

      initializeFirebaseAppCheck({} as never);
      await mocks.providerOptions!.getToken().catch(() => {});

      const loggedContext = mocks.logWarn.mock.calls[0][2] as Record<string, unknown>;
      // The literal word "token" is itself redacted by sanitizeLogText's
      // generic secret-word rule — including the domain/code and the rest
      // of the description is the point; the previous behavior lost this
      // entirely, only ever surfacing the bare `ERR_APP_CHECK_TOKEN` code.
      expect(loggedContext.nativeMessage).toContain('FIRAppCheckErrorDomain#1');
      expect(loggedContext.nativeMessage).toContain('server rejected debug');
      expect(loggedContext.nativeMessage).toContain('[redacted]');
    });

    it('never logs an App Check/debug token value even if one leaks into the native error message', async () => {
      globalWithDev.__DEV__ = true;
      // Shaped like a real debug token (UUID) and like an Expo/Firebase App
      // Check JWT-ish opaque token, to exercise sanitizeLogText's patterns.
      const nativeError = Object.assign(
        new Error(
          'token rejected: 0F38934A-1C2C-4D65-8689-8FAD66E31734 / eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIifQ.dGVzdC1zaWduYXR1cmU',
        ),
        { code: 'ERR_APP_CHECK_TOKEN' },
      );
      mocks.nativeToken.mockRejectedValue(nativeError);

      initializeFirebaseAppCheck({} as never);
      await mocks.providerOptions!.getToken().catch(() => {});

      const loggedContext = mocks.logWarn.mock.calls[0][2] as Record<string, unknown>;
      const serialized = JSON.stringify(loggedContext);
      expect(serialized).not.toContain('0F38934A-1C2C-4D65-8689-8FAD66E31734');
      expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    });

    it('categorizes MODULE_NOT_AVAILABLE / FIREBASE_NOT_CONFIGURED / DEBUG_TOKEN_NOT_CONFIGURED / TOKEN_REJECTED / UNKNOWN distinctly', async () => {
      globalWithDev.__DEV__ = true;
      const cases: [string | undefined, string][] = [
        ['ERR_APP_CHECK_MODULE_UNAVAILABLE', 'MODULE_NOT_AVAILABLE'],
        ['ERR_APP_CHECK_NOT_CONFIGURED', 'FIREBASE_NOT_CONFIGURED'],
        ['ERR_APP_CHECK_DEBUG_TOKEN_MISSING', 'DEBUG_TOKEN_NOT_CONFIGURED'],
        ['ERR_APP_CHECK_INVALID_TOKEN', 'TOKEN_REJECTED'],
        [undefined, 'UNKNOWN'],
      ];
      for (const [code, expectedCategory] of cases) {
        mocks.logWarn.mockClear();
        const err = code ? Object.assign(new Error('x'), { code }) : new Error('x');
        mocks.nativeToken.mockRejectedValue(err);
        delete (globalThis as typeof globalThis & { __ajFitFirebaseAppCheck?: unknown }).__ajFitFirebaseAppCheck;

        initializeFirebaseAppCheck({} as never);
        await mocks.providerOptions!.getToken().catch(() => {});

        expect(mocks.logWarn).toHaveBeenCalledWith(
          'app-check',
          'native_token_fetch_failed',
          expect.objectContaining({ category: expectedCategory }),
        );
      }
    });

    it('never logs the diagnostic outside __DEV__ (no behavior change in production)', async () => {
      globalWithDev.__DEV__ = false;
      mocks.available.mockReturnValue(true);
      const nativeError = Object.assign(new Error('boom'), { code: 'ERR_APP_CHECK_TOKEN' });
      mocks.nativeToken.mockRejectedValue(nativeError);

      initializeFirebaseAppCheck({} as never);
      await expect(mocks.providerOptions!.getToken()).rejects.toBe(nativeError);

      expect(mocks.logWarn).not.toHaveBeenCalled();
    });
  });
});
