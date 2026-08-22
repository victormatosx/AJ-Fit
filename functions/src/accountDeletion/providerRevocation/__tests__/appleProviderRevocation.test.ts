import { describe, expect, it, vi } from 'vitest';

import { AppleIdentityApiError } from '../appleIdentityClient';
import { revokeAppleProvider } from '../appleProviderRevocation';
import type { AppleProviderRevocationDependencies } from '../appleProviderRevocation';
import type { ApplePendingRevocationMaterial } from '../appleRevocationRepository';

function fakeRepository(initial?: ApplePendingRevocationMaterial) {
  let stored: ApplePendingRevocationMaterial | null = initial ?? null;
  return {
    save: vi.fn(async (_id: string, material: ApplePendingRevocationMaterial) => {
      stored = material;
    }),
    read: vi.fn(async () => stored),
    clear: vi.fn(async () => {
      stored = null;
    }),
    _peek: () => stored,
  };
}

type DepsOverrides = Partial<Omit<AppleProviderRevocationDependencies, 'repository'>> & {
  repository?: ReturnType<typeof fakeRepository>;
};

function deps(overrides: DepsOverrides = {}): AppleProviderRevocationDependencies & {
  repository: ReturnType<typeof fakeRepository>;
} {
  const repository = fakeRepository();
  return {
    client: {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        refreshToken: 'refresh-token-1',
        accessToken: 'access-token-1',
        expiresInSeconds: 3600,
      }),
      revokeToken: vi.fn().mockResolvedValue(undefined),
    },
    repository,
    wrap: vi.fn(async (token: string) => ({ wrappedToken: `wrapped:${token}`, kmsKeyVersion: 'v1' })),
    unwrap: vi.fn(async (wrapped: string) => wrapped.replace('wrapped:', '')),
    now: () => 1000,
    ...overrides,
  };
}

const BASE_INPUT = {
  deletionId: 'del-1',
  expectedUid: 'uid-1',
  capturedForUid: 'uid-1',
  authorizationCode: 'fresh-code',
};

describe('revokeAppleProvider — identity guard', () => {
  it('rejects material captured for a different uid, before any network/KMS/repository call', async () => {
    const d = deps();
    const outcome = await revokeAppleProvider(
      { ...BASE_INPUT, capturedForUid: 'attacker-uid' },
      d,
    );
    expect(outcome).toEqual({ kind: 'FAILED', code: 'IDENTITY_MISMATCH' });
    expect(d.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(d.repository.read).not.toHaveBeenCalled();
    expect(d.wrap).not.toHaveBeenCalled();
  });

  it('payload cannot substitute uid: capturedForUid must equal expectedUid exactly (case-sensitive)', async () => {
    const d = deps();
    const outcome = await revokeAppleProvider(
      { ...BASE_INPUT, expectedUid: 'uid-1', capturedForUid: 'UID-1' },
      d,
    );
    expect(outcome).toEqual({ kind: 'FAILED', code: 'IDENTITY_MISMATCH' });
  });
});

describe('revokeAppleProvider — first attempt (no cached material)', () => {
  it('exchanges the code, persists the wrapped token, revokes, then clears the material', async () => {
    const d = deps();
    const outcome = await revokeAppleProvider(BASE_INPUT, d);

    expect(d.client.exchangeAuthorizationCode).toHaveBeenCalledWith('fresh-code');
    expect(d.wrap).toHaveBeenCalledWith('refresh-token-1');
    expect(d.repository.save).toHaveBeenCalledWith('del-1', {
      wrappedRefreshToken: 'wrapped:refresh-token-1',
      kmsKeyVersion: 'v1',
      createdAtMs: 1000,
    });
    expect(d.client.revokeToken).toHaveBeenCalledWith('refresh-token-1', 'refresh_token');
    expect(d.repository.clear).toHaveBeenCalledWith('del-1');
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
  });

  it('fails PROVIDER_AUTHORIZATION_INVALID (terminal) when no authorizationCode and nothing cached', async () => {
    const d = deps();
    const outcome = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'PROVIDER_AUTHORIZATION_INVALID' });
    expect(d.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('propagates an exchange failure verbatim (already in the shared taxonomy)', async () => {
    const d = deps({
      client: {
        exchangeAuthorizationCode: vi
          .fn()
          .mockRejectedValue(new AppleIdentityApiError('PROVIDER_AUTHORIZATION_INVALID', 400)),
        revokeToken: vi.fn(),
      },
    });
    const outcome = await revokeAppleProvider(BASE_INPUT, d);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'PROVIDER_AUTHORIZATION_INVALID' });
    expect(d.client.revokeToken).not.toHaveBeenCalled();
    // A spent/invalid code is never retried against the exchange endpoint again by this same path.
  });

  it('still attempts revoke even when persisting the material fails (best-effort, spent-code awareness)', async () => {
    const d = deps({ repository: { ...fakeRepository(), save: vi.fn().mockRejectedValue(new Error('firestore down')) } as never });
    const outcome = await revokeAppleProvider(BASE_INPUT, d);
    expect(d.client.revokeToken).toHaveBeenCalledWith('refresh-token-1', 'refresh_token');
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
  });
});

describe('revokeAppleProvider — retry reusing cached material (idempotency §13/§14)', () => {
  it('a second attempt (e.g. after a revoke timeout) reuses the cached refresh token — no re-exchange', async () => {
    const cached: ApplePendingRevocationMaterial = {
      wrappedRefreshToken: 'wrapped:refresh-token-1',
      kmsKeyVersion: 'v1',
      createdAtMs: 500,
    };
    const repository = fakeRepository(cached);
    const d = deps({ repository });

    // authorizationCode is null on the retry — a spent code is never
    // re-sent, and the orchestration must not need it when material exists.
    const outcome = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);

    expect(d.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(d.unwrap).toHaveBeenCalledWith('wrapped:refresh-token-1');
    expect(d.client.revokeToken).toHaveBeenCalledWith('refresh-token-1', 'refresh_token');
    expect(outcome).toEqual({ kind: 'SUCCEEDED' });
  });

  it('a revoke timeout keeps the cached material (retryable — do not discard)', async () => {
    const cached: ApplePendingRevocationMaterial = {
      wrappedRefreshToken: 'wrapped:refresh-token-1',
      kmsKeyVersion: 'v1',
      createdAtMs: 500,
    };
    const repository = fakeRepository(cached);
    const d = deps({
      repository,
      client: {
        exchangeAuthorizationCode: vi.fn(),
        revokeToken: vi.fn().mockRejectedValue(new AppleIdentityApiError('TIMEOUT')),
      },
    });

    const outcome = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);

    expect(outcome).toEqual({ kind: 'FAILED', code: 'TIMEOUT' });
    expect(repository.clear).not.toHaveBeenCalled();
    expect(repository._peek()).toEqual(cached); // still there for the NEXT retry
  });

  it('a terminal revoke failure clears the cached material — retrying would never help', async () => {
    const cached: ApplePendingRevocationMaterial = {
      wrappedRefreshToken: 'wrapped:refresh-token-1',
      kmsKeyVersion: 'v1',
      createdAtMs: 500,
    };
    const repository = fakeRepository(cached);
    const d = deps({
      repository,
      client: {
        exchangeAuthorizationCode: vi.fn(),
        revokeToken: vi.fn().mockRejectedValue(new AppleIdentityApiError('MISSING_REQUIRED_CONFIGURATION', 401)),
      },
    });

    const outcome = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);

    expect(outcome).toEqual({ kind: 'FAILED', code: 'MISSING_REQUIRED_CONFIGURATION' });
    expect(repository.clear).toHaveBeenCalledWith('del-1');
  });

  it('after a successful attempt clears the material, a hypothetical re-invocation fails cleanly instead of reusing stale state', async () => {
    // In practice `../steps.ts` never lets a worker re-run an already
    // `SUCCEEDED` step (Fase 1's regression guard) — this test only proves
    // this function itself has no latent bad state (e.g. a module-level
    // cache) that would misbehave if it were ever called again regardless.
    const cached: ApplePendingRevocationMaterial = {
      wrappedRefreshToken: 'wrapped:refresh-token-1',
      kmsKeyVersion: 'v1',
      createdAtMs: 500,
    };
    const repository = fakeRepository(cached);
    const d = deps({ repository });

    const first = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);
    expect(first).toEqual({ kind: 'SUCCEEDED' });
    expect(repository._peek()).toBeNull();

    // Material is gone and no fresh code is supplied — correctly reported
    // as needing a new client capture, never silently "succeeding" again
    // via stale in-memory data.
    const second = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);
    expect(second).toEqual({ kind: 'FAILED', code: 'PROVIDER_AUTHORIZATION_INVALID' });
  });
});

describe('revokeAppleProvider — unwrap failure', () => {
  it('a corrupted cached wrapped token fails PROVIDER_RESPONSE_INVALID without calling revoke', async () => {
    const cached: ApplePendingRevocationMaterial = {
      wrappedRefreshToken: 'corrupted',
      kmsKeyVersion: 'v1',
      createdAtMs: 500,
    };
    const repository = fakeRepository(cached);
    const d = deps({ repository, unwrap: vi.fn().mockRejectedValue(new Error('KMS decrypt failed')) });

    const outcome = await revokeAppleProvider({ ...BASE_INPUT, authorizationCode: null }, d);
    expect(outcome).toEqual({ kind: 'FAILED', code: 'PROVIDER_RESPONSE_INVALID' });
    expect(d.client.revokeToken).not.toHaveBeenCalled();
  });
});
