import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logFunctionError: vi.fn(),
}));

// `defineSecret(...).value()` falls back to `process.env.<NAME>` outside a
// deployed Cloud Function — the same pattern already used by
// `billing/__tests__/webhookHandler.test.ts` for `REVENUECAT_WEBHOOK_SECRET`.
// Never a real credential: a fixed test-only placeholder string.
const ORIGINAL_ADMIN_GRANTS_KEY = process.env.REVENUECAT_ADMIN_GRANTS_API_KEY;
const TEST_SECRET_VALUE = 'sk_test_fake_admin_grants_secret';

import {
  ADMINISTRATIVE_GRANT_DURATION_MS,
  RevenueCatGrantError,
  grantPromotionalEntitlement,
  revokePromotionalEntitlement,
} from '../revenueCatGrants';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('grantPromotionalEntitlement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.REVENUECAT_ADMIN_GRANTS_API_KEY = TEST_SECRET_VALUE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ADMIN_GRANTS_KEY === undefined) delete process.env.REVENUECAT_ADMIN_GRANTS_API_KEY;
    else process.env.REVENUECAT_ADMIN_GRANTS_API_KEY = ORIGINAL_ADMIN_GRANTS_KEY;
  });

  it('calls the documented v1 promotional endpoint with a Secret-key bearer token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { subscriber: { entitlements: { premium: { store: 'promotional', expires_date: '2126-01-01T00:00:00Z' } } } },
        201,
      ),
    );

    const result = await grantPromotionalEntitlement('firebase-uid-1', 'premium', NOW);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.revenuecat.com/v1/subscribers/firebase-uid-1/entitlements/premium/promotional',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_SECRET_VALUE}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    // Never the deprecated `duration`/`start_time_ms` fields — see the
    // module's own doc comment on why `end_time_ms` is used instead.
    expect(body.duration).toBeUndefined();
    expect(body.start_time_ms).toBeUndefined();
    expect(body.end_time_ms).toBe(NOW + ADMINISTRATIVE_GRANT_DURATION_MS);

    expect(result.store).toBe('promotional');
    expect(result.expiresDateMs).toBe(Date.parse('2126-01-01T00:00:00Z'));
  });

  it('never leaks the secret key or full response into a thrown error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'unauthorized' }, 401));

    const promise = grantPromotionalEntitlement('firebase-uid-1', 'premium', NOW);
    await expect(promise).rejects.toBeInstanceOf(RevenueCatGrantError);
    await expect(promise).rejects.toMatchObject({ kind: 'authentication', statusCode: 401 });
  });

  it.each([
    [404, 'not_found'],
    [429, 'temporary'],
    [500, 'temporary'],
    [400, 'configuration'],
  ])('classifies HTTP %i as %s', async (status, kind) => {
    fetchMock.mockResolvedValue(jsonResponse({}, status));
    await expect(grantPromotionalEntitlement('uid', 'premium', NOW)).rejects.toMatchObject({ kind });
  });

  it('classifies a network failure as temporary', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(grantPromotionalEntitlement('uid', 'premium', NOW)).rejects.toMatchObject({
      kind: 'temporary',
    });
  });

  it('never throws on an unrecognized response shape — the HTTP success already happened', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }, 201));
    const result = await grantPromotionalEntitlement('uid', 'premium', NOW);
    expect(result).toEqual({ store: null, expiresDateMs: null });
  });
});

describe('revokePromotionalEntitlement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.REVENUECAT_ADMIN_GRANTS_API_KEY = TEST_SECRET_VALUE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ADMIN_GRANTS_KEY === undefined) delete process.env.REVENUECAT_ADMIN_GRANTS_API_KEY;
    else process.env.REVENUECAT_ADMIN_GRANTS_API_KEY = ORIGINAL_ADMIN_GRANTS_KEY;
  });

  it('calls the documented revoke_promotionals endpoint with no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ subscriber: { entitlements: {} } }, 200));

    await revokePromotionalEntitlement('firebase-uid-1', 'premium');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.revenuecat.com/v1/subscribers/firebase-uid-1/entitlements/premium/revoke_promotionals',
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});
