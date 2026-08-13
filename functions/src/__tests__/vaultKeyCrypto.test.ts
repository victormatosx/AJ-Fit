import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from 'firebase-functions/v2';
import {
  KMS_CRYPTO_KEY,
  KMS_KEY_RING,
  KMS_LOCATION,
  cryptoKeyName,
  resolveProjectId,
  setKmsClientForTesting,
} from '../photoVault/kmsClient';
import { VaultCryptoError } from '../photoVault/errors';
import { VAULT_KEY_BYTES, unwrapVaultKey, wrapVaultKey } from '../photoVault/vaultKeyCrypto';

const PROJECT = 'ajfit-test-project';
const EXPECTED_NAME =
  `projects/${PROJECT}/locations/${KMS_LOCATION}` +
  `/keyRings/${KMS_KEY_RING}/cryptoKeys/${KMS_CRYPTO_KEY}`;
/** What KMS actually returns in `EncryptResponse.name`: the version used. */
const EXPECTED_VERSION_NAME = `${EXPECTED_NAME}/cryptoKeyVersions/3`;

/** A deterministic stand-in for a real 32-byte Vault Key. */
function vaultKey(fill = 7): Uint8Array {
  return new Uint8Array(VAULT_KEY_BYTES).fill(fill);
}

/** Minimal KMS stub. `encrypt`/`decrypt` mirror the real tuple-returning API. */
function stubKms(overrides: Record<string, unknown> = {}) {
  const encrypt = vi.fn(async ({ plaintext }: { plaintext: Uint8Array }) => [
    {
      name: EXPECTED_VERSION_NAME,
      ciphertext: Buffer.concat([Buffer.from('KMS:'), Buffer.from(plaintext)]),
    },
  ]);
  const decrypt = vi.fn(async ({ ciphertext }: { ciphertext: Buffer }) => [
    { plaintext: Buffer.from(ciphertext).subarray(4) },
  ]);
  const stub = { encrypt, decrypt, ...overrides };
  setKmsClientForTesting(stub as never);
  return stub as { encrypt: typeof encrypt; decrypt: typeof decrypt };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GCLOUD_PROJECT = PROJECT;
});

afterEach(() => {
  setKmsClientForTesting(undefined);
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.FIREBASE_PROJECT_ID;
});

// ── Resource name construction ─────────────────────────────────────────────

describe('cryptoKeyName', () => {
  it('builds the fully-qualified CryptoKey resource name', () => {
    expect(cryptoKeyName()).toBe(EXPECTED_NAME);
  });

  it('pins the key to the Photo Vault key ring, never a shared key', () => {
    expect(KMS_KEY_RING).toBe('ajfit-photo-vault');
    expect(KMS_CRYPTO_KEY).toBe('photo-vault-kek');
  });

  it('pins the location to the Cloud Functions region', () => {
    expect(KMS_LOCATION).toBe('us-central1');
  });

  it('falls back to GOOGLE_CLOUD_PROJECT when GCLOUD_PROJECT is absent', () => {
    delete process.env.GCLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'other-project';
    expect(cryptoKeyName()).toContain('projects/other-project/');
  });

  it('throws a configuration error when no project is resolvable', () => {
    delete process.env.GCLOUD_PROJECT;
    expect(() => resolveProjectId()).toThrowError(
      expect.objectContaining({ code: 'KMS_CONFIGURATION_ERROR' }),
    );
  });
});

// ── wrapVaultKey ───────────────────────────────────────────────────────────

describe('wrapVaultKey', () => {
  it('encrypts against the Photo Vault KEK and returns base64', async () => {
    const kms = stubKms();
    const { wrappedVaultKey } = await wrapVaultKey(vaultKey());

    expect(kms.encrypt).toHaveBeenCalledTimes(1);
    expect(kms.encrypt.mock.calls[0][0]).toMatchObject({ name: EXPECTED_NAME });
    expect(wrappedVaultKey).toBe(Buffer.from(wrappedVaultKey, 'base64').toString('base64'));
  });

  it('reports the CryptoKeyVersion KMS actually used, never a fabricated one', async () => {
    stubKms();
    const { kmsKeyVersion } = await wrapVaultKey(vaultKey());

    expect(kmsKeyVersion).toBe(EXPECTED_VERSION_NAME);
  });

  it('rejects a response that names the key but not a version', async () => {
    // Without a version we would have nothing trustworthy to persist in
    // `kmsKeyVersion`, so this must fail rather than guess.
    stubKms({
      encrypt: vi.fn(async () => [{ name: EXPECTED_NAME, ciphertext: Buffer.from('x') }]),
    });
    await expect(wrapVaultKey(vaultKey())).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_ENCRYPT_FAILED' }),
    );
  });

  it('rejects a response with no name at all', async () => {
    stubKms({ encrypt: vi.fn(async () => [{ ciphertext: Buffer.from('x') }]) });
    await expect(wrapVaultKey(vaultKey())).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_ENCRYPT_FAILED' }),
    );
  });

  it('passes raw bytes to KMS, never a string', async () => {
    const kms = stubKms();
    await wrapVaultKey(vaultKey());

    const { plaintext } = kms.encrypt.mock.calls[0][0];
    expect(typeof plaintext).not.toBe('string');
    expect(plaintext.length).toBe(VAULT_KEY_BYTES);
  });

  it.each([0, 1, 16, 31, 33, 64])('rejects a vault key of %i bytes', async (size) => {
    stubKms();
    await expect(wrapVaultKey(new Uint8Array(size))).rejects.toThrowError(
      expect.objectContaining({ code: 'INVALID_VAULT_KEY' }),
    );
  });

  it('rejects a non-bytes vault key', async () => {
    stubKms();
    await expect(wrapVaultKey('a'.repeat(32) as never)).rejects.toThrowError(
      expect.objectContaining({ code: 'INVALID_VAULT_KEY' }),
    );
  });

  it('never calls KMS when the input is invalid', async () => {
    const kms = stubKms();
    await expect(wrapVaultKey(new Uint8Array(8))).rejects.toThrow();
    expect(kms.encrypt).not.toHaveBeenCalled();
  });

  it('maps a KMS failure onto KMS_ENCRYPT_FAILED without leaking the cause', async () => {
    stubKms({
      encrypt: vi.fn(async () => {
        throw new Error('PERMISSION_DENIED on projects/secret-project/keyRings/x');
      }),
    });

    const error = await wrapVaultKey(vaultKey()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect((error as VaultCryptoError).code).toBe('KMS_ENCRYPT_FAILED');
    expect((error as Error).message).not.toContain('secret-project');
    expect((error as Error).message).not.toContain('PERMISSION_DENIED');
  });

  it('rejects an empty ciphertext from KMS', async () => {
    stubKms({ encrypt: vi.fn(async () => [{ name: EXPECTED_NAME, ciphertext: Buffer.alloc(0) }]) });
    await expect(wrapVaultKey(vaultKey())).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_ENCRYPT_FAILED' }),
    );
  });

  it('rejects a response produced by a different key', async () => {
    stubKms({
      encrypt: vi.fn(async () => [
        { name: 'projects/p/locations/l/keyRings/other/cryptoKeys/other', ciphertext: Buffer.from('x') },
      ]),
    });
    await expect(wrapVaultKey(vaultKey())).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_ENCRYPT_FAILED' }),
    );
  });
});

// ── unwrapVaultKey ─────────────────────────────────────────────────────────

describe('unwrapVaultKey', () => {
  it('decrypts against the Photo Vault KEK', async () => {
    const kms = stubKms();
    const { wrappedVaultKey } = await wrapVaultKey(vaultKey());
    await unwrapVaultKey(wrappedVaultKey);

    expect(kms.decrypt).toHaveBeenCalledTimes(1);
    expect(kms.decrypt.mock.calls[0][0]).toMatchObject({ name: EXPECTED_NAME });
  });

  it('round-trips bytes → wrapped → identical bytes', async () => {
    stubKms();
    const original = vaultKey(42);

    const { wrappedVaultKey } = await wrapVaultKey(original);
    const restored = await unwrapVaultKey(wrappedVaultKey);

    expect(Buffer.from(restored)).toEqual(Buffer.from(original));
    expect(restored.length).toBe(VAULT_KEY_BYTES);
  });

  it.each(['', '   ', 'not base64!!', '====', 'YWJj%%%'])(
    'rejects malformed wrapped key: %s',
    async (wrapped) => {
      stubKms();
      await expect(unwrapVaultKey(wrapped)).rejects.toThrowError(
        expect.objectContaining({ code: 'INVALID_WRAPPED_KEY' }),
      );
    },
  );

  it('rejects a non-string wrapped key', async () => {
    stubKms();
    await expect(unwrapVaultKey(Buffer.from('abc') as never)).rejects.toThrowError(
      expect.objectContaining({ code: 'INVALID_WRAPPED_KEY' }),
    );
  });

  it('rejects an oversized wrapped key before calling KMS', async () => {
    const kms = stubKms();
    await expect(unwrapVaultKey('A'.repeat(5000))).rejects.toThrowError(
      expect.objectContaining({ code: 'INVALID_WRAPPED_KEY' }),
    );
    expect(kms.decrypt).not.toHaveBeenCalled();
  });

  it('maps a KMS failure onto KMS_DECRYPT_FAILED without leaking the cause', async () => {
    stubKms({
      decrypt: vi.fn(async () => {
        throw new Error('INVALID_ARGUMENT: projects/secret-project decryption failed');
      }),
    });

    const error = await unwrapVaultKey(Buffer.from('abcd').toString('base64')).catch(
      (e: unknown) => e,
    );
    expect((error as VaultCryptoError).code).toBe('KMS_DECRYPT_FAILED');
    expect((error as Error).message).not.toContain('secret-project');
  });

  it('rejects an empty plaintext from KMS', async () => {
    stubKms({ decrypt: vi.fn(async () => [{ plaintext: Buffer.alloc(0) }]) });
    await expect(unwrapVaultKey(Buffer.from('abcd').toString('base64'))).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_DECRYPT_FAILED' }),
    );
  });

  it('rejects a plaintext whose length is not a valid vault key', async () => {
    stubKms({ decrypt: vi.fn(async () => [{ plaintext: Buffer.alloc(16, 1) }]) });
    await expect(unwrapVaultKey(Buffer.from('abcd').toString('base64'))).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_DECRYPT_FAILED' }),
    );
  });

  it('rejects a missing plaintext field entirely', async () => {
    stubKms({ decrypt: vi.fn(async () => [{}]) });
    await expect(unwrapVaultKey(Buffer.from('abcd').toString('base64'))).rejects.toThrowError(
      expect.objectContaining({ code: 'KMS_DECRYPT_FAILED' }),
    );
  });
});

// ── Logging policy ─────────────────────────────────────────────────────────

describe('logging never receives key material', () => {
  it('logs neither the vault key nor the wrapped key on the happy path', async () => {
    stubKms();
    const key = vaultKey(0xab);
    const { wrappedVaultKey: wrapped } = await wrapVaultKey(key);
    await unwrapVaultKey(wrapped);

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(everythingLogged).not.toContain(wrapped);
    expect(everythingLogged).not.toContain(Buffer.from(key).toString('base64'));
    expect(everythingLogged).not.toContain(Buffer.from(key).toString('hex'));
    // The logger is still used — this test would be vacuous otherwise.
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('logs nothing sensitive when KMS fails', async () => {
    stubKms({ encrypt: vi.fn(async () => { throw new Error('boom'); }) });
    const key = vaultKey(0xcd);

    await wrapVaultKey(key).catch(() => undefined);

    const everythingLogged = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(everythingLogged).not.toContain(Buffer.from(key).toString('base64'));
  });
});
