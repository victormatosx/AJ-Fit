import { describe, expect, it, vi } from 'vitest';

import { AppleIdentityApiError, AppleIdentityClient } from '../appleIdentityClient';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function emptyResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => '' } as Response;
}

function client(fetchImpl: typeof fetch, overrides: Partial<{ timeoutMs: number }> = {}) {
  return new AppleIdentityClient({
    clientId: 'com.ajfit.service',
    clientSecret: 'fake.jwt.secret',
    fetchImpl,
    ...overrides,
  });
}

describe('AppleIdentityClient.exchangeAuthorizationCode', () => {
  it('parses a successful token exchange', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    );
    const result = await client(fetchImpl).exchangeAuthorizationCode('fresh-code');
    expect(result).toEqual({ refreshToken: 'rt', accessToken: 'at', expiresInSeconds: 3600 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/token');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=fresh-code');
  });

  it('classifies invalid_grant (spent/expired code) as PROVIDER_AUTHORIZATION_INVALID (terminal)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    await expect(client(fetchImpl).exchangeAuthorizationCode('used-code')).rejects.toMatchObject({
      code: 'PROVIDER_AUTHORIZATION_INVALID',
    });
  });

  it('classifies 401/403 as MISSING_REQUIRED_CONFIGURATION (bad client_secret/client_id)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid_client' }));
    await expect(client(fetchImpl).exchangeAuthorizationCode('code')).rejects.toMatchObject({
      code: 'MISSING_REQUIRED_CONFIGURATION',
    });
  });

  it('classifies 429/5xx as UNAVAILABLE (retryable)', async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, {}));
      await expect(client(fetchImpl).exchangeAuthorizationCode('code')).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    }
  });

  it('classifies a network failure / abort as TIMEOUT (retryable) — remote outcome unknown', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(client(fetchImpl).exchangeAuthorizationCode('code')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('aborts and reports TIMEOUT when the response never arrives in time', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch, { timeoutMs: 10 }).exchangeAuthorizationCode('code'),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('classifies a malformed JSON success body as PROVIDER_RESPONSE_INVALID (terminal)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'not-json{{' });
    await expect(client(fetchImpl as never).exchangeAuthorizationCode('code')).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    });
  });

  it('classifies a well-formed JSON success body missing required fields as PROVIDER_RESPONSE_INVALID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: 'at' }));
    await expect(client(fetchImpl).exchangeAuthorizationCode('code')).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    });
  });

  it('rejects an empty authorization code without any network call', async () => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl).exchangeAuthorizationCode('')).rejects.toMatchObject({
      code: 'PROVIDER_AUTHORIZATION_INVALID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('AppleIdentityClient.revokeToken', () => {
  it('resolves on HTTP 200 with an empty body (Apple’s documented revoke response shape)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(200));
    await expect(client(fetchImpl).revokeToken('refresh-token', 'refresh_token')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    expect(String(init.body)).toContain('token_type_hint=refresh_token');
  });

  it('is idempotent by construction: a second 200 for an already-revoked token is still SUCCEEDED, no distinct branch', async () => {
    // Per RFC 7009 (Apple's revoke endpoint follows it): 200 covers BOTH
    // "revoked now" and "was already invalid" — this client has no
    // ALREADY_REVOKED special case at all, and this test proves a plain
    // 200 is treated identically regardless of prior state.
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(200));
    await client(fetchImpl).revokeToken('already-revoked-token', 'refresh_token');
    await expect(client(fetchImpl).revokeToken('already-revoked-token', 'refresh_token')).resolves.toBeUndefined();
  });

  it('classifies a revoke timeout as TIMEOUT — remote outcome unknown, must not be treated as failure-to-revoke', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('aborted'));
    await expect(client(fetchImpl).revokeToken('token', 'refresh_token')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('classifies 5xx as UNAVAILABLE', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(503));
    await expect(client(fetchImpl).revokeToken('token', 'refresh_token')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('classifies 400/invalid_client as MISSING_REQUIRED_CONFIGURATION', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    await expect(client(fetchImpl).revokeToken('token', 'refresh_token')).rejects.toMatchObject({
      code: 'MISSING_REQUIRED_CONFIGURATION',
    });
  });

  it('rejects an empty token without any network call', async () => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl).revokeToken('', 'refresh_token')).rejects.toMatchObject({
      code: 'PROVIDER_AUTHORIZATION_INVALID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('AppleIdentityClient construction', () => {
  it('rejects empty clientId/clientSecret at construction time', () => {
    expect(() => new AppleIdentityClient({ clientId: '', clientSecret: 'x' })).toThrow(AppleIdentityApiError);
    expect(() => new AppleIdentityClient({ clientId: 'x', clientSecret: '' })).toThrow(AppleIdentityApiError);
  });
});
