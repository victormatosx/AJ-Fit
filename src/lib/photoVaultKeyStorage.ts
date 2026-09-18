import * as SecureStore from 'expo-secure-store';

import { PhotoVaultError } from './photoVaultErrors';
import { tracePhotoVault } from './photoVaultDevTrace';
import { photoVaultSessionGeneration } from './photoVaultSession';

/**
 * Device-local storage for the user's Photo Vault Key.
 *
 * Deliberately separate from `secureAuthStorage`: the Firebase session and
 * the vault key are secrets with different lifecycles (the session rotates
 * constantly and dies on logout; the vault key is stable for the life of the
 * account and is recoverable from the backend). Sharing one blob would tie
 * them together and make the vault key collateral damage of any session
 * problem.
 *
 * The key is stored in the OS Keychain/Keystore via expo-secure-store. It is
 * NOT yet gated behind biometrics (`requireAuthentication`) — device-local
 * authentication is its own phase, and adding it here would silently change
 * the unlock semantics before the UI is ready for it.
 */

const KEY_PREFIX = 'ajfit_photo_vault_key_v1';

function maskedUid(uid: string): string {
  return uid.length <= 6 ? '***' : `${uid.slice(0, 3)}…${uid.slice(-3)}`;
}

/** AES-256 ⇒ 32 bytes ⇒ exactly 44 base64 characters with one pad. */
const VAULT_KEY_BYTES = 32;

/** SecureStore only accepts these characters in a key. */
const SAFE_UID = /^[A-Za-z0-9._-]+$/;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Byte length of a base64 string, computed from its shape.
 *
 * Avoids `Buffer`/`atob`, neither of which is guaranteed in the React Native
 * runtime, and avoids materializing the decoded key just to measure it.
 * Returns null when the string is not valid base64.
 */
export function base64ByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64.test(value)) return null;

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function isValidVaultKeyMaterial(value: unknown): value is string {
  return typeof value === 'string' && base64ByteLength(value) === VAULT_KEY_BYTES;
}

export function isValidVaultKeyVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export interface StoredVaultKey {
  /** The vault key, base64 — the same representation the backend returns. */
  vaultKey: string;
  vaultKeyVersion: number;
}

/**
 * Per-user namespace. The uid is part of the storage key itself, so a
 * different account physically cannot read another account's entry — this is
 * the primary isolation, not the `uid` field inside the payload.
 */
function storageKeyFor(uid: string): string {
  if (!uid || !SAFE_UID.test(uid)) {
    // Fail closed: a uid we cannot namespace safely must never fall back to
    // a shared key that another account could read.
    throw new PhotoVaultError('vaultStorageFailed');
  }
  return `${KEY_PREFIX}_${uid}`;
}

/** Secondary check only — the namespace above is what actually isolates. */
interface StoredPayload extends StoredVaultKey {
  uid: string;
}

export async function saveVaultKey(uid: string, entry: StoredVaultKey): Promise<void> {
  if (!isValidVaultKeyMaterial(entry.vaultKey) || !isValidVaultKeyVersion(entry.vaultKeyVersion)) {
    throw new PhotoVaultError('vaultInvalidResponse');
  }

  const payload: StoredPayload = {
    uid,
    vaultKey: entry.vaultKey,
    vaultKeyVersion: entry.vaultKeyVersion,
  };

  try {
    await SecureStore.setItemAsync(storageKeyFor(uid), JSON.stringify(payload));
  } catch {
    // The cause is swallowed on purpose: SecureStore errors can echo the
    // value that failed to write.
    throw new PhotoVaultError('vaultStorageFailed');
  }
}

/**
 * Reads the stored key for `uid`, or null when there is none.
 *
 * Anything unreadable, malformed or belonging to another uid is deleted and
 * reported as absent: a corrupted entry must degrade into "needs recovery",
 * never into a half-trusted key.
 */
export async function readVaultKey(uid: string): Promise<StoredVaultKey | null> {
  const storageKey = storageKeyFor(uid);

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(storageKey);
  } catch {
    throw new PhotoVaultError('vaultStorageFailed');
  }

  tracePhotoVault('vaultKey.local.read', {
    uidMasked: maskedUid(uid),
    found: raw !== null,
    storageNamespace: KEY_PREFIX,
    storageKeyExists: raw !== null,
    sessionGeneration: photoVaultSessionGeneration(),
  });
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await deleteVaultKey(uid);
    throw new PhotoVaultError('vaultLocalKeyCorrupted');
  }

  const payload = parsed as Partial<StoredPayload> | null;
  const valid =
    typeof payload === 'object' &&
    payload !== null &&
    payload.uid === uid &&
    isValidVaultKeyMaterial(payload.vaultKey) &&
    isValidVaultKeyVersion(payload.vaultKeyVersion);

  if (!valid) {
    await deleteVaultKey(uid);
    throw new PhotoVaultError('vaultLocalKeyCorrupted');
  }

  return {
    vaultKey: payload.vaultKey as string,
    vaultKeyVersion: payload.vaultKeyVersion as number,
  };
}

export async function deleteVaultKey(uid: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKeyFor(uid));
  } catch {
    // Deleting is best effort — a failure here must not block logout.
  }
}
