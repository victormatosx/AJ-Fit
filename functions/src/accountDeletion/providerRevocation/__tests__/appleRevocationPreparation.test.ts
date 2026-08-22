import { describe, expect, it, vi } from 'vitest';

import {
  AppleRevocationPreparationError,
  cacheAppleRevocationMaterial,
  exchangeAppleAuthorizationCode,
} from '../appleRevocationPreparation';
import { AppleIdentityApiError } from '../appleIdentityClient';

describe('exchangeAppleAuthorizationCode', () => {
  it('returns the refresh token on a successful exchange', async () => {
    const client = {
      exchangeAuthorizationCode: vi
        .fn()
        .mockResolvedValue({ refreshToken: 'rt-1', accessToken: 'at-1', expiresInSeconds: 3600 }),
    };
    await expect(exchangeAppleAuthorizationCode('code-1', { client })).resolves.toBe('rt-1');
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledWith('code-1');
  });

  it('wraps an AppleIdentityApiError into AppleRevocationPreparationError, preserving the classified code', async () => {
    const client = {
      exchangeAuthorizationCode: vi.fn().mockRejectedValue(new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID', 400)),
    };
    const error = await exchangeAppleAuthorizationCode('code-1', { client }).catch((e) => e);
    expect(error).toBeInstanceOf(AppleRevocationPreparationError);
    expect((error as AppleRevocationPreparationError).code).toBe('PROVIDER_AUTHORIZATION_INVALID');
  });

  it('wraps a non-AppleIdentityApiError as INTERNAL_TRANSIENT — never silently terminal by default', async () => {
    const client = { exchangeAuthorizationCode: vi.fn().mockRejectedValue(new Error('boom')) };
    const error = await exchangeAppleAuthorizationCode('code-1', { client }).catch((e) => e);
    expect(error).toBeInstanceOf(AppleRevocationPreparationError);
    expect((error as AppleRevocationPreparationError).code).toBe('INTERNAL_TRANSIENT');
  });

  it('never persists the authorization code anywhere — no repository/storage dependency exists in this function at all', async () => {
    // Structural proof: the function signature only accepts {client}, no
    // repository/db/storage dependency it could even accidentally write to.
    const client = {
      exchangeAuthorizationCode: vi
        .fn()
        .mockResolvedValue({ refreshToken: 'rt-1', accessToken: 'at-1', expiresInSeconds: 3600 }),
    };
    await exchangeAppleAuthorizationCode('super-secret-code', { client });
    // The only call this function ever makes is the exchange itself.
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });
});

describe('cacheAppleRevocationMaterial', () => {
  it('wraps the refresh token and persists it against the given deletionId', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrap = vi.fn().mockResolvedValue({ wrappedToken: 'wrapped-1', kmsKeyVersion: 'kv-1' });
    const now = () => 12345;

    const result = await cacheAppleRevocationMaterial('del-1', 'rt-1', { repository: { save }, wrap, now });

    expect(result).toEqual({ cached: true });
    expect(wrap).toHaveBeenCalledWith('rt-1');
    expect(save).toHaveBeenCalledWith('del-1', {
      wrappedRefreshToken: 'wrapped-1',
      kmsKeyVersion: 'kv-1',
      createdAtMs: 12345,
    });
  });

  it('returns {cached:false} (never throws) when wrapping fails', async () => {
    const save = vi.fn();
    const wrap = vi.fn().mockRejectedValue(new Error('KMS down'));
    await expect(cacheAppleRevocationMaterial('del-1', 'rt-1', { repository: { save }, wrap })).resolves.toEqual({
      cached: false,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns {cached:false} (never throws) when persistence fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Firestore down'));
    const wrap = vi.fn().mockResolvedValue({ wrappedToken: 'wrapped-1', kmsKeyVersion: 'kv-1' });
    await expect(cacheAppleRevocationMaterial('del-1', 'rt-1', { repository: { save }, wrap })).resolves.toEqual({
      cached: false,
    });
  });

  it("never touches another deletionId's material", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrap = vi.fn().mockResolvedValue({ wrappedToken: 'wrapped-1', kmsKeyVersion: 'kv-1' });
    await cacheAppleRevocationMaterial('del-A', 'rt-A', { repository: { save }, wrap });
    expect(save).toHaveBeenCalledWith('del-A', expect.anything());
    expect(save).not.toHaveBeenCalledWith('del-B', expect.anything());
  });
});
