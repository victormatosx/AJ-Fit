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

/**
 * Monotonic counter identifying the current session instance.
 *
 * A long download started under one session must not be able to finish under
 * another. The uid check alone cannot see that: logging out and back in as the
 * SAME user produces a matching uid, yet it is a different session and a
 * result computed for the old one must be discarded. Callers capture this
 * value when they start and re-check it before acting on the result.
 */
let sessionGeneration = 0;

/** Opens the session after a successful local authentication. */
export function openPhotoVaultSession(uid: string): void {
  if (!uid) throw new PhotoVaultError('vaultUnlockFailed');
  session = { uid, grantedAt: Date.now() };
  sessionGeneration += 1;
}

/** Closes the session. Safe to call when already closed. */
export function closePhotoVaultSession(): void {
  if (session !== null) sessionGeneration += 1;
  session = null;
}

/** Current session instance id. Not a secret; carries no identity. */
export function photoVaultSessionGeneration(): number {
  return sessionGeneration;
}

/**
 * Throws unless `uid` still holds the very same session that `generation` was
 * captured from. Stricter than `requirePhotoVaultUnlocked`: it also rejects a
 * result produced before a logout/login cycle of the same account.
 */
export function requireSamePhotoVaultSession(uid: string, generation: number): void {
  requirePhotoVaultUnlocked(uid);
  if (generation !== sessionGeneration) {
    throw new PhotoVaultError('vaultLocked');
  }
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
