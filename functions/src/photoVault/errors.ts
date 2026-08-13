/**
 * Controlled error taxonomy for the Photo Vault cryptographic layer.
 *
 * These errors are INTERNAL. They must never be returned verbatim to the
 * mobile client — a future callable function is responsible for mapping them
 * onto a generic `HttpsError` so that no Google Cloud detail (key names,
 * project, IAM state, KMS status codes) leaks off the backend.
 *
 * The `message` of these errors must never contain key material. Only the
 * code, the operation and sanitized shape information (lengths, booleans).
 */
export type VaultErrorCode =
  | 'KMS_CONFIGURATION_ERROR'
  | 'KMS_ENCRYPT_FAILED'
  | 'KMS_DECRYPT_FAILED'
  | 'INVALID_VAULT_KEY'
  | 'INVALID_WRAPPED_KEY';

export class VaultCryptoError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'VaultCryptoError';
    this.code = code;
  }
}

export function isVaultCryptoError(err: unknown): err is VaultCryptoError {
  return err instanceof VaultCryptoError;
}
