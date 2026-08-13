import {
  closePhotoVaultSession,
  openPhotoVaultSession,
} from './photoVaultSession';
import {
  PhotoVaultError,
  logPhotoVaultIssue,
  type PhotoVaultIssue,
} from './photoVaultErrors';
import { authenticateForPhotoVault } from '../services/localAuthentication';
import { cleanupPhotoVaultTempFiles } from '../services/photoVaultFileCrypto';
import { activatePhotoVaultScreenProtection } from '../services/photoVaultScreenProtection';

/**
 * The Photo Vault lock state machine.
 *
 * A plain module, not a Context: the lock is a property of the running app,
 * not of a React subtree, and keeping it here means services and tests can
 * reason about it without rendering anything.
 * `state/PhotoVaultContext.tsx` is a thin subscriber that exposes it to the
 * UI — the layering is
 *
 *   UI → PhotoVaultContext → photoVaultLock → photoVaultSession → services
 *
 * Access is mandatory-protected: there is no path from `locked` to
 * `unlocked` that does not go through a successful OS authentication.
 */

export type PhotoVaultStatus = 'locked' | 'authenticating' | 'unlocked';
export type PhotoVaultAppState =
  | 'active'
  | 'background'
  | 'inactive'
  | 'unknown'
  | 'extension';

export type UnlockOutcome = { ok: true } | { ok: false; issue: PhotoVaultIssue };

const SCOPE = 'photoVault.lock';

/** Copy for the OS prompt. */
const PROMPT_MESSAGE = 'Desbloqueie para acessar suas fotos privadas';
const CANCEL_LABEL = 'Cancelar';

// Always starts locked. Never inferred from an existing sign-in, an existing
// vault key or a fresh launch, and never restored from storage.
let status: PhotoVaultStatus = 'locked';
let inFlight: Promise<UnlockOutcome> | null = null;
/** Invalidates an authentication attempt that outlives a background lock. */
let lockGeneration = 0;
/** Mirrors AppState without coupling this plain state machine to React Native. */
let appState: PhotoVaultAppState = 'active';

type ForegroundWaiter = (isActive: boolean) => void;
const foregroundWaiters = new Set<ForegroundWaiter>();

const listeners = new Set<(next: PhotoVaultStatus) => void>();

function setStatus(next: PhotoVaultStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(next);
}

export function getPhotoVaultStatus(): PhotoVaultStatus {
  return status;
}

export function subscribeToPhotoVaultStatus(
  listener: (next: PhotoVaultStatus) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function settleForegroundWaiters(isActive: boolean): void {
  for (const resolve of foregroundWaiters) resolve(isActive);
  foregroundWaiters.clear();
}

/** Initializes the lifecycle mirror without changing the lock state. */
export function initializePhotoVaultAppState(next: PhotoVaultAppState): void {
  appState = next;
  if (next === 'active') settleForegroundWaiters(true);
  if (next === 'background') settleForegroundWaiters(false);
}

/**
 * Applies one native AppState transition to the vault state machine.
 *
 * iOS may briefly report `inactive` while its own Face ID/passcode prompt is
 * in front of the app. While the vault is still `authenticating`, there is no
 * open session or private plaintext to preserve, so that single transition is
 * deferred. A real `background` transition still invalidates the attempt
 * immediately. An already-unlocked vault also locks on the first `inactive`
 * transition, preserving the app-switcher protection.
 */
export function handlePhotoVaultAppStateChange(
  previous: PhotoVaultAppState,
  next: PhotoVaultAppState,
): { locked: boolean } {
  appState = next;

  if (next === 'active') {
    settleForegroundWaiters(true);
    return { locked: false };
  }

  const isVaultOwnedAuthenticationPrompt =
    previous === 'active' && next === 'inactive' && status === 'authenticating';

  if (isVaultOwnedAuthenticationPrompt) {
    return { locked: false };
  }

  settleForegroundWaiters(false);
  lockPhotoVault();
  return { locked: true };
}

function waitForActiveApp(generation: number): Promise<boolean> {
  if (generation !== lockGeneration || appState === 'background') {
    return Promise.resolve(false);
  }
  if (appState === 'active') return Promise.resolve(true);

  return new Promise((resolve) => {
    foregroundWaiters.add(resolve);
  });
}

/**
 * Locks the vault and destroys everything the session made available.
 *
 * Order is deliberate: the session closes and the state flips FIRST, so a
 * failing cleanup can never leave the vault readable. Losing a temp file is
 * recoverable; staying unlocked is not.
 */
export function lockPhotoVault(): void {
  lockGeneration += 1;
  settleForegroundWaiters(false);
  closePhotoVaultSession();
  inFlight = null;
  setStatus('locked');

  try {
    cleanupPhotoVaultTempFiles();
  } catch {
    logPhotoVaultIssue(SCOPE, 'vaultTempCleanupFailed');
  }
}

function issueFor(status: Exclude<Awaited<ReturnType<typeof authenticateForPhotoVault>>['status'], 'success'>): PhotoVaultIssue {
  switch (status) {
    case 'cancelled':
      return 'vaultAuthCancelled';
    case 'lockedOut':
      return 'vaultAuthLockedOut';
    case 'notAvailable':
      return 'vaultAuthUnavailable';
    case 'notEnrolled':
      return 'vaultAuthNotEnrolled';
    case 'notConfigured':
      return 'vaultAuthNotConfigured';
    default:
      return 'vaultAuthFailed';
  }
}

async function runUnlock(uid: string, generation: number): Promise<UnlockOutcome> {
  setStatus('authenticating');

  let issue: PhotoVaultIssue;
  try {
    // A crash/kill may have left plaintext in cache. Fail closed if it cannot
    // be removed before this new private session begins.
    cleanupPhotoVaultTempFiles();

    const result = await authenticateForPhotoVault({
      promptMessage: PROMPT_MESSAGE,
      cancelLabel: CANCEL_LABEL,
    });

    if (
      result.status === 'success' &&
      generation === lockGeneration &&
      (await waitForActiveApp(generation))
    ) {
      // Native protection must be active before the state transition can
      // cause a decrypted image to render.
      await activatePhotoVaultScreenProtection();

      // The app may have left the foreground while native protection was
      // being activated. Never open a session until it is active again, and
      // never survive a real background lock.
      if (
        generation !== lockGeneration ||
        !(await waitForActiveApp(generation))
      ) {
        issue = 'vaultAuthCancelled';
      } else {
        openPhotoVaultSession(uid);
        setStatus('unlocked');
        return { ok: true };
      }
    } else if (result.status === 'success') {
      issue = 'vaultAuthCancelled';
    } else {
      issue = issueFor(result.status);
    }
  } catch (error) {
    issue =
      error instanceof PhotoVaultError
        ? error.issue
        : 'vaultUnlockFailed';
  }

  // Anything other than success returns to locked: `authenticating` is never
  // a terminal state. An older invalidated attempt must not close or relabel
  // a newer attempt/session that started after the lock generation changed.
  if (generation === lockGeneration) {
    closePhotoVaultSession();
    setStatus('locked');
  }
  // Cancelling the OS prompt (or invalidating it through a real background
  // transition) is normal control flow, not an operational error. Keep real
  // authentication/protection failures observable without polluting logs for
  // an intentional user action.
  if (issue !== 'vaultAuthCancelled') logPhotoVaultIssue(SCOPE, issue);
  return { ok: false, issue };
}

/**
 * Runs local authentication and, on success, opens the session.
 *
 * Concurrent callers share the single in-flight attempt rather than opening
 * a second OS prompt — AndroidX `BiometricPrompt` would reject the second
 * one with an error indistinguishable from a user cancellation, and iOS
 * would stack prompts.
 */
export function unlockPhotoVault(uid: string | null | undefined): Promise<UnlockOutcome> {
  if (!uid) {
    return Promise.resolve({ ok: false, issue: 'vaultKeyNotAvailable' });
  }
  if (inFlight) return inFlight;

  const attempt = runUnlock(uid, lockGeneration).finally(() => {
    // A background lock may have allowed a newer explicit attempt to start.
    // The older attempt must not clear that newer in-flight reference.
    if (inFlight === attempt) inFlight = null;
  });
  inFlight = attempt;
  return attempt;
}

/** Test seam: resets module state between cases. */
export function resetPhotoVaultLockForTesting(): void {
  closePhotoVaultSession();
  status = 'locked';
  inFlight = null;
  lockGeneration = 0;
  appState = 'active';
  settleForegroundWaiters(false);
  listeners.clear();
}
