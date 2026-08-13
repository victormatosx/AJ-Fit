/**
 * Controlled error model for the Photo Vault client
 * (docs/20_backend_functions_photo_vault.md).
 *
 * Screens must react to `issue`, never to a raw Firebase code — the backend
 * deliberately returns generic errors, and mirroring them one-to-one in the
 * UI would leak backend semantics into the presentation layer.
 *
 * No message here ever carries key material.
 */
export type PhotoVaultIssue =
  // Vault key lifecycle (phase 7)
  | 'vaultKeyNotAvailable'
  | 'vaultAlreadyExists'
  | 'vaultReauthRequired'
  | 'vaultRecoveryFailed'
  | 'vaultCreateFailed'
  | 'vaultStorageFailed'
  | 'vaultInvalidResponse'
  | 'vaultLocalKeyCorrupted'
  // Photo encryption (phase 8)
  | 'vaultCryptoInvalidKey'
  | 'vaultCryptoEncryptFailed'
  | 'vaultCryptoDecryptFailed'
  | 'vaultCryptoInvalidFile'
  | 'vaultCryptoUnsupportedVersion'
  | 'vaultCryptoIntegrityFailed'
  | 'vaultFileReadFailed'
  | 'vaultFileWriteFailed'
  | 'vaultTempCleanupFailed'
  // Cloud pipeline (phase 9)
  | 'vaultPhotoTooLarge'
  | 'vaultUploadFailed'
  | 'vaultUploadRollbackFailed'
  | 'vaultMetadataCreateFailed'
  | 'vaultMetadataInvalid'
  | 'vaultListFailed'
  | 'vaultDownloadFailed'
  | 'vaultDownloadIntegrityFailed'
  | 'vaultDeleteFailed'
  | 'vaultPartialDelete'
  // Local authentication and vault session (phase 10)
  | 'vaultAuthUnavailable'
  | 'vaultAuthNotEnrolled'
  | 'vaultAuthNotConfigured'
  | 'vaultAuthCancelled'
  | 'vaultAuthFailed'
  | 'vaultAuthLockedOut'
  | 'vaultLocked'
  | 'vaultUnlockFailed'
  // Visual privacy (phase 12)
  | 'vaultScreenProtectionUnavailable'
  | 'vaultScreenProtectionFailed';

export class PhotoVaultError extends Error {
  readonly issue: PhotoVaultIssue;

  constructor(issue: PhotoVaultIssue) {
    super(issue);
    this.name = 'PhotoVaultError';
    this.issue = issue;
  }
}

export function isPhotoVaultError(err: unknown): err is PhotoVaultError {
  return err instanceof PhotoVaultError;
}

/**
 * Extracts a provider error code (`storage/unauthorized`,
 * `permission-denied`, …) from an unknown error.
 *
 * The code alone is safe to log: it names a failure mode, never a key, a
 * token, a path or a payload. Anything that is not a short, code-shaped
 * string is dropped rather than risked.
 */
export function sanitizedErrorCode(err: unknown): string | undefined {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';

  return /^[a-z0-9/_-]{1,64}$/i.test(raw) ? raw : undefined;
}

/**
 * Logs a Photo Vault failure.
 *
 * Deliberately never receives the error object, the callable payload or the
 * response: any of those could carry the vault key or a token. Only the
 * internal issue and, when available, a sanitized provider code — without
 * which a failure in the field is undiagnosable.
 */
export function logPhotoVaultIssue(
  scope: string,
  issue: PhotoVaultIssue,
  code?: string,
): void {
  console.error(`[photoVault:${scope}]`, code ? { issue, code } : { issue });
}
