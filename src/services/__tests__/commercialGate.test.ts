import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.callable;
  },
}));

vi.mock('../../lib/firebaseFunctions', () => ({
  functions: {},
  FUNCTIONS_REGION: 'us-central1',
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
});
