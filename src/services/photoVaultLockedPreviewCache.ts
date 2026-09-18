import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Persistent, uid-namespaced cache of destructively degraded photo previews,
 * for exclusive use as the Photo Vault locked screen's background.
 *
 * Sibling of `photoVaultEncryptedCache.ts`, deliberately a SEPARATE file and
 * directory: that cache is audited to hold ciphertext only, and this one
 * holds plaintext JPEGs on purpose (see `photoVaultLockedPreviewGenerator.ts`
 * for why that plaintext is safe to keep unencrypted — the downsample already
 * destroyed the information a reversal would need). Mixing the two would
 * blur (no pun intended) a hard boundary the ciphertext cache's own tests
 * enforce.
 *
 * This module never decrypts, never sees the Vault Key, and never talks to
 * Firebase — it only ever receives already-produced bytes and a uid/assetId
 * to file them under.
 */

const VAULT_ROOT = 'photo-vault';
const CACHE_DIR = 'locked-preview';
const SUFFIX = '.preview.jpg';
/** Prefix of a half-written entry. Never a valid entry; swept on maintenance. */
const TEMP_PREFIX = '.tmp-';

/** Each entry is a few KB (96px JPEG); this comfortably covers a very large gallery. */
export const MAX_LOCKED_PREVIEW_BYTES = 6 * 1024 * 1024;
export const MAX_LOCKED_PREVIEW_ENTRIES = 500;

/**
 * Anything that becomes a path segment must be validated — same contract as
 * `photoVaultEncryptedCache.ts`.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function isSafeSegment(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    SAFE_SEGMENT.test(value) &&
    !value.includes('..')
  );
}

/**
 * Invalidation epoch — identical contract to `photoVaultEncryptedCache.ts`'s
 * `cacheEpoch`. Bumped on any identity change; a write carrying a stale epoch
 * is refused, which is what stops a late-resolving generation started under a
 * previous uid/session from writing into the namespace that was just cleared
 * for the next one.
 */
let cacheEpoch = 0;

/** Session-scoped access times, merged with on-disk `lastModified` for eviction order. */
const lastAccess = new Map<string, number>();

export function currentPhotoVaultLockedPreviewEpoch(): number {
  return cacheEpoch;
}

function cacheRoot(): Directory {
  const directory = new Directory(Paths.cache, VAULT_ROOT, CACHE_DIR);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function userDirectory(uid: string): Directory {
  const directory = new Directory(Paths.cache, VAULT_ROOT, CACHE_DIR, uid);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function entryFile(uid: string, assetId: string): File {
  return new File(userDirectory(uid), `${assetId}${SUFFIX}`);
}

function accessKey(uid: string, assetId: string): string {
  return `${uid}/${assetId}`;
}

function fileName(uri: string): string {
  return uri.split('/').pop() ?? '';
}

/** Deletes best-effort. A missing file is success; cache errors are never fatal. */
function removeQuietly(file: { exists: boolean; delete: () => void }): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // The OS may have reclaimed it already, or hold it briefly.
  }
}

interface CacheEntry {
  assetId: string;
  file: File;
  size: number;
  recency: number;
}

/** Lists real entries for a user, sweeping abandoned temporaries. Never crosses uids. */
function listEntries(uid: string): CacheEntry[] {
  const entries: CacheEntry[] = [];
  let contents: (Directory | File)[];
  try {
    contents = userDirectory(uid).list();
  } catch {
    return entries;
  }

  for (const item of contents) {
    if (item instanceof Directory) continue;
    const name = fileName(item.uri);

    if (name.startsWith(TEMP_PREFIX)) {
      removeQuietly(item);
      continue;
    }
    if (!name.endsWith(SUFFIX)) continue;

    const assetId = name.slice(0, -SUFFIX.length);
    if (!isSafeSegment(assetId)) continue;

    const size = item.size ?? 0;
    if (size <= 0) {
      removeQuietly(item);
      continue;
    }

    const modified = item.lastModified ?? 0;
    entries.push({
      assetId,
      file: item,
      size,
      recency: Math.max(lastAccess.get(accessKey(uid, assetId)) ?? 0, modified),
    });
  }
  return entries;
}

/** Writes through a temporary name, then moves it into place in one step. */
function atomicWrite(uid: string, assetId: string, bytes: Uint8Array): boolean {
  const directory = userDirectory(uid);
  const temp = new File(directory, `${TEMP_PREFIX}${randomUUID()}`);
  try {
    temp.write(bytes);
    // Only now does the final name exist, and it exists complete. A reader
    // (the locked screen) can never observe a partially written entry.
    temp.moveSync(entryFile(uid, assetId), { overwrite: true });
    return true;
  } catch {
    removeQuietly(temp);
    return false;
  }
}

/**
 * Stores a generated derivative.
 *
 * `epoch` must be the value captured when the operation that produced these
 * bytes began. A stale epoch means the cache was cleared for identity reasons
 * in the meantime, and writing would resurrect a previous user's preview.
 *
 * Returns whether the entry was stored. `false` is never an error for the
 * caller — this is a cosmetic cache, not a source of truth.
 */
export function writeLockedPreviewDerivative(params: {
  uid: string;
  assetId: string;
  bytes: Uint8Array;
  epoch: number;
}): boolean {
  const { uid, assetId, bytes, epoch } = params;
  if (epoch !== cacheEpoch) return false;
  if (!isSafeSegment(uid) || !isSafeSegment(assetId)) return false;
  if (bytes.length === 0) return false;

  if (!atomicWrite(uid, assetId, bytes)) return false;

  lastAccess.set(accessKey(uid, assetId), Date.now());
  enforceLimits(uid);
  return true;
}

/** Whether a derivative already exists for this asset. Used to gate the opportunistic backfill. */
export function hasLockedPreviewDerivative(uid: string, assetId: string): boolean {
  if (!isSafeSegment(uid) || !isSafeSegment(assetId)) return false;
  try {
    return entryFile(uid, assetId).exists;
  } catch {
    return false;
  }
}

/** Invalidates one photo's preview, e.g. after a delete or replace. */
export function removeLockedPreviewDerivative(uid: string, assetId: string): void {
  if (!isSafeSegment(uid) || !isSafeSegment(assetId)) return;
  lastAccess.delete(accessKey(uid, assetId));
  try {
    removeQuietly(entryFile(uid, assetId));
  } catch {
    // Directory may not exist yet; nothing to invalidate.
  }
}

/**
 * Local file URIs for every cached preview belonging to `uid`, most recent
 * modification first.
 *
 * Pure local disk read — no network, no Firestore, no vault key, no unlock
 * required. This is what makes it safe to call from the locked screen: the
 * uid comes from the signed-in Firebase session (a different, non-biometric
 * layer of auth), never from the Photo Vault's own lock state.
 */
export function listLockedPreviewUris(uid: string): string[] {
  if (!isSafeSegment(uid)) return [];
  return listEntries(uid)
    .sort((a, b) => b.recency - a.recency)
    .map((entry) => entry.file.uri);
}

/**
 * Removes every cached preview belonging to one user. Account deletion only —
 * a plain logout goes through `pruneLockedPreviewDerivativesExcept`, which
 * keeps the signed-in namespace.
 */
export function removeLockedPreviewDerivativesForUser(uid: string): void {
  if (!isSafeSegment(uid)) return;
  for (const key of [...lastAccess.keys()]) {
    if (key.startsWith(`${uid}/`)) lastAccess.delete(key);
  }
  try {
    const directory = new Directory(Paths.cache, VAULT_ROOT, CACHE_DIR, uid);
    if (directory.exists) directory.delete();
  } catch {
    // Best effort: a cache we cannot clear must not block account deletion.
  }
}

/**
 * Drops every cached namespace except the signed-in user's, and invalidates
 * the epoch. Called on any identity change (logout, account switch).
 *
 * Same "keep only this uid" shape as `prunePhotoVaultCiphertextExcept`, kept
 * as an independent function (and epoch) so a bug in one cache's sweep can
 * never silently skip the other.
 */
export function pruneLockedPreviewDerivativesExcept(uid: string | null): void {
  // Bump first, for the same reason as the ciphertext cache: any generation
  // in flight that has not yet reached its synchronous epoch check is
  // refused from this point on, so it cannot land after the sweep below and
  // resurrect a namespace this call is about to remove.
  cacheEpoch += 1;

  const keep = uid !== null && isSafeSegment(uid) ? uid : null;
  for (const key of [...lastAccess.keys()]) {
    if (keep === null || !key.startsWith(`${keep}/`)) {
      lastAccess.delete(key);
    }
  }

  let contents: (Directory | File)[];
  try {
    contents = cacheRoot().list();
  } catch {
    return;
  }
  for (const item of contents) {
    const name = fileName(item.uri);
    if (keep !== null && name === keep) continue;
    try {
      if (item.exists) item.delete();
    } catch {
      // Ignored: retried on the next identity change; stays unreadable
      // (already-degraded) plaintext meanwhile.
    }
  }
}

/**
 * Evicts least-recently-used entries until both ceilings are satisfied.
 *
 * Scoped to exactly one uid's subdirectory — `listEntries`/eviction never
 * read or touch another user's namespace, by construction, not by a check
 * that could be forgotten.
 */
function enforceLimits(uid: string): number {
  if (!isSafeSegment(uid)) return 0;
  const entries = listEntries(uid);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let count = entries.length;
  if (totalBytes <= MAX_LOCKED_PREVIEW_BYTES && count <= MAX_LOCKED_PREVIEW_ENTRIES) return 0;

  entries.sort((a, b) => a.recency - b.recency);

  let evicted = 0;
  for (const entry of entries) {
    if (totalBytes <= MAX_LOCKED_PREVIEW_BYTES && count <= MAX_LOCKED_PREVIEW_ENTRIES) break;
    removeQuietly(entry.file);
    lastAccess.delete(accessKey(uid, entry.assetId));
    totalBytes -= entry.size;
    count -= 1;
    evicted += 1;
  }
  return evicted;
}

/** Diagnostics. Returns aggregates only — never an assetId or path. */
export function photoVaultLockedPreviewCacheStats(uid: string): { entries: number; bytes: number } {
  const entries = listEntries(uid);
  return {
    entries: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

/** Test seam. */
export function resetPhotoVaultLockedPreviewCacheForTesting(): void {
  lastAccess.clear();
  cacheEpoch = 0;
}
