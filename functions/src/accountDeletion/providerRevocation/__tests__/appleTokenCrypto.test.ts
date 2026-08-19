import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APPLE_REVOCATION_KMS_CRYPTO_KEY,
  APPLE_REVOCATION_KMS_KEY_RING,
  APPLE_REVOCATION_KMS_LOCATION,
  appleRevocationCryptoKeyName,
  setAppleRevocationKmsClientForTesting,
} from '../appleKmsClient';
import { AppleTokenCryptoError, unwrapAppleRefreshToken, wrapAppleRefreshToken } from '../appleTokenCrypto';

const PROJECT = 'ajfit-test-project';
const EXPECTED_NAME =
  `projects/${PROJECT}/locations/${APPLE_REVOCATION_KMS_LOCATION}` +
  `/keyRings/${APPLE_REVOCATION_KMS_KEY_RING}/cryptoKeys/${APPLE_REVOCATION_KMS_CRYPTO_KEY}`;
const EXPECTED_VERSION_NAME = `${EXPECTED_NAME}/cryptoKeyVersions/1`;

function stubKms(overrides: Record<string, unknown> = {}) {
  const encrypt = vi.fn(async ({ plaintext }: { plaintext: Buffer }) => [
    { name: EXPECTED_VERSION_NAME, ciphertext: Buffer.concat([Buffer.from('KMS:'), plaintext]) },
  ]);
  const decrypt = vi.fn(async ({ ciphertext }: { ciphertext: Buffer }) => [
    { plaintext: Buffer.from(ciphertext).subarray(4) },
  ]);
  const stub = { encrypt, decrypt, ...overrides };
  setAppleRevocationKmsClientForTesting(stub as never);
  return stub as { encrypt: typeof encrypt; decrypt: typeof decrypt };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GCLOUD_PROJECT = PROJECT;
});

afterEach(() => {
  setAppleRevocationKmsClientForTesting(undefined);
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.FIREBASE_PROJECT_ID;
});

describe('appleRevocationCryptoKeyName', () => {
  it('is pinned to a dedicated key, never the Photo Vault KEK', () => {
    expect(appleRevocationCryptoKeyName()).toBe(EXPECTED_NAME);
    expect(APPLE_REVOCATION_KMS_KEY_RING).not.toBe('ajfit-photo-vault');
    expect(APPLE_REVOCATION_KMS_CRYPTO_KEY).not.toBe('photo-vault-kek');
  });
});

describe('wrapAppleRefreshToken / unwrapAppleRefreshToken', () => {
  it('round-trips a refresh token through the KMS stub', async () => {
    const kms = stubKms();
    const wrapped = await wrapAppleRefreshToken('super-secret-refresh-token');
    expect(wrapped.kmsKeyVersion).toBe(EXPECTED_VERSION_NAME);
    expect(kms.encrypt).toHaveBeenCalledOnce();

    const unwrapped = await unwrapAppleRefreshToken(wrapped.wrappedToken);
    expect(unwrapped).toBe('super-secret-refresh-token');
  });

  it('rejects an empty token before ever calling KMS', async () => {
    const kms = stubKms();
    await expect(wrapAppleRefreshToken('')).rejects.toBeInstanceOf(AppleTokenCryptoError);
    expect(kms.encrypt).not.toHaveBeenCalled();
  });

  it('never attaches the raw KMS error (which can carry project/IAM details)', async () => {
    stubKms({ encrypt: vi.fn().mockRejectedValue(new Error('IAM permission denied on project X')) });
    let caught: unknown;
    try {
      await wrapAppleRefreshToken('token');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppleTokenCryptoError);
    expect(String(caught)).not.toContain('IAM permission denied');
  });

  it('rejects an empty ciphertext response from KMS', async () => {
    stubKms({ encrypt: vi.fn().mockResolvedValue([{ name: EXPECTED_VERSION_NAME, ciphertext: Buffer.alloc(0) }]) });
    await expect(wrapAppleRefreshToken('token')).rejects.toBeInstanceOf(AppleTokenCryptoError);
  });

  it('rejects a KMS response whose key version does not match the requested key', async () => {
    stubKms({
      encrypt: vi.fn().mockResolvedValue([{ name: 'projects/other/cryptoKeyVersions/9', ciphertext: Buffer.from('x') }]),
    });
    await expect(wrapAppleRefreshToken('token')).rejects.toBeInstanceOf(AppleTokenCryptoError);
  });

  it('rejects malformed base64 on unwrap', async () => {
    stubKms();
    await expect(unwrapAppleRefreshToken('not-base64!!!')).rejects.toBeInstanceOf(AppleTokenCryptoError);
  });

  it('rejects an empty plaintext response from KMS on unwrap', async () => {
    stubKms({ decrypt: vi.fn().mockResolvedValue([{ plaintext: Buffer.alloc(0) }]) });
    await expect(unwrapAppleRefreshToken(Buffer.from('abc').toString('base64'))).rejects.toBeInstanceOf(
      AppleTokenCryptoError,
    );
  });
});
