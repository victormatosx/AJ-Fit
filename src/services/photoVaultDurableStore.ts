import { Directory, File, Paths } from 'expo-file-system';

import { PhotoVaultError } from '../lib/photoVaultErrors';

/**
 * Durable home for ciphertext that has not reached Storage yet.
 *
 * WHY THIS IS NOT IN THE CACHE DIRECTORY
 *
 * Every other Photo Vault file lives under `Paths.cache`, and that is correct
 * for all of them: plaintext must never look like durable app data, and
 * downloaded ciphertext can always be fetched again. The blobs here are
 * different in one decisive way — they are the ONLY copy. Between the moment
 * the sheet closes and the moment Storage confirms the upload, this directory
 * holds a photo that exists nowhere else. The OS is free to reclaim
 * `Paths.cache` under storage pressure while the app is not running, so
 * keeping these there would mean a photo the user was told was saved could
 * simply be gone on the next launch.
 *
 * WHAT IS STORED
 *
 * AES-256-GCM envelopes only, byte for byte what will be uploaded. Never
 * plaintext: a decrypted photo is not durable app data and does not belong in
 * the document directory under any circumstance. `assertDurableStoreHoldsNoPlaintext`
 * exists so that rule is checkable rather than merely stated.
 *
 * ADDRESSING
 *
 * `{documents}/photo-vault-pending/{uid}/{assetId}.enc` and `.thumb.enc`.
 * Callers pass `(uid, assetId)` and never a path — the location is re-derived
 * on every use because iOS moves an app's container between launches and
 * restores, which makes a stored absolute path a latent bug. The uid segment
 * is what keeps two accounts on one device physically separate, exactly as in
 * the encrypted thumbnail cache.
 *
 * The file name is an opaque UUID, so it reveals no day, pose or ordering.
 */

const PENDING_ROOT = 'photo-vault-pending';
const FULL_SUFFIX = '.enc';
const THUMBNAIL_SUFFIX = '.thumb.enc';

/** Same guard the encrypted cache uses: nothing unvalidated becomes a path segment. */
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

function requireSafe(uid: string, assetId: string): void {
  if (!isSafeSegment(uid) || !isSafeSegment(assetId)) {
    throw new PhotoVaultError('vaultFileWriteFailed');
  }
}

function storeRoot(): Directory {
  const directory = new Directory(Paths.document, PENDING_ROOT);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function userDirectory(uid: string): Directory {
  const directory = new Directory(Paths.document, PENDING_ROOT, uid);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export interface DurableAssetPaths {
  fullUri: string;
  thumbnailUri: string;
}

/**
 * Names (and only names) where this asset's two ciphertexts belong.
 *
 * Creates the directory but writes nothing — the encryption step writes
 * straight to these URIs, so the ciphertext is durable from the instant it
 * exists rather than being staged somewhere reclaimable and moved afterwards.
 */
export function durableAssetPaths(uid: string, assetId: string): DurableAssetPaths {
  requireSafe(uid, assetId);
  const directory = userDirectory(uid);
  return {
    fullUri: new File(directory, `${assetId}${FULL_SUFFIX}`).uri,
    thumbnailUri: new File(directory, `${assetId}${THUMBNAIL_SUFFIX}`).uri,
  };
}

function sizeOf(uri: string): number {
  try {
    const file = new File(uri);
    return file.exists ? (file.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether both ciphertexts are present at exactly the sizes the job recorded.
 *
 * A size mismatch is treated as absence, for the same reason the thumbnail
 * cache does: the envelope this app wrote has one length, so anything else is
 * a truncated write, and uploading it would publish bytes that can never be
 * decrypted.
 */
export function durableAssetIsIntact(
  uid: string,
  assetId: string,
  expected: { encryptedSize: number; thumbnailEncryptedSize: number },
): boolean {
  try {
    const { fullUri, thumbnailUri } = durableAssetPaths(uid, assetId);
    return (
      sizeOf(fullUri) === expected.encryptedSize &&
      sizeOf(thumbnailUri) === expected.thumbnailEncryptedSize
    );
  } catch {
    return false;
  }
}

function removeQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort. A blob we cannot remove stays unreadable ciphertext, and
    // the next reconciliation tries again.
  }
}

/** Removes both ciphertexts for one asset. Idempotent; missing counts as removed. */
export function discardDurableAsset(uid: string, assetId: string): void {
  if (!isSafeSegment(uid) || !isSafeSegment(assetId)) return;
  try {
    const { fullUri, thumbnailUri } = durableAssetPaths(uid, assetId);
    removeQuietly(fullUri);
    removeQuietly(thumbnailUri);
  } catch {
    // The directory may not exist yet; there is nothing to discard.
  }
}

function fileName(uri: string): string {
  return uri.split('/').pop() ?? '';
}

/** Every asset id this user currently has bytes on disk for. */
export function listDurableAssetIds(uid: string): string[] {
  if (!isSafeSegment(uid)) return [];
  const ids = new Set<string>();
  let contents: (Directory | File)[];
  try {
    contents = userDirectory(uid).list();
  } catch {
    return [];
  }
  for (const item of contents) {
    if (item instanceof Directory) continue;
    const name = fileName(item.uri);
    const assetId = name.endsWith(THUMBNAIL_SUFFIX)
      ? name.slice(0, -THUMBNAIL_SUFFIX.length)
      : name.endsWith(FULL_SUFFIX)
        ? name.slice(0, -FULL_SUFFIX.length)
        : null;
    if (assetId !== null && isSafeSegment(assetId)) ids.add(assetId);
  }
  return [...ids];
}

/**
 * Drops blobs no surviving job claims.
 *
 * The direction of error matters and is deliberate: a blob kept one cycle too
 * long costs disk, while a blob deleted too early costs the user a photo. So
 * this removes only what is PROVEN unreferenced — the caller passes the asset
 * ids of every job that still exists, and anything else is unreachable by
 * construction, because nothing but a job can ever name one of these files.
 */
export function reconcileDurableAssets(uid: string, claimedAssetIds: Iterable<string>): number {
  if (!isSafeSegment(uid)) return 0;
  const claimed = new Set(claimedAssetIds);
  let removed = 0;
  for (const assetId of listDurableAssetIds(uid)) {
    if (claimed.has(assetId)) continue;
    discardDurableAsset(uid, assetId);
    removed += 1;
  }
  return removed;
}

/** Removes every pending blob belonging to one user. */
export function discardDurableAssetsForUser(uid: string): void {
  if (!isSafeSegment(uid)) return;
  try {
    const directory = new Directory(Paths.document, PENDING_ROOT, uid);
    if (directory.exists) directory.delete();
  } catch {
    // Best effort: a directory we cannot clear must not block account teardown.
  }
}

/** Every uid namespace currently holding pending blobs. */
export function listDurableUids(): string[] {
  const uids: string[] = [];
  let contents: (Directory | File)[];
  try {
    contents = storeRoot().list();
  } catch {
    return uids;
  }
  for (const item of contents) {
    const name = fileName(item.uri);
    if (isSafeSegment(name)) uids.push(name);
  }
  return uids;
}

/**
 * Diagnostics for the startup audit: every file here must be an envelope.
 *
 * The document directory is backed up and is not swept by anything, so a
 * plaintext file reaching it would be the most durable privacy failure the
 * vault could have. Checking the extension is a cheap, honest tripwire; the
 * bytes themselves are authenticated by the envelope parser on the way out.
 */
export function durableStoreFileNames(uid: string): string[] {
  if (!isSafeSegment(uid)) return [];
  try {
    return userDirectory(uid)
      .list()
      .filter((item): item is File => !(item instanceof Directory))
      .map((item) => fileName(item.uri));
  } catch {
    return [];
  }
}
