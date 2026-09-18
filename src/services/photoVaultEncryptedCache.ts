import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { recordPhotoVaultCacheEvent } from '../lib/photoVaultPerformance';

/**
 * Persistent cache of encrypted Photo Vault thumbnails.
 *
 * Holds `.thumb.enc` envelopes exactly as Firebase Storage served them:
 * AES-256-GCM ciphertext that is useless without the Vault Key. That is the
 * whole reason this directory is allowed to outlive a lock, a background
 * transition and a process restart, while every plaintext representation is
 * destroyed at the first of those events.
 *
 * Hard boundaries, all of them load-bearing:
 *   - it NEVER decrypts, and never sees the Vault Key;
 *   - it knows nothing about Firebase, Firestore, Storage or React;
 *   - it stores ciphertext only — no image, no base64, no metadata sidecar.
 *
 * It is not a source of truth. Firebase is. Anything here may vanish because
 * the OS reclaimed the cache directory, and the only consequence allowed is a
 * re-download.
 */

const VAULT_ROOT = 'photo-vault';
/**
 * Deliberately a SIBLING of the `tmp/` and `enc/` directories owned by
 * `photoVaultFileCrypto`, never a child. `cleanupPhotoVaultTempFiles` lists
 * those two directories by name, so a sibling is physically invisible to the
 * startup sweep. Persistence is guaranteed by the layout, not by a condition
 * someone could delete by accident.
 */
const CACHE_DIR = 'encrypted-thumbnails';
/**
 * The full-resolution sibling of `CACHE_DIR`.
 *
 * A separate directory rather than a second suffix in the same one, so the two
 * size classes can be budgeted independently: a 480px thumbnail envelope is
 * tens of KB and a full is up to `MAX_ENCRYPTED_BYTES` (10 MiB), and letting
 * one eviction pass weigh them against each other would let a single viewer
 * session flush the entire grid.
 */
const FULL_CACHE_DIR = 'encrypted-fulls';

const SUFFIX = '.thumb.enc';
const FULL_SUFFIX = '.full.enc';
/** Prefix of a half-written entry. Never a cache hit; swept on maintenance. */
const TEMP_PREFIX = '.tmp-';

/** Primary ceiling. A 480px/0.75 JPEG envelope is tens of KB, not hundreds. */
export const MAX_CACHE_BYTES = 24 * 1024 * 1024;
/** Secondary ceiling, so many tiny files cannot escape the byte budget. */
export const MAX_CACHE_ENTRIES = 300;

/**
 * Primary ceiling for fulls, and the one that actually binds.
 *
 * A 1600px/0.85 envelope is typically 400–800 KB, so this holds on the order
 * of a hundred ordinary photos; a legacy photo may be up to 10 MiB, and the
 * same budget then bounds the cache at a handful of them. Bytes lead here
 * because count alone cannot bound a directory whose entries vary by 20x.
 */
export const MAX_FULL_CIPHER_CACHE_BYTES = 64 * 1024 * 1024;
/** Secondary ceiling, so many small fulls cannot escape the byte budget. */
export const MAX_FULL_CIPHER_CACHE_ENTRIES = 120;

/**
 * One namespace of cached envelopes.
 *
 * Everything below is written against this rather than against the thumbnail
 * constants directly, so the full cache is the same code with a different
 * budget rather than a second implementation to keep in step.
 */
interface CiphertextCacheKind {
  readonly dir: string;
  readonly suffix: string;
  readonly maxBytes: number;
  readonly maxEntries: number;
}

const THUMBNAIL_KIND: CiphertextCacheKind = {
  dir: CACHE_DIR,
  suffix: SUFFIX,
  maxBytes: MAX_CACHE_BYTES,
  maxEntries: MAX_CACHE_ENTRIES,
};

const FULL_KIND: CiphertextCacheKind = {
  dir: FULL_CACHE_DIR,
  suffix: FULL_SUFFIX,
  maxBytes: MAX_FULL_CIPHER_CACHE_BYTES,
  maxEntries: MAX_FULL_CIPHER_CACHE_ENTRIES,
};

/** Every namespace an identity boundary has to clear. */
const ALL_KINDS: readonly CiphertextCacheKind[] = [THUMBNAIL_KIND, FULL_KIND];
/**
 * Reading a file does not update its modification time, so recency would
 * degrade to insertion order across a restart. A cache hit older than this
 * rewrites the entry to refresh `lastModified`. Amortized to at most one
 * rewrite of a few dozen KB per entry per interval.
 */
export const TOUCH_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Bound on stale entries removed per reconciliation, to keep it off the render path. */
const RECONCILE_LIMIT = 60;

/**
 * Anything that becomes a path segment must be validated. `photoId` is a
 * Firestore document id and `uid` comes from Auth; neither is attacker-chosen
 * in practice, but a cache that builds paths from remote strings has to fail
 * closed rather than rely on that.
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
 * Invalidation epoch.
 *
 * Incremented whenever cached ciphertext is dropped for identity reasons
 * (logout, account switch). A write carrying an older epoch is refused, which
 * is what stops an in-flight download started by the previous session from
 * recreating that session's cache after it was cleared. The check and the
 * atomic move both happen synchronously in the same turn, so no interleaving
 * is possible between deciding to write and the file appearing.
 */
let cacheEpoch = 0;

/**
 * Session-scoped access times, merged with on-disk `lastModified` to order
 * eviction. Kept in memory on purpose: a persisted index would be one more
 * private artifact to protect, and it would have to stay consistent with the
 * directory. Losing it on restart costs nothing — `lastModified` takes over.
 */
const lastAccess = new Map<string, number>();

export function currentPhotoVaultCacheEpoch(): number {
  return cacheEpoch;
}

function cacheRoot(kind: CiphertextCacheKind): Directory {
  const directory = new Directory(Paths.cache, VAULT_ROOT, kind.dir);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function userDirectory(kind: CiphertextCacheKind, uid: string): Directory {
  const directory = new Directory(Paths.cache, VAULT_ROOT, kind.dir, uid);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function entryFile(kind: CiphertextCacheKind, uid: string, photoId: string): File {
  return new File(userDirectory(kind, uid), `${photoId}${kind.suffix}`);
}

/** Namespaced by kind as well as uid: the same photo has an entry in each. */
function accessKey(kind: CiphertextCacheKind, uid: string, photoId: string): string {
  return `${kind.dir}/${uid}/${photoId}`;
}

function fileName(uri: string): string {
  return uri.split('/').pop() ?? '';
}

/** Deletes best-effort. A missing file is success; cache errors are never fatal. */
function removeQuietly(file: { exists: boolean; delete: () => void }): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // The OS may have reclaimed it already, or hold it briefly. Either way a
    // failed cache deletion must not surface as a gallery error.
  }
}

interface CacheEntry {
  photoId: string;
  file: File;
  size: number;
  recency: number;
}

/** Lists real cache entries for a user, sweeping abandoned temporaries. */
function listEntries(kind: CiphertextCacheKind, uid: string): CacheEntry[] {
  const entries: CacheEntry[] = [];
  let contents: (Directory | File)[];
  try {
    contents = userDirectory(kind, uid).list();
  } catch {
    return entries;
  }

  for (const item of contents) {
    if (item instanceof Directory) continue;
    const name = fileName(item.uri);

    if (name.startsWith(TEMP_PREFIX)) {
      // A temporary can only survive a crash between write and move: it is
      // never a valid entry and nothing will ever claim it.
      removeQuietly(item);
      continue;
    }
    if (!name.endsWith(kind.suffix)) continue;

    const photoId = name.slice(0, -kind.suffix.length);
    if (!isSafeSegment(photoId)) continue;

    const size = item.size ?? 0;
    if (size <= 0) {
      removeQuietly(item);
      continue;
    }

    const modified = item.lastModified ?? 0;
    entries.push({
      photoId,
      file: item,
      size,
      recency: Math.max(lastAccess.get(accessKey(kind, uid, photoId)) ?? 0, modified),
    });
  }
  return entries;
}

/**
 * Returns cached ciphertext whose size matches the Firestore metadata.
 *
 * A size mismatch is treated as a miss and the entry is dropped: the envelope
 * this app wrote for that photo has one length, so anything else is a
 * truncated write or an unrelated file, and the caller must go to the network
 * rather than hand suspicious bytes to the decryptor.
 */
async function readCachedEntry(
  kind: CiphertextCacheKind,
  params: { uid: string; photoId: string; expectedSize: number },
): Promise<Uint8Array | null> {
  const { uid, photoId, expectedSize } = params;
  if (!isSafeSegment(uid) || !isSafeSegment(photoId)) return null;

  let file: File;
  try {
    file = entryFile(kind, uid, photoId);
    if (!file.exists) return null;
  } catch {
    return null;
  }

  if (file.size !== expectedSize) {
    removeQuietly(file);
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch {
    removeQuietly(file);
    return null;
  }
  if (bytes.length !== expectedSize) {
    removeQuietly(file);
    return null;
  }

  lastAccess.set(accessKey(kind, uid, photoId), Date.now());
  touchIfStale(kind, uid, photoId, file, bytes);
  return bytes;
}

export function readCachedThumbnail(params: {
  uid: string;
  photoId: string;
  expectedSize: number;
}): Promise<Uint8Array | null> {
  return readCachedEntry(THUMBNAIL_KIND, params);
}

/**
 * Returns cached full ciphertext whose size matches the Firestore metadata.
 *
 * Same contract as the thumbnail read above, including treating a size
 * mismatch as a miss: these bytes are about to be handed to the envelope
 * parser, and local origin buys them no extra trust.
 */
export function readCachedFull(params: {
  uid: string;
  photoId: string;
  expectedSize: number;
}): Promise<Uint8Array | null> {
  return readCachedEntry(FULL_KIND, params);
}

/**
 * Refreshes `lastModified` on a hit so recency survives a restart.
 *
 * Throttled, because the only way to update a modification time with the
 * filesystem API available here is to rewrite the file. The bytes were just
 * read and validated, so this rewrites known-good content, and it goes through
 * the same atomic path — a crash mid-touch must not be able to damage an entry
 * that was already valid.
 */
function touchIfStale(
  kind: CiphertextCacheKind,
  uid: string,
  photoId: string,
  file: File,
  bytes: Uint8Array,
): void {
  let modified: number;
  try {
    modified = file.lastModified ?? 0;
  } catch {
    return;
  }
  if (Date.now() - modified < TOUCH_MIN_INTERVAL_MS) return;
  atomicWrite(kind, uid, photoId, bytes);
}

/** Writes through a temporary name, then moves it into place in one step. */
function atomicWrite(
  kind: CiphertextCacheKind,
  uid: string,
  photoId: string,
  bytes: Uint8Array,
): boolean {
  const directory = userDirectory(kind, uid);
  const temp = new File(directory, `${TEMP_PREFIX}${randomUUID()}`);
  try {
    temp.write(bytes);
    // Only now does the final name exist, and it exists complete. A reader can
    // never observe a partially written entry as a cache hit.
    temp.moveSync(entryFile(kind, uid, photoId), { overwrite: true });
    return true;
  } catch {
    removeQuietly(temp);
    return false;
  }
}

/**
 * Stores downloaded ciphertext.
 *
 * `epoch` must be the value captured when the operation that produced these
 * bytes began. A stale epoch means the cache was cleared for identity reasons
 * in the meantime, and writing would resurrect the previous user's data.
 *
 * Returns whether the entry was stored. Callers must not treat `false` as an
 * error: the photo still renders from the bytes they already hold.
 */
function writeCachedEntry(
  kind: CiphertextCacheKind,
  params: { uid: string; photoId: string; bytes: Uint8Array; epoch: number },
): boolean {
  const { uid, photoId, bytes, epoch } = params;
  if (epoch !== cacheEpoch) return false;
  if (!isSafeSegment(uid) || !isSafeSegment(photoId)) return false;
  if (bytes.length === 0) return false;

  if (!atomicWrite(kind, uid, photoId, bytes)) return false;

  lastAccess.set(accessKey(kind, uid, photoId), Date.now());
  recordPhotoVaultCacheEvent(
    kind === FULL_KIND
      ? 'viewer.fullCipherCache.write'
      : 'gallery.thumbnailCipherCache.write',
    { bytes: bytes.length },
  );
  enforceLimits(kind, uid);
  return true;
}

export function writeCachedThumbnail(params: {
  uid: string;
  photoId: string;
  bytes: Uint8Array;
  epoch: number;
}): boolean {
  return writeCachedEntry(THUMBNAIL_KIND, params);
}

/**
 * Stores downloaded full ciphertext.
 *
 * Identical epoch and safety contract to the thumbnail write. Returning
 * `false` is never an error for the caller: the photo renders from the bytes
 * already in hand, and only a future re-download is lost.
 */
export function writeCachedFull(params: {
  uid: string;
  photoId: string;
  bytes: Uint8Array;
  epoch: number;
}): boolean {
  return writeCachedEntry(FULL_KIND, params);
}

function removeCachedEntry(
  kind: CiphertextCacheKind,
  uid: string,
  photoId: string,
): void {
  if (!isSafeSegment(uid) || !isSafeSegment(photoId)) return;
  lastAccess.delete(accessKey(kind, uid, photoId));
  try {
    removeQuietly(entryFile(kind, uid, photoId));
  } catch {
    // Directory may not exist yet; nothing to invalidate.
  }
}

/** Invalidates one photo's thumbnail, e.g. after a delete. */
export function removeCachedThumbnail(uid: string, photoId: string): void {
  removeCachedEntry(THUMBNAIL_KIND, uid, photoId);
}

/** Invalidates one photo's full envelope, e.g. after a delete or replace. */
export function removeCachedFull(uid: string, photoId: string): void {
  removeCachedEntry(FULL_KIND, uid, photoId);
}

/**
 * Removes every cached envelope, of every kind, belonging to one user.
 *
 * The only caller is an accepted account deletion. A plain logout deliberately
 * does NOT come through here — it goes through
 * `prunePhotoVaultCiphertextExcept`, which keeps the signed-in namespace.
 */
export function removePhotoVaultCiphertextForUser(uid: string): void {
  if (!isSafeSegment(uid)) return;
  for (const kind of ALL_KINDS) {
    for (const key of [...lastAccess.keys()]) {
      if (key.startsWith(`${kind.dir}/${uid}/`)) lastAccess.delete(key);
    }
    try {
      const directory = new Directory(Paths.cache, VAULT_ROOT, kind.dir, uid);
      if (directory.exists) directory.delete();
    } catch {
      // Best effort: a cache we cannot clear must not block logout.
    }
  }
}

/**
 * Drops every cached namespace except the signed-in user's, and invalidates
 * the epoch.
 *
 * Called on any identity change. Expressing it as "keep only this uid" rather
 * than "remove the previous uid" means it stays correct without tracking who
 * was signed in before — including a logout (`null`), a switch this app never
 * observed, and leftovers from an account removed while the app was closed.
 */
export function prunePhotoVaultCiphertextExcept(uid: string | null): void {
  // Bump first. Any in-flight write that has not yet reached its synchronous
  // epoch check is refused from this point on, so it cannot land after the
  // sweep and resurrect a namespace this call is about to remove. One epoch
  // covers every kind, so a single bump invalidates all of them at once.
  cacheEpoch += 1;

  const keep = uid !== null && isSafeSegment(uid) ? uid : null;
  for (const key of [...lastAccess.keys()]) {
    if (keep === null || !ALL_KINDS.some((kind) => key.startsWith(`${kind.dir}/${keep}/`))) {
      lastAccess.delete(key);
    }
  }

  for (const kind of ALL_KINDS) {
    let contents: (Directory | File)[];
    try {
      contents = cacheRoot(kind).list();
    } catch {
      continue;
    }
    for (const item of contents) {
      const name = fileName(item.uri);
      if (keep !== null && name === keep) continue;
      try {
        if (item.exists) item.delete();
      } catch {
        // Ignored: a namespace we cannot remove now is retried on the next
        // identity change, and it stays unreadable ciphertext meanwhile.
      }
    }
  }
}

/**
 * Removes entries for photos that no longer exist remotely.
 *
 * Runs after a listing rather than during one, and is bounded, so a large
 * gallery cannot turn a refresh into a filesystem scan on the render path.
 */
function reconcileEntries(
  kind: CiphertextCacheKind,
  uid: string,
  knownPhotoIds: Iterable<string>,
  limit: number,
): number {
  if (!isSafeSegment(uid)) return 0;
  const known = new Set(knownPhotoIds);
  let removed = 0;
  for (const entry of listEntries(kind, uid)) {
    if (removed >= limit) break;
    if (known.has(entry.photoId)) continue;
    removeQuietly(entry.file);
    lastAccess.delete(accessKey(kind, uid, entry.photoId));
    removed += 1;
  }
  return removed;
}

export function reconcileCachedThumbnails(
  uid: string,
  knownPhotoIds: Iterable<string>,
  limit: number = RECONCILE_LIMIT,
): number {
  return reconcileEntries(THUMBNAIL_KIND, uid, knownPhotoIds, limit);
}

/** Removes cached fulls for photos that no longer exist remotely. */
export function reconcileCachedFulls(
  uid: string,
  knownPhotoIds: Iterable<string>,
  limit: number = RECONCILE_LIMIT,
): number {
  return reconcileEntries(FULL_KIND, uid, knownPhotoIds, limit);
}

/**
 * Evicts least-recently-used entries until both ceilings are satisfied.
 *
 * Recency is `max(this session's access, on-disk lastModified)`, so a restart
 * degrades gracefully to write/touch time instead of losing ordering entirely.
 */
function enforceLimits(kind: CiphertextCacheKind, uid: string): number {
  if (!isSafeSegment(uid)) return 0;
  const entries = listEntries(kind, uid);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let count = entries.length;
  if (totalBytes <= kind.maxBytes && count <= kind.maxEntries) return 0;

  entries.sort((a, b) => a.recency - b.recency);

  let evicted = 0;
  let reclaimed = 0;
  for (const entry of entries) {
    if (totalBytes <= kind.maxBytes && count <= kind.maxEntries) break;
    removeQuietly(entry.file);
    lastAccess.delete(accessKey(kind, uid, entry.photoId));
    totalBytes -= entry.size;
    reclaimed += entry.size;
    count -= 1;
    evicted += 1;
  }
  if (evicted > 0) {
    recordPhotoVaultCacheEvent(
      kind === FULL_KIND
        ? 'viewer.fullCipherCache.evicted'
        : 'gallery.thumbnailCipherCache.evicted',
      { bytes: reclaimed, items: evicted },
    );
  }
  return evicted;
}

export function enforceCacheLimits(uid: string): number {
  return enforceLimits(THUMBNAIL_KIND, uid);
}

/** Evicts least-recently-used fulls until both full-cache ceilings hold. */
export function enforceFullCacheLimits(uid: string): number {
  return enforceLimits(FULL_KIND, uid);
}

function statsOf(kind: CiphertextCacheKind, uid: string): { entries: number; bytes: number } {
  const entries = listEntries(kind, uid);
  return {
    entries: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

/** Diagnostics. Returns aggregates only — never a photoId, path or byte. */
export function photoVaultCacheStats(uid: string): { entries: number; bytes: number } {
  return statsOf(THUMBNAIL_KIND, uid);
}

/** Diagnostics for the full namespace. Aggregates only, same as above. */
export function photoVaultFullCacheStats(uid: string): { entries: number; bytes: number } {
  return statsOf(FULL_KIND, uid);
}

/** Test seam. */
export function resetPhotoVaultEncryptedCacheForTesting(): void {
  lastAccess.clear();
  cacheEpoch = 0;
}
