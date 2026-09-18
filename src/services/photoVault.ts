import { httpsCallable } from 'firebase/functions';

import { auth } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import {
  PhotoVaultError,
  isPhotoVaultError,
  logPhotoVaultIssue,
  type PhotoVaultIssue,
} from '../lib/photoVaultErrors';
import {
  deleteVaultKey,
  isValidVaultKeyMaterial,
  isValidVaultKeyVersion,
  readVaultKey,
  saveVaultKey,
  type StoredVaultKey,
} from '../lib/photoVaultKeyStorage';
import { startPhotoVaultTrace, tracePhotoVault } from '../lib/photoVaultDevTrace';

/**
 * Photo Vault client.
 *
 * Owns every conversation with `createVault`/`recoverVaultKey` and the local
 * key storage. Screens never call `httpsCallable` directly, and never see a
 * raw Firebase error.
 *
 * The vault key is handled as the base64 string the backend returns and the
 * Keychain stores. Decoding to bytes happens at the point of use in the
 * encryption layer (a later phase) — converting here and back again would add
 * copies of the key in memory rather than remove them. JavaScript gives no
 * zeroization guarantee either way; that limitation is documented rather than
 * papered over.
 */

/**
 * Client-side freshness window, deliberately tighter than the backend's 5
 * minutes. Being conservative means we ask for reauthentication rather than
 * fire a call the backend will reject at the boundary; the backend remains
 * the authority.
 */
const CLIENT_RECENT_AUTH_MAX_AGE_MS = 4 * 60 * 1000;

interface VaultKeyPayload {
  vaultKey: string;
  vaultKeyVersion: number;
}

export type EnsureVaultKeyResult =
  | { status: 'local-key-available'; vaultKey: string; vaultKeyVersion: number }
  | { status: 'vault-created'; vaultKey: string; vaultKeyVersion: number }
  | { status: 'recovered'; vaultKey: string; vaultKeyVersion: number }
  | { status: 'reauthentication-required' };

function currentUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new PhotoVaultError('vaultKeyNotAvailable');
  return uid;
}

/** Firebase prefixes callable error codes with `functions/`. Accept both. */
function callableCode(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
}

/**
 * Never trusts the callable payload: a malformed response must not become a
 * key that silently fails to decrypt photos later.
 */
function parseVaultKeyPayload(data: unknown): VaultKeyPayload {
  const payload = data as Partial<VaultKeyPayload> | null;

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !isValidVaultKeyMaterial(payload.vaultKey) ||
    !isValidVaultKeyVersion(payload.vaultKeyVersion)
  ) {
    throw new PhotoVaultError('vaultInvalidResponse');
  }

  return { vaultKey: payload.vaultKey, vaultKeyVersion: payload.vaultKeyVersion };
}

async function persist(uid: string, payload: VaultKeyPayload): Promise<void> {
  await saveVaultKey(uid, payload);
}

function fail(scope: string, issue: PhotoVaultIssue): never {
  logPhotoVaultIssue(scope, issue);
  throw new PhotoVaultError(issue);
}

/**
 * Whether the current session authenticated recently enough that
 * `recoverVaultKey` is likely to be accepted.
 *
 * Read from the Firebase-issued token, not from a local clock guess. A false
 * answer only costs an extra reauthentication prompt; the backend still
 * enforces the real window.
 */
export async function hasRecentAuth(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) {
    tracePhotoVault('recentAuth.check', { hasRecentAuth: false, authAgeMs: null, requiredFor: 'recoverVaultKey' });
    return false;
  }

  try {
    const result = await user.getIdTokenResult();
    const authTime = Date.parse(result.authTime);
    if (Number.isNaN(authTime)) {
      tracePhotoVault('recentAuth.check', { hasRecentAuth: false, authAgeMs: null, requiredFor: 'recoverVaultKey' });
      return false;
    }

    const age = Date.now() - authTime;
    const recent = age >= 0 && age <= CLIENT_RECENT_AUTH_MAX_AGE_MS;
    tracePhotoVault('recentAuth.check', { hasRecentAuth: recent, authAgeMs: age, requiredFor: 'recoverVaultKey' });
    return recent;
  } catch {
    tracePhotoVault('recentAuth.check', { hasRecentAuth: false, authAgeMs: null, requiredFor: 'recoverVaultKey' });
    return false;
  }
}

/**
 * Creates the vault for the current user and stores the key locally.
 *
 * If the backend says the vault already exists, this NEVER retries with a new
 * key — a second key would orphan every photo encrypted with the first.
 */
export async function createPhotoVaultKey(): Promise<StoredVaultKey> {
  const uid = currentUid();

  let payload: VaultKeyPayload;
  try {
    const call = httpsCallable(functions, 'createVault');
    payload = parseVaultKeyPayload((await call()).data);
  } catch (err) {
    if (isPhotoVaultError(err)) fail('create', err.issue);

    const code = callableCode(err);
    if (code === 'already-exists') {
      // Expected discovery path after logout removes the device-local key.
      // `ensurePhotoVaultKey` catches this sentinel and recovers the existing
      // key; logging it as an operational error would report a healthy flow.
      throw new PhotoVaultError('vaultAlreadyExists');
    }
    if (code === 'unauthenticated') fail('create', 'vaultKeyNotAvailable');
    fail('create', 'vaultCreateFailed');
  }

  try {
    await persist(uid, payload);
  } catch {
    // The remote vault now exists but the key did not reach the Keychain.
    // Creating another one is the one thing we must not do: the next flow
    // will see `already-exists` and go through recovery instead.
    fail('create', 'vaultStorageFailed');
  }

  return payload;
}

/**
 * Recovers the existing vault key for the current user, e.g. on a new device.
 *
 * Assumes the caller has just reauthenticated. If the backend disagrees, the
 * result is `vaultReauthRequired` — never an automatic retry loop.
 */
export async function recoverPhotoVaultKey(): Promise<StoredVaultKey> {
  const uid = currentUid();

  let payload: VaultKeyPayload;
  try {
    const call = httpsCallable(functions, 'recoverVaultKey');
    payload = parseVaultKeyPayload((await call()).data);
  } catch (err) {
    if (isPhotoVaultError(err)) fail('recover', err.issue);

    const code = callableCode(err);
    if (code === 'failed-precondition') fail('recover', 'vaultReauthRequired');
    if (code === 'not-found') fail('recover', 'vaultKeyNotAvailable');
    if (code === 'unauthenticated') fail('recover', 'vaultKeyNotAvailable');
    fail('recover', 'vaultRecoveryFailed');
  }

  try {
    await persist(uid, payload);
  } catch {
    // The remote vault is untouched and still recoverable; only the local
    // write failed.
    fail('recover', 'vaultStorageFailed');
  }

  return payload;
}

/**
 * One key resolution in flight per uid.
 *
 * Without this, concurrent callers each run the full ladder below
 * independently. On the local-key fast path that is merely wasteful; on the
 * very first photo of a brand-new account it is not, because every caller
 * reaches `createPhotoVaultKey()` and fires its own `createVault` callable.
 * The backend is idempotent (the losers come back `already-exists` and fall
 * through to recovery), so the outcome was never *wrong* — but it spent two
 * extra round trips at the worst possible moment, and it made the first save
 * of an account depend on backend behaviour no client test covers.
 *
 * Saving three poses at once turns that from a theoretical race into the
 * normal path, which is why this exists before the poses were parallelized.
 *
 * Keyed by uid rather than a single global slot: two identities must never
 * share a resolution, and a stale entry for a signed-out user must never be
 * handed to whoever signs in next.
 */
const keyFlights = new Map<string, Promise<EnsureVaultKeyResult>>();

/**
 * Makes the vault key available on this device, doing the least work needed.
 *
 * Order matters: a valid local key short-circuits before any network call, so
 * the common path never touches the backend.
 *
 * Concurrent callers for the same uid share one resolution (see `keyFlights`).
 * The entry is removed once it settles, so a failure is never cached: the next
 * caller retries from scratch rather than inheriting a rejected promise.
 *
 * This function deliberately does not open any UI. When it returns
 * `reauthentication-required`, the caller decides how to ask for the
 * credential and then calls `recoverPhotoVaultKey`.
 */
export async function ensurePhotoVaultKey(): Promise<EnsureVaultKeyResult> {
  // Before the registry lookup: an unauthenticated caller must fail the same
  // way it always has, and must never join or create a flight.
  const uid = currentUid();

  const existing = keyFlights.get(uid);
  if (existing) return existing;

  // `.finally` runs after `flight` is assigned, so the identity check below is
  // safe. Same shape as the in-flight unlock in `lib/photoVaultLock.ts`.
  const flight = runEnsurePhotoVaultKey(uid).finally(() => {
    if (keyFlights.get(uid) === flight) keyFlights.delete(uid);
  });
  keyFlights.set(uid, flight);
  return flight;
}

/** Test seam: drops any in-flight key resolution between cases. */
export function resetPhotoVaultKeyFlightsForTesting(): void {
  keyFlights.clear();
}

async function runEnsurePhotoVaultKey(uid: string): Promise<EnsureVaultKeyResult> {
  // Only the closed `status` vocabulary below is ever traced — never the key,
  // the payload or the uid. The distinction that matters for the save
  // investigation is local (no network) versus created/recovered (a callable
  // round trip on the critical path of the very first photo).
  const finishTrace = startPhotoVaultTrace('vaultKey.ensure.start');

  try {
    const local = await readVaultKey(uid);
    if (local) {
      tracePhotoVault('vaultKey.ensure.branch', { branch: 'local' });
      finishTrace('vaultKey.ensure.result', { status: 'local-key-available' });
      return { status: 'local-key-available', ...local };
    }
  } catch (err) {
    // A corrupted entry was already discarded by the storage layer; fall
    // through and treat this device as having no key.
    if (!isPhotoVaultError(err) || err.issue !== 'vaultLocalKeyCorrupted') {
      throw err;
    }
    logPhotoVaultIssue('ensure', 'vaultLocalKeyCorrupted');
  }

  try {
    tracePhotoVault('vaultKey.ensure.branch', { branch: 'create' });
    const created = await createPhotoVaultKey();
    finishTrace('vaultKey.ensure.result', { status: 'vault-created' });
    return { status: 'vault-created', ...created };
  } catch (err) {
    if (!isPhotoVaultError(err) || err.issue !== 'vaultAlreadyExists') {
      finishTrace('vaultKey.ensure.result', {
        status: 'error',
        issue: isPhotoVaultError(err) ? err.issue : 'unknown',
      });
      throw err;
    }
  }

  // The vault exists remotely but not here: this is the new-device path.
  if (!(await hasRecentAuth())) {
    tracePhotoVault('vaultKey.ensure.branch', { branch: 'reauth-required' });
    finishTrace('vaultKey.ensure.result', { status: 'reauthentication-required' });
    return { status: 'reauthentication-required' };
  }

  try {
    tracePhotoVault('vaultKey.ensure.branch', { branch: 'recover' });
    const recovered = await recoverPhotoVaultKey();
    finishTrace('vaultKey.ensure.result', { status: 'recovered' });
    return { status: 'recovered', ...recovered };
  } catch (err) {
    // The backend is the authority on freshness; if it disagrees with our
    // conservative check, surface the reauth requirement instead of looping.
    if (isPhotoVaultError(err) && err.issue === 'vaultReauthRequired') {
      finishTrace('vaultKey.ensure.result', { status: 'reauthentication-required' });
      return { status: 'reauthentication-required' };
    }
    finishTrace('vaultKey.ensure.result', {
      status: 'error',
      issue: isPhotoVaultError(err) ? err.issue : 'unknown',
    });
    throw err;
  }
}

/**
 * Removes this device's copy of the vault key.
 *
 * Called on logout: the key is recoverable from the backend, so keeping it on
 * a device whose session was explicitly ended buys nothing and leaves a
 * secret behind.
 */
export async function clearLocalPhotoVaultKey(uid: string): Promise<void> {
  await deleteVaultKey(uid);
}
