import { randomUUID } from 'expo-crypto';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytesResumable } from 'firebase/storage';

import { auth, db, storage } from '../lib/firebase';
import {
  ENCRYPTION_ALGORITHM,
  ENCRYPTION_VERSION,
  decryptBytesToBase64,
  describeEnvelope,
} from '../lib/photoVaultCrypto';
import {
  PhotoVaultError,
  isPhotoVaultError,
  logPhotoVaultIssue,
  sanitizedErrorCode,
  type PhotoVaultIssue,
} from '../lib/photoVaultErrors';
import {
  recordPhotoVaultCacheOutcome,
  startPhotoVaultPerf,
  type PhotoVaultPerfStage,
} from '../lib/photoVaultPerformance';
import {
  isPhotoVaultUnlockedFor,
  photoVaultSessionGeneration,
  requirePhotoVaultUnlocked,
  requireSamePhotoVaultSession,
} from '../lib/photoVaultSession';
import { ensurePhotoVaultKey } from './photoVault';
import {
  currentPhotoVaultCacheEpoch,
  readCachedThumbnail,
  reconcileCachedThumbnails,
  removeCachedThumbnail,
  writeCachedThumbnail,
} from './photoVaultEncryptedCache';
import {
  decryptPhotoFile,
  discardDecryptedPhoto,
  discardEncryptedPhoto,
  encryptPhotoFile,
  writeEncryptedFile,
  type EncryptedPhotoResult,
} from './photoVaultFileCrypto';
import { createPhotoVaultThumbnail } from './photoVaultPicker';
import {
  closeEncryptedUploadBlob,
  openEncryptedUploadBlob,
} from './photoVaultUploadBlob';

/** Cloud pipeline. Storage receives ciphertext only; all paths derive from the live uid. */
const SCOPE = 'progressPhotos';

export const MAX_ENCRYPTED_BYTES = 10 * 1024 * 1024;
/** 480px/0.75 JPEGs remain far below this; the ceiling also limits abuse. */
export const MAX_THUMBNAIL_ENCRYPTED_BYTES = 512 * 1024;

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

export type ProgressPhotoMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface ProgressPhotoEncryption {
  version: number;
  algorithm: string;
  iv: string;
  vaultKeyVersion: number;
}

export interface ProgressPhoto {
  photoId: string;
  storagePath: string;
  /** Absent on pre-Phase-13 photos. */
  thumbnailStoragePath?: string;
  takenAt: Date;
  createdAt: Date | null;
  originalMimeType: string;
  encryptedSize: number;
  thumbnailEncryptedSize?: number;
  encryption: ProgressPhotoEncryption;
  thumbnailEncryption?: ProgressPhotoEncryption;
}

function fail(issue: PhotoVaultIssue, cause?: unknown): never {
  logPhotoVaultIssue(SCOPE, issue, sanitizedErrorCode(cause));
  throw new PhotoVaultError(issue);
}

function currentUnlockedUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) fail('vaultKeyNotAvailable');
  requirePhotoVaultUnlocked(uid);
  return uid;
}

function storagePathFor(uid: string, photoId: string): string {
  return `users/${uid}/progressPhotos/${photoId}.enc`;
}

function thumbnailStoragePathFor(uid: string, photoId: string): string {
  return `users/${uid}/progressPhotos/${photoId}.thumb.enc`;
}

function photoDoc(uid: string, photoId: string) {
  return doc(db, 'users', uid, 'progressPhotos', photoId);
}

async function requireVaultKey(): Promise<{ vaultKey: string; vaultKeyVersion: number }> {
  const result = await ensurePhotoVaultKey();
  if (result.status === 'reauthentication-required') fail('vaultReauthRequired');
  return { vaultKey: result.vaultKey, vaultKeyVersion: result.vaultKeyVersion };
}

function isValidEncryption(value: unknown): value is ProgressPhotoEncryption {
  const e = value as Record<string, unknown> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    e.version === ENCRYPTION_VERSION &&
    e.algorithm === ENCRYPTION_ALGORITHM &&
    typeof e.iv === 'string' &&
    e.iv.length > 0 &&
    typeof e.vaultKeyVersion === 'number' &&
    Number.isInteger(e.vaultKeyVersion) &&
    e.vaultKeyVersion >= 1
  );
}

/** Accepts the closed legacy schema and the closed Phase-13 thumbnail schema. */
function parseStoredPhoto(uid: string, photoId: string, data: unknown): ProgressPhoto {
  const d = data as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) fail('vaultMetadataInvalid');

  const expectedPath = storagePathFor(uid, photoId);
  const expectedThumbnailPath = thumbnailStoragePathFor(uid, photoId);
  const hasAnyThumbnailField =
    'thumbnailStoragePath' in d ||
    'thumbnailEncryptedSize' in d ||
    'thumbnailEncryption' in d;
  const hasCompleteThumbnail =
    d.thumbnailStoragePath === expectedThumbnailPath &&
    typeof d.thumbnailEncryptedSize === 'number' &&
    Number.isInteger(d.thumbnailEncryptedSize) &&
    d.thumbnailEncryptedSize > 0 &&
    d.thumbnailEncryptedSize <= MAX_THUMBNAIL_ENCRYPTED_BYTES &&
    isValidEncryption(d.thumbnailEncryption);

  const valid =
    d.storagePath === expectedPath &&
    d.takenAt instanceof Timestamp &&
    typeof d.originalMimeType === 'string' &&
    ALLOWED_MIME_TYPES.includes(d.originalMimeType as ProgressPhotoMimeType) &&
    typeof d.encryptedSize === 'number' &&
    Number.isInteger(d.encryptedSize) &&
    d.encryptedSize > 0 &&
    d.encryptedSize <= MAX_ENCRYPTED_BYTES &&
    isValidEncryption(d.encryption) &&
    (!hasAnyThumbnailField || hasCompleteThumbnail) &&
    (!hasCompleteThumbnail ||
      (d.thumbnailEncryption as ProgressPhotoEncryption).iv !==
        (d.encryption as ProgressPhotoEncryption).iv);

  if (!valid) fail('vaultMetadataInvalid');

  const result: ProgressPhoto = {
    photoId,
    storagePath: expectedPath,
    takenAt: (d.takenAt as Timestamp).toDate(),
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : null,
    originalMimeType: d.originalMimeType as string,
    encryptedSize: d.encryptedSize as number,
    encryption: d.encryption as ProgressPhotoEncryption,
  };
  if (hasCompleteThumbnail) {
    result.thumbnailStoragePath = expectedThumbnailPath;
    result.thumbnailEncryptedSize = d.thumbnailEncryptedSize as number;
    result.thumbnailEncryption = d.thumbnailEncryption as ProgressPhotoEncryption;
  }
  return result;
}

function encryptionMetadata(result: EncryptedPhotoResult): ProgressPhotoEncryption {
  return {
    version: result.encryption.version,
    algorithm: result.encryption.algorithm,
    iv: result.encryption.iv,
    vaultKeyVersion: result.encryption.vaultKeyVersion,
  };
}

async function timed<T>(stage: PhotoVaultPerfStage, work: () => Promise<T>): Promise<T> {
  const finish = startPhotoVaultPerf(stage);
  try {
    return await work();
  } finally {
    finish();
  }
}

function isObjectNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === 'storage/object-not-found'
  );
}

async function deleteRefsForRollback(objectRefs: ReturnType<typeof ref>[]): Promise<boolean> {
  const results = await Promise.allSettled(objectRefs.map((objectRef) => deleteObject(objectRef)));
  return results.every(
    (result) => result.status === 'fulfilled' || isObjectNotFound(result.reason),
  );
}

function uploadCiphertext(
  objectRef: ReturnType<typeof ref>,
  blob: Blob,
  customMetadata: Record<string, string>,
  onTransferred: (bytes: number) => void,
): Promise<void> {
  const task = uploadBytesResumable(objectRef, blob, {
    contentType: 'application/octet-stream',
    customMetadata,
  });
  return new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onTransferred(snapshot.bytesTransferred),
      reject,
      resolve,
    );
  });
}

export interface UploadProgressPhotoParams {
  sourceUri: string;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  width?: number;
  height?: number;
  onProgress?: (progress: number) => void;
}

/** Creates two independently sealed assets, uploads both, then commits metadata. */
export async function uploadProgressPhoto(
  params: UploadProgressPhotoParams,
): Promise<ProgressPhoto> {
  const finishTotal = startPhotoVaultPerf('upload.total');
  const uid = currentUnlockedUid();
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();
  const photoId = randomUUID();
  const storagePath = storagePathFor(uid, photoId);
  const thumbnailStoragePath = thumbnailStoragePathFor(uid, photoId);
  let thumbnailPlaintextUri: string | null = null;
  let fullEncrypted: EncryptedPhotoResult | null = null;
  let thumbnailEncrypted: EncryptedPhotoResult | null = null;
  let fullUploadBlob: Blob | null = null;
  let thumbnailUploadBlob: Blob | null = null;

  try {
    const thumbnail = await timed('upload.thumbnail.generate', () =>
      createPhotoVaultThumbnail({
        sourceUri: params.sourceUri,
        width: params.width ?? 1600,
        height: params.height ?? 1600,
      }),
    );
    thumbnailPlaintextUri = thumbnail.uri;

    [fullEncrypted, thumbnailEncrypted] = await Promise.all([
      timed('upload.full.encrypt', () =>
        encryptPhotoFile({
          sourceUri: params.sourceUri,
          vaultKeyBase64: vaultKey,
          vaultKeyVersion,
        }),
      ),
      timed('upload.thumbnail.encrypt', () =>
        encryptPhotoFile({
          sourceUri: thumbnail.uri,
          vaultKeyBase64: vaultKey,
          vaultKeyVersion,
        }),
      ),
    ]);

    // Same key is allowed, but AES-GCM nonce reuse is categorically not.
    if (fullEncrypted.encryption.iv === thumbnailEncrypted.encryption.iv) {
      fail('vaultCryptoEncryptFailed');
    }
    if (
      fullEncrypted.encryptedSize > MAX_ENCRYPTED_BYTES ||
      thumbnailEncrypted.encryptedSize > MAX_THUMBNAIL_ENCRYPTED_BYTES
    ) {
      fail('vaultPhotoTooLarge');
    }

    const [openedFullBlob, openedThumbnailBlob] = await Promise.all([
      openEncryptedUploadBlob(fullEncrypted.encryptedUri),
      openEncryptedUploadBlob(thumbnailEncrypted.encryptedUri),
    ]);
    fullUploadBlob = openedFullBlob;
    thumbnailUploadBlob = openedThumbnailBlob;
    if (
      openedFullBlob.size !== fullEncrypted.encryptedSize ||
      openedThumbnailBlob.size !== thumbnailEncrypted.encryptedSize
    ) {
      fail('vaultMetadataInvalid');
    }

    const fullRef = ref(storage, storagePath);
    const thumbnailRef = ref(storage, thumbnailStoragePath);
    const transferred = [0, 0];
    const totalBytes = openedFullBlob.size + openedThumbnailBlob.size;
    const report = (index: number, bytes: number) => {
      transferred[index] = bytes;
      if (totalBytes > 0) params.onProgress?.((transferred[0] + transferred[1]) / totalBytes);
    };

    const uploads = await Promise.allSettled([
      timed('upload.full.transfer', () =>
        uploadCiphertext(
          fullRef,
          openedFullBlob,
          { ownerId: uid, photoId, assetKind: 'full' },
          (bytes) => report(0, bytes),
        ),
      ),
      timed('upload.thumbnail.transfer', () =>
        uploadCiphertext(
          thumbnailRef,
          openedThumbnailBlob,
          { ownerId: uid, photoId, assetKind: 'thumbnail' },
          (bytes) => report(1, bytes),
        ),
      ),
    ]);
    if (uploads.some((result) => result.status === 'rejected')) {
      const rolledBack = await deleteRefsForRollback([fullRef, thumbnailRef]);
      if (!rolledBack) fail('vaultUploadRollbackFailed');
      const rejected = uploads.find((result) => result.status === 'rejected');
      fail('vaultUploadFailed', rejected?.status === 'rejected' ? rejected.reason : undefined);
    }

    try {
      await timed('upload.firestore', () =>
        setDoc(photoDoc(uid, photoId), {
          storagePath,
          thumbnailStoragePath,
          createdAt: serverTimestamp(),
          takenAt: Timestamp.fromDate(params.takenAt),
          originalMimeType: params.originalMimeType,
          encryptedSize: fullEncrypted!.encryptedSize,
          thumbnailEncryptedSize: thumbnailEncrypted!.encryptedSize,
          encryption: encryptionMetadata(fullEncrypted!),
          thumbnailEncryption: encryptionMetadata(thumbnailEncrypted!),
        }),
      );
    } catch (error) {
      const rolledBack = await deleteRefsForRollback([fullRef, thumbnailRef]);
      if (!rolledBack) fail('vaultUploadRollbackFailed');
      fail('vaultMetadataCreateFailed', error);
    }

    return {
      photoId,
      storagePath,
      thumbnailStoragePath,
      takenAt: params.takenAt,
      createdAt: null,
      originalMimeType: params.originalMimeType,
      encryptedSize: fullEncrypted.encryptedSize,
      thumbnailEncryptedSize: thumbnailEncrypted.encryptedSize,
      encryption: encryptionMetadata(fullEncrypted),
      thumbnailEncryption: encryptionMetadata(thumbnailEncrypted),
    };
  } catch (error) {
    if (error instanceof PhotoVaultError) throw error;
    return fail('vaultUploadFailed', error);
  } finally {
    if (thumbnailPlaintextUri) discardDecryptedPhoto(thumbnailPlaintextUri);
    closeEncryptedUploadBlob(fullUploadBlob);
    closeEncryptedUploadBlob(thumbnailUploadBlob);
    if (fullEncrypted) discardEncryptedPhoto(fullEncrypted.encryptedUri);
    if (thumbnailEncrypted) discardEncryptedPhoto(thumbnailEncrypted.encryptedUri);
    finishTotal();
  }
}

export async function listProgressPhotos(): Promise<ProgressPhoto[]> {
  const uid = currentUnlockedUid();
  let snapshot;
  try {
    snapshot = await timed('gallery.firestore.list', () =>
      getDocs(query(collection(db, 'users', uid, 'progressPhotos'), orderBy('takenAt', 'desc'))),
    );
  } catch (error) {
    fail('vaultListFailed', error);
  }

  const photos: ProgressPhoto[] = [];
  for (const document of snapshot.docs) {
    try {
      photos.push(parseStoredPhoto(uid, document.id, document.data()));
    } catch {
      logPhotoVaultIssue(SCOPE, 'vaultMetadataInvalid');
    }
  }
  return photos;
}

/**
 * Drops cached ciphertext for photos that no longer exist remotely.
 *
 * Separate from `listProgressPhotos` so the caller decides when to pay for it:
 * a refresh must render from metadata immediately and reconcile afterwards,
 * never the other way round. Bounded per call, and silent — a cache that
 * cannot be tidied is not a user-facing problem.
 */
export function reconcileProgressPhotoCache(photos: ProgressPhoto[]): number {
  const uid = auth.currentUser?.uid;
  if (!uid || !isPhotoVaultUnlockedFor(uid)) return 0;
  try {
    return reconcileCachedThumbnails(
      uid,
      photos.map((photo) => photo.photoId),
    );
  } catch {
    return 0;
  }
}

async function resolvePhoto(uid: string, photoOrId: ProgressPhoto | string): Promise<ProgressPhoto> {
  if (typeof photoOrId !== 'string') {
    // Re-derive every target path. Even a forged object cannot escape this uid.
    if (
      photoOrId.storagePath !== storagePathFor(uid, photoOrId.photoId) ||
      (photoOrId.thumbnailStoragePath !== undefined &&
        photoOrId.thumbnailStoragePath !== thumbnailStoragePathFor(uid, photoOrId.photoId))
    ) {
      fail('vaultMetadataInvalid');
    }
    return photoOrId;
  }
  let snapshot;
  try {
    snapshot = await getDoc(photoDoc(uid, photoOrId));
  } catch (error) {
    fail('vaultDownloadFailed', error);
  }
  if (!snapshot.exists()) fail('vaultMetadataInvalid');
  return parseStoredPhoto(uid, photoOrId, snapshot.data());
}

type DownloadAssetKind = 'full' | 'legacy-full';

/**
 * Cross-checks an envelope against the Firestore metadata that claims to
 * describe it, before any key is involved.
 *
 * Shared by the network path and the local cache path on purpose: a file read
 * from this device gets exactly the same scrutiny as one just downloaded.
 * Trusting local bytes more would make the cache the weak link.
 */
function validateEncryptedAsset(
  bytes: Uint8Array,
  encryption: ProgressPhotoEncryption,
  expectedSize: number,
): void {
  if (bytes.length !== expectedSize) fail('vaultDownloadIntegrityFailed');

  let framing;
  try {
    framing = describeEnvelope(bytes);
  } catch {
    fail('vaultDownloadIntegrityFailed');
  }
  if (framing.iv !== encryption.iv || framing.version !== encryption.version) {
    fail('vaultDownloadIntegrityFailed');
  }
}

/**
 * Full-image pipeline. Unchanged by the encrypted thumbnail cache: fulls are
 * still decrypted to a short-lived file under `<cache>/photo-vault/tmp` and
 * are still destroyed by the lock. There is no persistent cache for `.enc`.
 */
async function downloadAsset(
  photo: ProgressPhoto,
  uid: string,
  kind: DownloadAssetKind,
): Promise<{ uri: string; size: number; photo: ProgressPhoto; isFullImage: true }> {
  const encryption = photo.encryption;
  const expectedSize = photo.encryptedSize;
  const objectPath = storagePathFor(uid, photo.photoId);
  const prefix = kind === 'legacy-full' ? 'gallery.legacy-full' : 'viewer.full';
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();
  if (encryption.vaultKeyVersion !== vaultKeyVersion) fail('vaultDownloadIntegrityFailed');

  let bytes: Uint8Array;
  try {
    bytes = await timed(`${prefix}.download` as PhotoVaultPerfStage, async () => {
      const buffer = await getBytes(ref(storage, objectPath), MAX_ENCRYPTED_BYTES);
      return new Uint8Array(buffer);
    });
  } catch (error) {
    fail('vaultDownloadFailed', error);
  }
  validateEncryptedAsset(bytes, encryption, expectedSize);

  const { uri: encryptedUri } = writeEncryptedFile(bytes);
  try {
    const plaintext = await timed(`${prefix}.decrypt` as PhotoVaultPerfStage, () =>
      decryptPhotoFile({
        encryptedUri,
        vaultKeyBase64: vaultKey,
        extension: photo.originalMimeType === 'image/png' ? '.png' : '.jpg',
      }),
    );
    return { ...plaintext, photo, isFullImage: true };
  } finally {
    discardEncryptedPhoto(encryptedUri);
  }
}

/**
 * Grid asset.
 *
 * `isFullImage: false` carries a `data:` URI that exists only in memory.
 * `isFullImage: true` is the untouched legacy fallback for photos uploaded
 * before thumbnails existed, and still carries a temporary file URI.
 */
export type ThumbnailAsset =
  | { isFullImage: false; dataUri: string; photo: ProgressPhoto }
  | { isFullImage: true; uri: string; size: number; photo: ProgressPhoto };

/** The thumbnail is always written as JPEG by `createPhotoVaultThumbnail`. */
function thumbnailDataUri(base64: string): string {
  return `data:image/jpeg;base64,${base64}`;
}

/**
 * Fetches the encrypted thumbnail, preferring the on-device ciphertext cache.
 *
 * Hierarchy owned here, never in the UI:
 *
 *   local `.thumb.enc` → decrypt → data URI      (no network at all)
 *   Storage `getBytes` → cache it → decrypt      (network once)
 *
 * The bytes are decrypted from the copy already in memory in both branches, so
 * a miss costs one write and a hit costs one read — the previous
 * write/read/write/read round trip through two temporary files is gone.
 */
async function loadThumbnail(
  photo: ProgressPhoto,
  uid: string,
  sessionGeneration: number,
): Promise<string | null> {
  const encryption = photo.thumbnailEncryption!;
  const expectedSize = photo.thumbnailEncryptedSize!;
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();
  if (encryption.vaultKeyVersion !== vaultKeyVersion) fail('vaultDownloadIntegrityFailed');

  // Captured before any await. A logout or account switch bumps this, and the
  // cache refuses a write carrying the stale value.
  const epoch = currentPhotoVaultCacheEpoch();

  const cached = await timed('gallery.thumbnail.cache-read', () =>
    readCachedThumbnail({ uid, photoId: photo.photoId, expectedSize }),
  );

  if (cached) {
    try {
      validateEncryptedAsset(cached, encryption, expectedSize);
      const base64 = await timed('gallery.thumbnail.decrypt', () =>
        decryptBytesToBase64(cached, vaultKey),
      );
      requireSamePhotoVaultSession(uid, sessionGeneration);
      recordPhotoVaultCacheOutcome('hit');
      return thumbnailDataUri(base64);
    } catch (error) {
      // The session ended mid-flight: that is not corruption, and re-downloading
      // would be work for a user who is no longer signed in.
      if (isPhotoVaultError(error) && error.issue === 'vaultLocked') throw error;
      // Anything else means these local bytes cannot be trusted. Drop them and
      // fall through to exactly one network attempt — never a retry loop.
      removeCachedThumbnail(uid, photo.photoId);
    }
  }

  recordPhotoVaultCacheOutcome('miss');

  let bytes: Uint8Array;
  try {
    bytes = await timed('gallery.thumbnail.download', async () => {
      const buffer = await getBytes(
        ref(storage, thumbnailStoragePathFor(uid, photo.photoId)),
        MAX_THUMBNAIL_ENCRYPTED_BYTES,
      );
      return new Uint8Array(buffer);
    });
  } catch (error) {
    // A rare partial delete may leave immutable metadata referring to a
    // missing thumbnail while the primary full ciphertext still exists.
    // Signalled here, where the raw Storage error is still available, so the
    // caller can use the controlled legacy fallback. Never fall back on
    // permission, integrity or network errors.
    if (isObjectNotFound(error)) return null;
    fail('vaultDownloadFailed', error);
  }
  validateEncryptedAsset(bytes, encryption, expectedSize);

  // Storing before decrypting keeps the cache write out of the way of the
  // pixels, and a failed write only costs a future re-download.
  const finishWrite = startPhotoVaultPerf('gallery.thumbnail.cache-write');
  writeCachedThumbnail({ uid, photoId: photo.photoId, bytes, epoch });
  finishWrite();

  const base64 = await timed('gallery.thumbnail.decrypt', () =>
    decryptBytesToBase64(bytes, vaultKey),
  );
  requireSamePhotoVaultSession(uid, sessionGeneration);
  return thumbnailDataUri(base64);
}

/** Grid asset: thumbnail for new photos; controlled full fallback for legacy photos. */
export async function downloadProgressPhotoThumbnail(
  photo: ProgressPhoto,
): Promise<ThumbnailAsset> {
  const uid = currentUnlockedUid();
  const sessionGeneration = photoVaultSessionGeneration();
  const resolved = await resolvePhoto(uid, photo);
  const hasThumbnail =
    resolved.thumbnailStoragePath !== undefined &&
    resolved.thumbnailEncryptedSize !== undefined &&
    resolved.thumbnailEncryption !== undefined;

  if (!hasThumbnail) {
    return downloadAsset(resolved, uid, 'legacy-full');
  }

  const dataUri = await loadThumbnail(resolved, uid, sessionGeneration);
  if (dataUri === null) return downloadAsset(resolved, uid, 'legacy-full');
  return { isFullImage: false, dataUri, photo: resolved };
}

/** Viewer asset. Passing list metadata avoids a redundant Firestore read. */
export async function downloadProgressPhoto(
  photoOrId: ProgressPhoto | string,
): Promise<{ uri: string; size: number; photo: ProgressPhoto }> {
  const uid = currentUnlockedUid();
  const photo = await resolvePhoto(uid, photoOrId);
  return downloadAsset(photo, uid, 'full');
}

async function deleteStorageObject(
  objectRef: ReturnType<typeof ref>,
  stage: 'delete.full.storage' | 'delete.thumbnail.storage',
): Promise<void> {
  try {
    await timed(stage, () => deleteObject(objectRef));
  } catch (error) {
    if (!isObjectNotFound(error)) throw error;
  }
}

/** Deletes ciphertext only; no download, key access or decryption is involved. */
export async function deleteProgressPhoto(photoOrId: ProgressPhoto | string): Promise<void> {
  const finishTotal = startPhotoVaultPerf('delete.total');
  const uid = currentUnlockedUid();
  try {
    const photo = await resolvePhoto(uid, photoOrId);
    // Invalidated as the delete begins, not after it succeeds. A stale
    // thumbnail surviving a partially failed delete would be worse than the
    // re-download that dropping it costs, and a restored photo can always be
    // fetched again.
    removeCachedThumbnail(uid, photo.photoId);
    const deletions: Promise<void>[] = [
      deleteStorageObject(ref(storage, storagePathFor(uid, photo.photoId)), 'delete.full.storage'),
    ];
    if (photo.thumbnailStoragePath) {
      deletions.push(
        deleteStorageObject(
          ref(storage, thumbnailStoragePathFor(uid, photo.photoId)),
          'delete.thumbnail.storage',
        ),
      );
    }

    const results = await Promise.allSettled(deletions);
    const fullResult = results[0]!;
    const thumbnailResult = results[1];
    if (fullResult.status === 'rejected') {
      // If thumbnail deletion succeeded but full did not, the primary photo
      // remains recoverable. Keep metadata, refetch and use the missing-thumb
      // fallback above. If neither delete worked, nothing changed remotely.
      if (thumbnailResult?.status === 'fulfilled') {
        fail('vaultPartialDelete', fullResult.reason);
      }
      fail('vaultDeleteFailed', fullResult.reason);
    }
    // If full is gone but thumbnail deletion failed, completing Firestore
    // deletion is the least misleading state. The encrypted thumbnail is an
    // invisible orphan reclaimed by the existing conservative cleanup.

    try {
      await timed('delete.firestore', () => deleteDoc(photoDoc(uid, photo.photoId)));
    } catch (error) {
      fail('vaultPartialDelete', error);
    }
  } finally {
    finishTotal();
  }
}
