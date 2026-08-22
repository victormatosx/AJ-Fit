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

// Fase 5: createVault now calls requireActiveAccount before minting a key.
// These tests are about vault-creation policy, not account-deletion
// status, so the guard is stubbed to always allow — see
// activeAccountGuard.test.ts for its own dedicated coverage.
vi.mock('../accountDeletion/activeAccountGuard', () => ({
  requireActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

// The repository is the Firestore boundary; stubbing it keeps these tests
// about policy, not about the emulator.
const createVaultDocument =
  vi.fn<(uid: string, document: Record<string, unknown>) => Promise<void>>();
vi.mock('../photoVault/vaultRepository', async () => {
  const actual = await vi.importActual<typeof import('../photoVault/vaultRepository')>(
    '../photoVault/vaultRepository',
  );
  return {
    ...actual,
    createVaultDocument: (uid: string, document: Record<string, unknown>) =>
      createVaultDocument(uid, document),
  };
});

const wrapVaultKey =
  vi.fn<(vaultKey: Uint8Array) => Promise<{ wrappedVaultKey: string; kmsKeyVersion: string }>>();
vi.mock('../photoVault/vaultKeyCrypto', async () => {
  const actual = await vi.importActual<typeof import('../photoVault/vaultKeyCrypto')>(
    '../photoVault/vaultKeyCrypto',
  );
  return { ...actual, wrapVaultKey: (vaultKey: Uint8Array) => wrapVaultKey(vaultKey) };
});

import { logger } from 'firebase-functions/v2';
import { handleCreateVault } from '../photoVault/createVault';
import { VaultCryptoError } from '../photoVault/errors';
import { VAULT_KEY_BYTES } from '../photoVault/vaultKeyCrypto';
import { VaultAlreadyExistsError } from '../photoVault/vaultRepository';

const UID = 'alice';
const OTHER_UID = 'mallory';

function authed(data: unknown = {}, uid = UID) {
  return { auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) } }, data } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  createVaultDocument.mockResolvedValue(undefined);
  wrapVaultKey.mockResolvedValue({
    wrappedVaultKey: 'd3JhcHBlZC1jaXBoZXJ0ZXh0',
    kmsKeyVersion:
      'projects/p/locations/us-central1/keyRings/ajfit-photo-vault/cryptoKeys/photo-vault-kek/cryptoKeyVersions/1',
  });
});

// ── Authentication ─────────────────────────────────────────────────────────

describe('createVault — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    await expect(handleCreateVault({ data: {} } as never)).rejects.toThrowError(
      expect.objectContaining({ code: 'unauthenticated' }),
    );
  });

  it('never reaches KMS or Firestore without auth', async () => {
    await handleCreateVault({ data: {} } as never).catch(() => undefined);

    expect(wrapVaultKey).not.toHaveBeenCalled();
    expect(createVaultDocument).not.toHaveBeenCalled();
  });

  it('does not require recent auth for the initial creation', async () => {
    const stale = {
      auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000) - 86_400 } },
      data: {},
    } as never;

    await expect(handleCreateVault(stale)).resolves.toMatchObject({ vaultKeyVersion: 1 });
  });
});

// ── Cross-user isolation ───────────────────────────────────────────────────

describe('createVault — the uid always comes from the token', () => {
  it('ignores a uid supplied in the request body', async () => {
    await handleCreateVault(authed({ uid: OTHER_UID }));

    expect(createVaultDocument.mock.calls[0]?.[0]).toBe(UID);
  });

  it.each([
    { uid: OTHER_UID },
    { userId: OTHER_UID },
    { email: 'mallory@example.com' },
    { path: `users/${OTHER_UID}/privateSecurity/photoVault` },
    { documentPath: `users/${OTHER_UID}/privateSecurity/photoVault` },
  ])('ignores %o in the body', async (body) => {
    await handleCreateVault(authed(body));

    expect(createVaultDocument.mock.calls[0]?.[0]).toBe(UID);
  });
});

// ── Key generation ─────────────────────────────────────────────────────────

describe('createVault — vault key generation', () => {
  it('generates exactly 32 bytes and wraps them once', async () => {
    await handleCreateVault(authed());

    expect(wrapVaultKey).toHaveBeenCalledTimes(1);
    const generated = wrapVaultKey.mock.calls[0]![0];
    expect(generated.length).toBe(VAULT_KEY_BYTES);
  });

  it('produces a different key on every call', async () => {
    const first = await handleCreateVault(authed());
    const second = await handleCreateVault(authed());

    expect(first.vaultKey).not.toBe(second.vaultKey);
  });

  it('does not derive the key from the uid or any token value', async () => {
    const { vaultKey } = await handleCreateVault(authed());
    const raw = Buffer.from(vaultKey, 'base64');

    expect(raw.toString('utf8')).not.toContain(UID);
    expect(raw.toString('hex')).not.toContain(Buffer.from(UID).toString('hex'));
  });
});

// ── Persistence ────────────────────────────────────────────────────────────

describe('createVault — persistence', () => {
  it('persists only the wrapped key and its metadata', async () => {
    const { vaultKey } = await handleCreateVault(authed());
    const document = createVaultDocument.mock.calls[0]![1];

    expect(Object.keys(document).sort()).toEqual([
      'algorithm',
      'createdAt',
      'encryptionVersion',
      'kmsKeyVersion',
      'updatedAt',
      'vaultKeyVersion',
      'wrappedVaultKey',
    ]);
    // The plaintext key must appear nowhere in what gets stored.
    expect(JSON.stringify(document)).not.toContain(vaultKey);
    expect(JSON.stringify(document)).not.toContain(Buffer.from(vaultKey, 'base64').toString('hex'));
  });

  it('stores the KMS-reported key version, not a fabricated one', async () => {
    await handleCreateVault(authed());
    const document = createVaultDocument.mock.calls[0]![1];

    expect(document.kmsKeyVersion).toContain('/cryptoKeyVersions/1');
    expect(document.algorithm).toBe('AES-256-GCM');
    expect(document.encryptionVersion).toBe(1);
    expect(document.vaultKeyVersion).toBe(1);
  });

  it('uses server-side timestamps', async () => {
    await handleCreateVault(authed());
    const document = createVaultDocument.mock.calls[0]![1];

    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.updatedAt).toBeInstanceOf(Date);
  });
});

// ── Idempotency and concurrency ────────────────────────────────────────────

describe('createVault — never replaces an existing vault', () => {
  it('maps an existing vault onto already-exists', async () => {
    createVaultDocument.mockRejectedValueOnce(new VaultAlreadyExistsError());

    await expect(handleCreateVault(authed())).rejects.toThrowError(
      expect.objectContaining({ code: 'already-exists' }),
    );
  });

  it('two concurrent calls create exactly one vault', async () => {
    // The repository's create() carries a server-side "must not exist"
    // precondition, so the second writer loses.
    let created = 0;
    createVaultDocument.mockImplementation(async () => {
      if (created > 0) throw new VaultAlreadyExistsError();
      created += 1;
    });

    const results = await Promise.allSettled([
      handleCreateVault(authed()),
      handleCreateVault(authed()),
    ]);

    expect(created).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

// ── Failure handling ───────────────────────────────────────────────────────

describe('createVault — failures leave nothing partial', () => {
  it('writes no document when KMS fails', async () => {
    wrapVaultKey.mockRejectedValueOnce(new VaultCryptoError('KMS_ENCRYPT_FAILED', 'boom'));

    await expect(handleCreateVault(authed())).rejects.toThrowError(
      expect.objectContaining({ code: 'internal' }),
    );
    expect(createVaultDocument).not.toHaveBeenCalled();
  });

  it('returns a generic error when Firestore fails', async () => {
    createVaultDocument.mockRejectedValueOnce(new Error('FAILED_PRECONDITION on projects/secret'));

    const error = await handleCreateVault(authed()).catch((e: unknown) => e);
    expect((error as { code: string }).code).toBe('internal');
    expect((error as Error).message).not.toContain('secret');
  });

  it('never leaks KMS detail to the caller', async () => {
    wrapVaultKey.mockRejectedValueOnce(
      new Error('PERMISSION_DENIED on projects/ajfit/cryptoKeys/photo-vault-kek'),
    );

    const error = await handleCreateVault(authed()).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('photo-vault-kek');
    expect((error as Error).message).not.toContain('PERMISSION_DENIED');
  });
});

// ── Response shape ─────────────────────────────────────────────────────────

describe('createVault — response', () => {
  it('returns only the vault key and its version', async () => {
    const response = await handleCreateVault(authed());

    expect(Object.keys(response).sort()).toEqual(['vaultKey', 'vaultKeyVersion']);
    expect(Buffer.from(response.vaultKey, 'base64').length).toBe(VAULT_KEY_BYTES);
  });

  it('never returns the wrapped key or any KMS resource name', async () => {
    const response = await handleCreateVault(authed());
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('d3JhcHBlZC1jaXBoZXJ0ZXh0');
    expect(serialized).not.toContain('cryptoKeyVersions');
    expect(serialized).not.toContain('keyRings');
  });
});

// ── Logging ────────────────────────────────────────────────────────────────

describe('createVault — logging', () => {
  it('never logs the vault key or the wrapped key', async () => {
    const response = await handleCreateVault(authed());

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(everythingLogged).not.toContain(response.vaultKey);
    expect(everythingLogged).not.toContain('d3JhcHBlZC1jaXBoZXJ0ZXh0');
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('never logs the request body', async () => {
    await handleCreateVault(authed({ uid: OTHER_UID, secret: 'do-not-log-me' }));

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(everythingLogged).not.toContain('do-not-log-me');
    expect(everythingLogged).not.toContain(OTHER_UID);
  });
});
