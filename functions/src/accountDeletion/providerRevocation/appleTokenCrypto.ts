/**
 * Envelope encryption for the Apple refresh token temporarily persisted
 * during provider revocation — Fase 3 §14/§15.
 *
 * Why this exists at all: Apple's authorization code is single-use and
 * short-lived (~5 minutes, per Apple's Sign in with Apple documentation).
 * Once exchanged for a refresh token, that code can never be exchanged
 * again. If the SUBSEQUENT `/auth/revoke` call times out, a naive retry
 * that re-attempts the whole flow (including a fresh token exchange with
 * the now-spent authorization code) would fail with `invalid_grant`, even
 * though the token exchange itself already succeeded and Apple may or may
 * not have already processed the revoke. The fix is NOT to retry the
 * exchange — it is to persist the resulting refresh token, encrypted,
 * just long enough to retry ONLY the revoke call.
 *
 * Mirrors `functions/src/photoVault/vaultKeyCrypto.ts` exactly (same
 * envelope-encryption shape, same "the KMS error is never attached"
 * discipline), against the dedicated key in `appleKmsClient.ts`.
 */

import { AppleRevocationKmsConfigurationError, appleRevocationCryptoKeyName, getAppleRevocationKmsClient } from './appleKmsClient';

export class AppleTokenCryptoError extends Error {
  constructor(reason: string) {
    super(`Apple token crypto failed: ${reason}`);
    this.name = 'AppleTokenCryptoError';
  }
}

const MAX_TOKEN_LENGTH = 8192; // generous ceiling for an Apple refresh token; rejects absurd input before it reaches KMS
const MAX_WRAPPED_TOKEN_BASE64_LENGTH = 16384;

export interface WrappedAppleToken {
  /** Ciphertext, base64 — the exact form persisted temporarily in the backend-only repository (`appleRevocationRepository.ts`). */
  wrappedToken: string;
  /** Fully-qualified CryptoKeyVersion that produced the ciphertext, taken from the KMS response — never inferred or hardcoded. */
  kmsKeyVersion: string;
}

export async function wrapAppleRefreshToken(refreshToken: string): Promise<WrappedAppleToken> {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new AppleTokenCryptoError('refresh token must be a non-empty string');
  }
  if (refreshToken.length > MAX_TOKEN_LENGTH) {
    throw new AppleTokenCryptoError('refresh token exceeds the size limit');
  }

  const name = appleRevocationCryptoKeyName();

  let response;
  try {
    [response] = await getAppleRevocationKmsClient().encrypt({
      name,
      plaintext: Buffer.from(refreshToken, 'utf8'),
    });
  } catch (error) {
    if (error instanceof AppleRevocationKmsConfigurationError) throw error;
    // The KMS error is deliberately not attached: it can carry project, key
    // and IAM details that must not travel further — same discipline as
    // vaultKeyCrypto.ts.
    throw new AppleTokenCryptoError('KMS rejected the encrypt request');
  }

  const ciphertext = response?.ciphertext;
  if (!ciphertext || ciphertext.length === 0) {
    throw new AppleTokenCryptoError('KMS returned an empty ciphertext');
  }

  const kmsKeyVersion = response?.name;
  if (!kmsKeyVersion || !kmsKeyVersion.startsWith(`${name}/cryptoKeyVersions/`)) {
    throw new AppleTokenCryptoError('KMS response key mismatch');
  }

  return { wrappedToken: Buffer.from(ciphertext).toString('base64'), kmsKeyVersion };
}

export async function unwrapAppleRefreshToken(wrappedToken: string): Promise<string> {
  if (typeof wrappedToken !== 'string' || wrappedToken.length === 0) {
    throw new AppleTokenCryptoError('wrapped token must be a non-empty string');
  }
  if (wrappedToken.length > MAX_WRAPPED_TOKEN_BASE64_LENGTH) {
    throw new AppleTokenCryptoError('wrapped token exceeds the size limit');
  }

  const ciphertext = Buffer.from(wrappedToken, 'base64');
  if (ciphertext.length === 0 || ciphertext.toString('base64') !== wrappedToken) {
    throw new AppleTokenCryptoError('wrapped token is not valid base64');
  }

  let response;
  try {
    [response] = await getAppleRevocationKmsClient().decrypt({
      name: appleRevocationCryptoKeyName(),
      ciphertext,
    });
  } catch (error) {
    if (error instanceof AppleRevocationKmsConfigurationError) throw error;
    throw new AppleTokenCryptoError('KMS rejected the decrypt request');
  }

  const plaintext = response?.plaintext;
  if (!plaintext || plaintext.length === 0) {
    throw new AppleTokenCryptoError('KMS returned an empty plaintext');
  }

  return Buffer.from(plaintext).toString('utf8');
}
