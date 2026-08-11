import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {},
}));

import { handleBackendHealth } from '../health/backendHealth';

describe('backendHealth', () => {
  it('returns ok:true with a backend version and an ISO server timestamp', () => {
    // @ts-expect-error - the handler does not read anything from the request
    const result = handleBackendHealth({});

    expect(result.ok).toBe(true);
    expect(typeof result.backendVersion).toBe('string');
    expect(result.backendVersion.length).toBeGreaterThan(0);
    expect(() => new Date(result.serverTime).toISOString()).not.toThrow();
    expect(new Date(result.serverTime).toISOString()).toBe(result.serverTime);
  });

  it('never returns project id, env vars, secrets, tokens or IAM info', () => {
    // @ts-expect-error - the handler does not read anything from the request
    const result = handleBackendHealth({});
    const keys = Object.keys(result);

    expect(keys).toEqual(['ok', 'backendVersion', 'serverTime']);
  });
});
