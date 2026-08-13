import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', async () => {
  class HttpsError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { HttpsError, onCall: (handler: unknown) => handler };
});

const readVaultDocument = vi.fn();
vi.mock('../photoVault/vaultRepository', async () => {
  const actual = await vi.importActual<typeof import('../photoVault/vaultRepository')>(
    '../photoVault/vaultRepository',
  );
  return {
    ...actual,
    readVaultDocument: (...args: unknown[]) => readVaultDocument(...(args as [])),
  };
});

const unwrapVaultKey = vi.fn();
vi.mock('../photoVault/vaultKeyCrypto', async () => {
  const actual = await vi.importActual<typeof import('../photoVault/vaultKeyCrypto')>(
    '../photoVault/vaultKeyCrypto',
  );
  return { ...actual, unwrapVaultKey: (...args: unknown[]) => unwrapVaultKey(...(args as [])) };
});

import { logger } from 'firebase-functions/v2';
import { RECENT_AUTH_MAX_AGE_SECONDS } from '../lib/auth';
import { VaultCryptoError } from '../photoVault/errors';
import { VAULT_ALGORITHM } from '../photoVault/schema';
import { handleRecoverVaultKey } from '../photoVault/recoverVaultKey';
import { VAULT_KEY_BYTES } from '../photoVault/vaultKeyCrypto';

const UID = 'alice';
const OTHER_UID = 'mallory';
const RECOVERED_KEY = Buffer.alloc(VAULT_KEY_BYTES, 0x5a);

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** A request whose token was minted `ageSeconds` ago. */
function authed(ageSeconds = 0, data: unknown = {}, uid = UID) {
  return {
    auth: { uid, token: { auth_time: nowSeconds() - ageSeconds } },
    data,
  } as never;
}

function storedVault(overrides: Record<string, unknown> = {}) {
  return {
    wrappedVaultKey: 'd3JhcHBlZC1jaXBoZXJ0ZXh0',
    encryptionVersion: 1,
    vaultKeyVersion: 1,
    kmsKeyVersion:
      'projects/p/locations/us-central1/keyRings/ajfit-photo-vault/cryptoKeys/photo-vault-kek/cryptoKeyVersions/1',
    algorithm: VAULT_ALGORITHM,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readVaultDocument.mockResolvedValue(storedVault());
  unwrapVaultKey.mockResolvedValue(Buffer.from(RECOVERED_KEY));
});

// ── Authentication ─────────────────────────────────────────────────────────

describe('recoverVaultKey — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(handleRecoverVaultKey({ data: {} } as never)).rejects.toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
  });

  it('never touches Firestore or KMS without auth', async () => {
    await handleRecoverVaultKey({ data: {} } as never).catch(() => undefined);

    expect(readVaultDocument).not.toHaveBeenCalled();
    expect(unwrapVaultKey).not.toHaveBeenCalled();
  });
});

// ── Recent authentication ──────────────────────────────────────────────────

describe('recoverVaultKey — recent authentication is mandatory', () => {
  it('allows a freshly authenticated caller', async () => {
    await expect(handleRecoverVaultKey(authed(0))).resolves.toMatchObject({
      vaultKeyVersion: 1,
    });
  });

  it('allows a token just inside the window', async () => {
    await expect(
      handleRecoverVaultKey(authed(RECENT_AUTH_MAX_AGE_SECONDS - 10)),
    ).resolves.toBeDefined();
  });

  it('rejects a token just outside the window', async () => {
    await expect(
      handleRecoverVaultKey(authed(RECENT_AUTH_MAX_AGE_SECONDS + 10)),
    ).rejects.toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
  });

  it('rejects a long-lived session token', async () => {
    await expect(handleRecoverVaultKey(authed(86_400))).rejects.toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('never reads the vault when auth is stale', async () => {
    await handleRecoverVaultKey(authed(86_400)).catch(() => undefined);

    expect(readVaultDocument).not.toHaveBeenCalled();
    expect(unwrapVaultKey).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'recent', NaN, Infinity])(
    'fails closed when auth_time is %s',
    async (authTime) => {
      const request = { auth: { uid: UID, token: { auth_time: authTime } }, data: {} } as never;

      await expect(handleRecoverVaultKey(request)).rejects.toThrowError(
        expect.objectContaining({ code: 'failed-precondition' }),
      );
    },
  );

  it('fails closed when the token has no claims at all', async () => {
    const request = { auth: { uid: UID }, data: {} } as never;

    await expect(handleRecoverVaultKey(request)).rejects.toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('fails closed on an implausibly future auth_time', async () => {
    await expect(handleRecoverVaultKey(authed(-3600))).rejects.toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('tolerates small clock skew', async () => {
    await expect(handleRecoverVaultKey(authed(-10))).resolves.toBeDefined();
  });

  it('ignores any client-supplied freshness claim in the body', async () => {
    const request = {
      auth: { uid: UID, token: { auth_time: nowSeconds() - 86_400 } },
      data: { auth_time: nowSeconds(), reauthenticated: true, recentAuth: true },
    } as never;

    await expect(handleRecoverVaultKey(request)).rejects.toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });
});

// ── Cross-user isolation ───────────────────────────────────────────────────

describe('recoverVaultKey — the uid always comes from the token', () => {
  it.each([
    { uid: OTHER_UID },
    { userId: OTHER_UID },
    { email: 'mallory@example.com' },
    { path: `users/${OTHER_UID}/privateSecurity/photoVault` },
  ])('reads only the caller vault despite %o in the body', async (body) => {
    await handleRecoverVaultKey(authed(0, body));

    expect(readVaultDocument).toHaveBeenCalledTimes(1);
    expect(readVaultDocument.mock.calls[0][0]).toBe(UID);
  });

  it("never returns another user's key", async () => {
    await handleRecoverVaultKey(authed(0, { uid: OTHER_UID }, UID));

    expect(readVaultDocument).not.toHaveBeenCalledWith(OTHER_UID);
  });
});

// ── Missing or corrupt vault ───────────────────────────────────────────────

describe('recoverVaultKey — vault state', () => {
  it('returns not-found when the user has no vault', async () => {
    readVaultDocument.mockResolvedValueOnce(null);

    await expect(handleRecoverVaultKey(authed(0))).rejects.toThrowError(
      expect.objectContaining({ code: 'not-found' }),
    );
  });

  it('never creates a vault implicitly', async () => {
    readVaultDocument.mockResolvedValueOnce(null);

    await handleRecoverVaultKey(authed(0)).catch(() => undefined);

    expect(unwrapVaultKey).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing wrappedVaultKey', { wrappedVaultKey: undefined }],
    ['an unsupported algorithm', { algorithm: 'AES-128-CBC' }],
    ['a bad vaultKeyVersion', { vaultKeyVersion: 0 }],
    ['an extra field', { rogueField: 'x' }],
  ])('reports data-loss for a stored document with %s', async (_label, overrides) => {
    readVaultDocument.mockResolvedValueOnce(storedVault(overrides));

    await expect(handleRecoverVaultKey(authed(0))).rejects.toThrowError(
      expect.objectContaining({ code: 'data-loss' }),
    );
  });

  it('does not attempt an unwrap on a corrupt document', async () => {
    readVaultDocument.mockResolvedValueOnce(storedVault({ algorithm: 'none' }));

    await handleRecoverVaultKey(authed(0)).catch(() => undefined);

    expect(unwrapVaultKey).not.toHaveBeenCalled();
  });
});

// ── KMS failures ───────────────────────────────────────────────────────────

describe('recoverVaultKey — KMS failures', () => {
  it('maps an unwrap failure onto a generic internal error', async () => {
    unwrapVaultKey.mockRejectedValueOnce(new VaultCryptoError('KMS_DECRYPT_FAILED', 'boom'));

    await expect(handleRecoverVaultKey(authed(0))).rejects.toThrowError(
      expect.objectContaining({ code: 'internal' }),
    );
  });

  it('maps an invalid wrapped key onto a generic internal error', async () => {
    unwrapVaultKey.mockRejectedValueOnce(new VaultCryptoError('INVALID_WRAPPED_KEY', 'boom'));

    await expect(handleRecoverVaultKey(authed(0))).rejects.toThrowError(
      expect.objectContaining({ code: 'internal' }),
    );
  });

  it('never leaks KMS or IAM detail to the caller', async () => {
    unwrapVaultKey.mockRejectedValueOnce(
      new Error('PERMISSION_DENIED projects/ajfit-2f321/cryptoKeys/photo-vault-kek'),
    );

    const error = await handleRecoverVaultKey(authed(0)).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('photo-vault-kek');
    expect((error as Error).message).not.toContain('ajfit-2f321');
    expect((error as Error).message).not.toContain('PERMISSION_DENIED');
  });

  it('rejects a recovered key of the wrong length', async () => {
    // vaultKeyCrypto enforces this; the callable must surface it as a
    // generic failure rather than hand back unvalidated bytes.
    unwrapVaultKey.mockRejectedValueOnce(
      new VaultCryptoError('KMS_DECRYPT_FAILED', 'unwrapped key has an unexpected length'),
    );

    await expect(handleRecoverVaultKey(authed(0))).rejects.toThrowError(
      expect.objectContaining({ code: 'internal' }),
    );
  });
});

// ── Response shape ─────────────────────────────────────────────────────────

describe('recoverVaultKey — response', () => {
  it('returns only the vault key and its version', async () => {
    const response = await handleRecoverVaultKey(authed(0));

    expect(Object.keys(response).sort()).toEqual(['vaultKey', 'vaultKeyVersion']);
    expect(Buffer.from(response.vaultKey, 'base64').length).toBe(VAULT_KEY_BYTES);
  });

  it('returns the stored vault key version', async () => {
    readVaultDocument.mockResolvedValueOnce(storedVault({ vaultKeyVersion: 4 }));

    const response = await handleRecoverVaultKey(authed(0));
    expect(response.vaultKeyVersion).toBe(4);
  });

  it('never returns the wrapped key or KMS metadata', async () => {
    const serialized = JSON.stringify(await handleRecoverVaultKey(authed(0)));

    expect(serialized).not.toContain('d3JhcHBlZC1jaXBoZXJ0ZXh0');
    expect(serialized).not.toContain('cryptoKeyVersions');
    expect(serialized).not.toContain('keyRings');
  });
});

// ── Logging ────────────────────────────────────────────────────────────────

describe('recoverVaultKey — logging', () => {
  it('never logs the recovered key or the wrapped key', async () => {
    const response = await handleRecoverVaultKey(authed(0));

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(everythingLogged).not.toContain(response.vaultKey);
    expect(everythingLogged).not.toContain(RECOVERED_KEY.toString('base64'));
    expect(everythingLogged).not.toContain('d3JhcHBlZC1jaXBoZXJ0ZXh0');
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('never logs the request body', async () => {
    await handleRecoverVaultKey(authed(0, { uid: OTHER_UID, secret: 'do-not-log-me' }));

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(everythingLogged).not.toContain('do-not-log-me');
    expect(everythingLogged).not.toContain(OTHER_UID);
  });
});
