/**
 * `VAULT_KEY_DESTRUCTION` step executor — Fase 12.5.
 *
 * Point of no return (`steps.ts`'s `POINT_OF_NO_RETURN_STEP`) — see that
 * module's doc comment for why: this step is what makes every remaining
 * Photo Vault ciphertext permanently undecipherable, regardless of any
 * later action.
 *
 * CRYPTOGRAPHIC MODEL (Fase 12.5 audit — see the phase report for the full
 * trace): envelope encryption. A project-wide KMS KEK
 * (`../photoVault/kmsClient.ts`'s `photo-vault-kek`) wraps each user's
 * 32-byte Vault Key (DEK). The KEK is SHARED across every user and is NEVER
 * touched here — destroying it would make every user's vault unrecoverable,
 * not just this one. The only backend copy of THIS user's wrapped DEK is
 * `users/{uid}/privateSecurity/photoVault` (`wrappedVaultKey` +
 * `kmsKeyVersion`) — confirmed by exhaustive audit: no recovery blob, no
 * backup, no rotated/legacy key document exists anywhere in the schema.
 * `recoverVaultKey.ts` re-reads and re-unwraps this exact same document.
 *
 * SECURITY PROPERTY this step establishes: "Vault cryptographically
 * destroyed" = the wrapped DEK ciphertext for this uid no longer exists
 * anywhere backend-controlled. Photo ciphertext in Cloud Storage MAY still
 * exist at this point (Storage Cleanup is a later, independent step) — that
 * is acceptable and expected: without the wrapped DEK, no material known to
 * AJ Fit's backend can ever unwrap a key to decrypt it again, regardless of
 * whether the shared KEK itself remains operational for other users.
 *
 * Single responsibility (Fase 12.5 §6): deletes ONLY
 * `users/{uid}/privateSecurity/photoVault` (via
 * `../photoVault/vaultRepository.ts`'s `deleteVaultDocument`, the sole
 * writer that removes it) — never touches other Firestore data, Storage,
 * Support, Coupon, RevenueCat, provider links, or client state. Those
 * remain other steps' jobs.
 *
 * BACKEND ONLY, no KMS call: destruction never asks KMS to do anything (no
 * encrypt, no decrypt, no key-version disable) — it only removes the
 * Firestore document holding the wrapped ciphertext. This is deliberate:
 * KMS's CryptoKeyVersion is shared infrastructure, never a per-deletion
 * target.
 */

import { deleteVaultDocument } from '../photoVault/vaultRepository';
import type { AccountDeletionStepOutcome, KnownErrorCode } from './errors';

/**
 * Maps a Firestore error from the delete call to the shared taxonomy — same
 * gRPC numeric-code vocabulary `firestoreCleanup/engine.ts` and
 * `retainedDataProcessing/engine.ts` already use. `deleteVaultDocument`
 * itself never throws "not found" (plain Firestore `.delete()` on a missing
 * document succeeds silently) — every code below is a genuine
 * infrastructure/configuration failure, never a "logical success in
 * disguise" case.
 */
function classifyVaultKeyDestructionError(error: unknown): KnownErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  switch (code) {
    case 4:
      return 'DEADLINE_EXCEEDED';
    case 14:
      return 'UNAVAILABLE';
    case 8:
      return 'RESOURCE_EXHAUSTED';
    case 7:
      return 'MISSING_REQUIRED_CONFIGURATION';
    default:
      return 'INTERNAL_TRANSIENT';
  }
}

/**
 * Runs one attempt of `VAULT_KEY_DESTRUCTION` for `uid`. `uid` must come
 * exclusively from the deletion workflow's own trusted context (the
 * record's `uid` field), never a client-supplied value — this function has
 * no client-facing entry point of its own.
 *
 * Idempotent by construction: deleting an already-absent document is a
 * silent no-op success (Fase 12.5 §20), so a retry after a partial failure,
 * or a duplicate execution by two workers, both converge on the same
 * `SUCCEEDED` outcome without ever attempting to recreate destroyed
 * material (§25 — no rollback, ever).
 */
export async function executeVaultKeyDestruction(
  uid: string,
  deps: { deleteVaultDocument?: (uid: string) => Promise<void> } = {},
): Promise<AccountDeletionStepOutcome> {
  const destroy = deps.deleteVaultDocument ?? deleteVaultDocument;

  try {
    await destroy(uid);
  } catch (error) {
    return { kind: 'FAILED', code: classifyVaultKeyDestructionError(error) };
  }

  return { kind: 'SUCCEEDED' };
}
