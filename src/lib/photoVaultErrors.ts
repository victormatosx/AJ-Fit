import { logError } from './logger';

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
  /**
   * Sweeping `photo-vault/share/` failed. Deliberately distinct from
   * `vaultTempCleanupFailed`: the two directories have different retention
   * rules (see photoVaultFileCrypto.ts), so a log should be able to tell
   * which sweep failed without carrying anything private.
   */
  | 'vaultShareCleanupFailed'
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
  /**
   * A photo already occupies this (day, pose). The document id IS that pair,
   * so Firestore refuses the write — the client check is only a courtesy.
   */
  | 'vaultPhotoSlotTaken'
  // Replacing a persisted photo (phase 14F)
  /** The slot no longer holds the photo the replacement expected. */
  | 'vaultReplaceSlotChanged'
  /** The slot is empty: there is nothing to replace. */
  | 'vaultReplaceSlotMissing'
  /** The chosen photo belongs to another day, so it is a new photo, not a swap. */
  | 'vaultReplaceDateMismatch'
  /**
   * The old metadata was removed, the new one could not be written, and the
   * old one could not be restored. The ciphertext is deliberately preserved.
   */
  | 'vaultReplaceRestoreFailed'
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
  | 'vaultScreenProtectionFailed'
  // Thumbnail visibility ownership (phase 15D-0)
  /**
   * A surface released thumbnail visibility it did not hold. The count is
   * clamped at zero rather than going negative, so the symptom is a leaked
   * reference somewhere else — never a corrupted map. Carries no photo id.
   */
  | 'vaultThumbnailOwnershipUnderflow'
  // Progress comparison (phase 15D)
  /** Either full image could not be loaded through the secure Vault pipeline. */
  | 'compareFullLoadFailed'
  /** An async result belonged to an older Vault session. */
  | 'compareSessionInvalidated'
  /** A branded comparison JPEG could not be captured or materialized. */
  | 'compareCaptureFailed'
  /** Native sharing is not supported in the current environment. */
  | 'compareShareUnavailable'
  /** The native share handoff could not be opened or completed. */
  | 'compareShareFailed';

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
  logError(
    `photoVault:${scope}`,
    new Error(issue),
    code ? { issue, providerCode: code } : { issue },
  );
}
