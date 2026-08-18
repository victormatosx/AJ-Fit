import AsyncStorage from '@react-native-async-storage/async-storage';

import { logError } from '../lib/logger';

/**
 * Device-local hint used only to choose the Photo Vault's locked layout.
 *
 * The value is deliberately one bit. It is not gallery authority and stores
 * no count, photo id, asset id, date, pose, path, URI or image data. A real,
 * authenticated gallery listing reconciles it every time the vault opens.
 *
 * This belongs in AsyncStorage rather than the Keychain/Keystore: the locked
 * layout itself reveals the same fact (whether private content exists), so
 * encrypting the hint would add latency and key lifecycle without protecting
 * any information the UI does not already disclose.
 */

const STORAGE_PREFIX = 'ajfit-photo-vault-has-content-v1';

type PresenceListener = (uid: string, hasContent: boolean) => void;

const listeners = new Set<PresenceListener>();
const pendingWrites = new Map<string, Promise<void>>();

function storageKeyFor(uid: string): string {
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    throw new Error('[photoVaultContentPresence] invalid uid');
  }
  return `${STORAGE_PREFIX}:${encodeURIComponent(uid)}`;
}

function publish(uid: string, hasContent: boolean): void {
  for (const listener of listeners) listener(uid, hasContent);
}

export function subscribeToPhotoVaultContentPresence(
  listener: PresenceListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Missing and malformed values safely degrade to the aspirational state. */
export async function readPhotoVaultContentPresence(uid: string): Promise<boolean> {
  let key: string;
  try {
    key = storageKeyFor(uid);
    await pendingWrites.get(key);
    const raw = await AsyncStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false' || raw === null) return false;

    // Only the two literal booleans belong in this namespace. Remove anything
    // else rather than treating a corrupted value as truthy.
    await AsyncStorage.removeItem(key);
    return false;
  } catch (error) {
    logError('photoVaultContentPresence:read', error);
    return false;
  }
}

/**
 * Reconciles the hint after a confirmed authenticated event.
 *
 * Publishing is synchronous so a lock immediately following a successful
 * upload/delete selects the correct layout. Disk writes are serialized per
 * uid, preventing a fast `true → false` transition from landing out of order.
 * Persistence is best-effort and can never fail the gallery operation that
 * already established the authoritative result.
 */
export function setPhotoVaultContentPresence(
  uid: string,
  hasContent: boolean,
): Promise<void> {
  let key: string;
  try {
    key = storageKeyFor(uid);
  } catch (error) {
    logError('photoVaultContentPresence:write', error);
    return Promise.resolve();
  }

  publish(uid, hasContent);

  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await AsyncStorage.setItem(key, hasContent ? 'true' : 'false');
      } catch (error) {
        logError('photoVaultContentPresence:write', error);
      }
    });

  pendingWrites.set(key, write);
  void write.finally(() => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  });
  return write;
}

/** Explicit gallery-authority reconciliation helper. */
export function reconcilePhotoVaultContentPresence(
  uid: string,
  hasContent: boolean,
): Promise<void> {
  return setPhotoVaultContentPresence(uid, hasContent);
}

/** Test seam; production namespaces intentionally survive logout. */
export function resetPhotoVaultContentPresenceForTesting(): void {
  listeners.clear();
  pendingWrites.clear();
}
