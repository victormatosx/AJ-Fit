import { PhotoVaultError } from './photoVaultErrors';

/**
 * The unlocked session of the Photo Vault.
 *
 * Deliberately NOT a boolean flag. A bare `isUnlocked` would be trivial for
 * any service to forget or bypass, and would survive a user switch. Instead
 * the session records **which uid** it was granted to, and every check
 * re-validates that against the caller's identity — so an unlocked session
 * belonging to user A can never authorize an operation for user B, even if
 * something failed to close it.
 *
 * Plain module, no React: the crypto and service layers must not depend on
 * a Context. `PhotoVaultContext` is the only writer; services are readers
 * through `requirePhotoVaultUnlocked`.
 *
 * Memory only. Persisting this anywhere would defeat the point — a restart
 * must always come back locked.
 */

interface VaultSession {
  uid: string;
  grantedAt: number;
}

let session: VaultSession | null = null;

/** Opens the session after a successful local authentication. */
export function openPhotoVaultSession(uid: string): void {
  if (!uid) throw new PhotoVaultError('vaultUnlockFailed');
  session = { uid, grantedAt: Date.now() };
}

/** Closes the session. Safe to call when already closed. */
export function closePhotoVaultSession(): void {
  session = null;
}

/** Whether `uid` currently holds an unlocked session. */
export function isPhotoVaultUnlockedFor(uid: string | null | undefined): boolean {
  return Boolean(uid) && session !== null && session.uid === uid;
}

/**
 * Gate for every sensitive operation.
 *
 * Throws `vaultLocked` unless the given uid is the one that authenticated.
 * A mismatch also closes the stale session: reaching here with someone
 * else's session means an account change slipped through, and it must not
 * survive the discovery.
 */
export function requirePhotoVaultUnlocked(uid: string): void {
  if (session === null) {
    throw new PhotoVaultError('vaultLocked');
  }
  if (session.uid !== uid) {
    closePhotoVaultSession();
    throw new PhotoVaultError('vaultLocked');
  }
}

/** Test/diagnostic helper. Never returns anything secret. */
export function photoVaultSessionUid(): string | null {
  return session?.uid ?? null;
}
