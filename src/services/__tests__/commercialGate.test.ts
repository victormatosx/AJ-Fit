import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  getIdToken: vi.fn(),
  getToken: vi.fn(),
  currentUser: null as { getIdToken: (forceRefresh?: boolean) => Promise<string> } | null,
  // `null` models web/Expo Go (no native App Check module — see
  // `src/lib/firebaseAppCheck.ts`); a truthy sentinel models a real device
  // with App Check attached. Most tests exercise the callable itself, so
  // default to "attached" — the dedicated App Check tests below override it.
  appCheckInstance: {} as object | null,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.callable;
  },
}));

vi.mock('firebase/app-check', () => ({
  getToken: (...args: unknown[]) => mocks.getToken(...args),
}));

vi.mock('../../lib/firebaseFunctions', () => ({
  functions: {},
  FUNCTIONS_REGION: 'us-central1',
}));

vi.mock('../../lib/firebase', () => ({
  get auth() {
    return { get currentUser() { return mocks.currentUser; } };
  },
  get appCheck() { return mocks.appCheckInstance; },
}));

import { requestCommercialGateConfirmation } from '../commercialGate';

describe('requestCommercialGateConfirmation', () => {
  beforeEach(() => {
    // Only reset the per-call mock — `mocks.httpsCallable` records the
    // ONE registration call made at module-import time (the top-level
    // `httpsCallable(functions, 'confirmCommercialGate')` in
    // src/services/commercialGate.ts), which happens once for the whole
    // file and must not be wiped between tests.
    mocks.callable.mockReset();
    mocks.getIdToken.mockReset().mockResolvedValue('fresh-token');
    mocks.getToken.mockReset().mockResolvedValue({ token: 'app-check-token' });
    // Default: a signed-in user with a healthy token and App Check attached
    // — most tests exercise the callable itself, not the readiness guards.
    mocks.currentUser = { getIdToken: mocks.getIdToken };
    mocks.appCheckInstance = {};
  });

  it('registers against the confirmCommercialGate callable name (module-init time, checked once here)', () => {
    expect(mocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'confirmCommercialGate');
  });

  it('calls the callable with no request body (identity comes only from the auth token)', async () => {
    mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

    await requestCommercialGateConfirmation();

    expect(mocks.callable).toHaveBeenCalledWith({});
  });

  it('never throws when the callable rejects — this is a best-effort request, the webhook remains authoritative', async () => {
    mocks.callable.mockRejectedValue(new Error('network down'));

    await expect(requestCommercialGateConfirmation()).resolves.toBeUndefined();
  });

  it('never throws on a non-"resolved" status either (e.g. "not_entitled", "ambiguous")', async () => {
    mocks.callable.mockResolvedValue({ data: { status: 'not_entitled' } });

    await expect(requestCommercialGateConfirmation()).resolves.toBeUndefined();
  });

  it('forces a fresh ID token before calling — closes the gap that produced a real functions/unauthenticated', async () => {
    mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

    await requestCommercialGateConfirmation();

    expect(mocks.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.getIdToken.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.callable.mock.invocationCallOrder[0]);
  });

  it('skips the call entirely when auth.currentUser is not yet available, instead of firing a call doomed to fail', async () => {
    mocks.currentUser = null;
    mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

    await expect(requestCommercialGateConfirmation()).resolves.toBeUndefined();

    expect(mocks.callable).not.toHaveBeenCalled();
  });

  // (M) `confirmCommercialGate` is `enforceAppCheck: true` server-side
  // (functions/src/billing/confirmCommercialGate.ts) — a call with no valid
  // Auth token OR no valid App Check token is doomed to fail server-side.
  // This module must never fire that call in either gap: both are checked
  // BEFORE the callable, never after a failed round-trip.
  describe('never calls the callable without valid Auth AND App Check readiness (M)', () => {
    it('skips the call when App Check is not attached at all (web/Expo Go — src/lib/firebaseAppCheck.ts)', async () => {
      mocks.appCheckInstance = null;
      mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

      await expect(requestCommercialGateConfirmation()).resolves.toBeUndefined();

      expect(mocks.callable).not.toHaveBeenCalled();
      expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it('skips the call when App Check is attached but fails to produce a token (the real ERR_APP_CHECK_TOKEN case)', async () => {
      mocks.getToken.mockRejectedValue(Object.assign(new Error('native attestation failed'), { code: 'ERR_APP_CHECK_TOKEN' }));
      mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

      await expect(requestCommercialGateConfirmation()).resolves.toBeUndefined();

      expect(mocks.callable).not.toHaveBeenCalled();
    });

    it('checks App Check readiness before forcing the Auth token refresh', async () => {
      mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

      await requestCommercialGateConfirmation();

      expect(mocks.getToken.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.getIdToken.mock.invocationCallOrder[0]);
    });

    it('still requires a signed-in user even when App Check is healthy', async () => {
      mocks.currentUser = null;
      mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

      await requestCommercialGateConfirmation();

      expect(mocks.callable).not.toHaveBeenCalled();
      expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it('proceeds normally (calls the callable) once both Auth and App Check are ready', async () => {
      mocks.callable.mockResolvedValue({ data: { status: 'resolved' } });

      await requestCommercialGateConfirmation();

      expect(mocks.callable).toHaveBeenCalledWith({});
    });
  });
});
