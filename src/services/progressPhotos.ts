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
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  getMetadata,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';

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
  isProgressPhotoPose,
  isValidDateKey,
  localDateKey,
  progressPhotoDocumentId,
  resolveProgressPhotoAssetId,
  type ProgressPhotoPose,
} from '../lib/photoVaultIdentity';
import {
  recordPhotoVaultBytes,
  recordPhotoVaultCacheEvent,
  recordPhotoVaultCacheOutcome,
  startPhotoVaultPerf,
  type PhotoVaultPerfStage,
} from '../lib/photoVaultPerformance';
import type { PhotoVaultUploadJob } from '../lib/photoVaultUploadJob';
import { discardDurableAsset, durableAssetPaths } from './photoVaultDurableStore';
import { startPhotoVaultTrace, tracePhotoVault } from '../lib/photoVaultDevTrace';
import {
  isPhotoVaultUnlockedFor,
  photoVaultSessionGeneration,
  requirePhotoVaultUnlocked,
  requireSamePhotoVaultSession,
} from '../lib/photoVaultSession';
import { ensurePhotoVaultKey } from './photoVault';
import {
  currentPhotoVaultCacheEpoch,
  readCachedFull,
  readCachedThumbnail,
  reconcileCachedFulls,
  reconcileCachedThumbnails,
  removeCachedFull,
  removeCachedThumbnail,
  writeCachedFull,
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
import {
  reconcilePhotoVaultContentPresence,
  setPhotoVaultContentPresence,
} from './photoVaultContentPresence';
import { generateLockedPreviewDerivative } from './photoVaultLockedPreviewGenerator';
import {
  currentPhotoVaultLockedPreviewEpoch,
  hasLockedPreviewDerivative,
  removeLockedPreviewDerivative,
  writeLockedPreviewDerivative,
} from './photoVaultLockedPreviewCache';

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
  /**
   * The Firestore document id. For a posed photo this is `{dateKey}_{pose}`;
   * for every earlier photo it is the asset's UUID. Kept under its original
   * name so no caller has to change — but it is NOT what addresses the
   * ciphertext. Use `assetId` for anything touching Storage or the cache.
   */
  photoId: string;
  /** Opaque UUID naming the ciphertext. Equals `photoId` on pre-pose photos. */
  assetId: string;
  /** Present only on posed photos; absent means "recorded before poses". */
  pose?: ProgressPhotoPose;
  /** Local calendar day, frozen at creation. Present only on posed photos. */
  dateKey?: string;
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

/**
 * Parses one stored document into the closed set of shapes the vault accepts.
 *
 * Three generations coexist and none is migrated:
 *
 *   legacy  — six fields, no thumbnail, document named after the asset;
 *   phase13 — adds the three thumbnail fields atomically;
 *   posed   — adds assetId/dateKey/pose; the document is named
 *             `{dateKey}_{pose}` and the asset is addressed by field.
 *
 * Fail-closed and shape-complete: a document carrying only SOME of the posed
 * fields is rejected outright rather than downgraded to an earlier shape.
 * Testing `'pose' in data` alone would accept exactly that half-written state.
 */
function parseStoredPhoto(uid: string, photoId: string, data: unknown): ProgressPhoto {
  const d = data as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) fail('vaultMetadataInvalid');

  const posedFieldCount =
    Number('assetId' in d) + Number('dateKey' in d) + Number('pose' in d);
  // All three or none. A partial set means the document is not something this
  // client wrote, and guessing which generation it belongs to would be wrong.
  if (posedFieldCount !== 0 && posedFieldCount !== 3) fail('vaultMetadataInvalid');
  const isPosed = posedFieldCount === 3;

  let assetId: string;
  try {
    assetId = resolveProgressPhotoAssetId({
      documentId: photoId,
      assetId: isPosed ? d.assetId : undefined,
    });
  } catch {
    fail('vaultMetadataInvalid');
  }

  if (isPosed) {
    // The document id IS the uniqueness key; a mismatch means the metadata and
    // its address disagree about which day/pose this is.
    if (
      !isValidDateKey(d.dateKey) ||
      !isProgressPhotoPose(d.pose) ||
      photoId !== progressPhotoDocumentId(d.dateKey, d.pose)
    ) {
      fail('vaultMetadataInvalid');
    }
    // A posed photo always carries a thumbnail; the Rules require it too.
    if (!('thumbnailStoragePath' in d)) fail('vaultMetadataInvalid');
  }

  // Paths are re-derived from the ASSET, never from the document id.
  const expectedPath = storagePathFor(uid, assetId);
  const expectedThumbnailPath = thumbnailStoragePathFor(uid, assetId);
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
    assetId,
    storagePath: expectedPath,
    takenAt: (d.takenAt as Timestamp).toDate(),
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : null,
    originalMimeType: d.originalMimeType as string,
    encryptedSize: d.encryptedSize as number,
    encryption: d.encryption as ProgressPhotoEncryption,
  };
  if (isPosed) {
    result.pose = d.pose as ProgressPhotoPose;
    result.dateKey = d.dateKey as string;
  }
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

/**
 * Result of a rollback attempt. Carries the provider error on failure so the
 * caller can log *why* the orphaned ciphertext could not be reclaimed — a
 * bare boolean loses exactly the detail that makes the failure diagnosable.
 */
type RollbackOutcome = { ok: true } | { ok: false; reason: unknown };

function isObjectNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === 'storage/object-not-found'
  );
}

async function deleteRefsForRollback(
  objectRefs: ReturnType<typeof ref>[],
): Promise<RollbackOutcome> {
  const results = await Promise.allSettled(objectRefs.map((objectRef) => deleteObject(objectRef)));
  // The first genuinely failed delete is what the caller logs. Without it the
  // rollback issue reaches the log with `providerCode: undefined`, which hides
  // the one thing that distinguishes a denied delete (`storage/unauthorized`,
  // i.e. the caller is not authorized to touch the vault at all) from a
  // transient one (`storage/retry-limit-exceeded`, offline, …).
  const failed = results.find(
    (result) => result.status === 'rejected' && !isObjectNotFound(result.reason),
  );

  return failed?.status === 'rejected'
    ? { ok: false, reason: failed.reason }
    : { ok: true };
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

/**
 * Whether a document already occupies this slot.
 *
 * Used only to explain a failed write. An unreadable answer is reported as
 * "not taken" so a network problem is never mislabelled as a duplicate.
 */
async function slotIsTaken(uid: string, documentId: string): Promise<boolean> {
  try {
    return (await getDoc(photoDoc(uid, documentId))).exists();
  } catch {
    return false;
  }
}

export interface UploadProgressPhotoParams {
  sourceUri: string;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  /**
   * Which view of the body this photo is.
   *
   * Optional on purpose, and it is the ONLY new thing a caller may supply.
   * Omitting it keeps the pre-pose behaviour byte for byte, which is what lets
   * the current screens keep working before a pose picker exists. Supplying it
   * selects the posed schema, and every other identifier — the day, the
   * document id, the asset id, both Storage paths — is derived here rather
   * than accepted from the caller.
   */
  pose?: ProgressPhotoPose;
  width?: number;
  height?: number;
  onProgress?: (progress: number) => void;
}

interface UploadedAssets {
  assetId: string;
  storagePath: string;
  thumbnailStoragePath: string;
  encryptedSize: number;
  thumbnailEncryptedSize: number;
  encryption: ProgressPhotoEncryption;
  thumbnailEncryption: ProgressPhotoEncryption;
  /** Removes both objects. Idempotent; a missing object counts as removed. */
  rollback: () => Promise<RollbackOutcome>;
}

/**
 * Best-effort: generates and caches the locked-screen background derivative
 * from plaintext that already exists for a legitimate reason — a fresh
 * upload, or a photo the user just opened in the viewer. Never throws: this
 * is a cosmetic feature, so a failure here must never surface as an upload or
 * viewing error, and must never block either.
 *
 * The epoch is captured by the caller, at the same point it captures the
 * plaintext — see `photoVaultLockedPreviewCache.ts` for why that matters.
 */
async function cacheLockedPreviewDerivative(
  uid: string,
  assetId: string,
  plaintextUri: string,
  epoch: number,
): Promise<void> {
  const bytes = await generateLockedPreviewDerivative(plaintextUri);
  if (!bytes) return;
  writeLockedPreviewDerivative({ uid, assetId, bytes, epoch });
}

/**
 * Seals a photo into two independent assets and uploads both.
 *
 * Everything up to (but not including) the metadata commit lives here, so the
 * create and replace flows share one pipeline rather than drifting apart. The
 * caller commits metadata and, on failure, calls `rollback`.
 *
 * The returned assets are addressed by a brand-new UUID every time. Storage
 * objects are immutable by rule — `resource == null` on create — so an
 * overwrite is impossible by construction, and a replacement necessarily
 * produces a second object rather than mutating the first.
 */
async function uploadNewAssets(params: {
  uid: string;
  sourceUri: string;
  width?: number;
  height?: number;
  vaultKey: string;
  vaultKeyVersion: number;
  onProgress?: (progress: number) => void;
}): Promise<UploadedAssets> {
  const { uid, vaultKey, vaultKeyVersion } = params;
  const assetId = randomUUID();
  const storagePath = storagePathFor(uid, assetId);
  const thumbnailStoragePath = thumbnailStoragePathFor(uid, assetId);
  let thumbnailPlaintextUri: string | null = null;
  let fullEncrypted: EncryptedPhotoResult | null = null;
  let thumbnailEncrypted: EncryptedPhotoResult | null = null;
  let fullUploadBlob: Blob | null = null;
  let thumbnailUploadBlob: Blob | null = null;

  try {
    const finishThumbnail = startPhotoVaultTrace('upload.thumbnail_started');
    const thumbnail = await timed('upload.thumbnail.generate', () =>
      createPhotoVaultThumbnail({
        sourceUri: params.sourceUri,
        width: params.width ?? 1600,
        height: params.height ?? 1600,
      }),
    );
    thumbnailPlaintextUri = thumbnail.uri;
    finishThumbnail('upload.thumbnail_completed');
    await cacheLockedPreviewDerivative(
      uid,
      assetId,
      thumbnail.uri,
      currentPhotoVaultLockedPreviewEpoch(),
    );

    const finishEncryption = startPhotoVaultTrace('upload.encryption_started');
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

    finishEncryption('upload.encryption_completed');

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
    const rollback = () => deleteRefsForRollback([fullRef, thumbnailRef]);
    const transferred = [0, 0];
    const totalBytes = openedFullBlob.size + openedThumbnailBlob.size;
    const report = (index: number, bytes: number) => {
      transferred[index] = bytes;
      if (totalBytes > 0) params.onProgress?.((transferred[0] + transferred[1]) / totalBytes);
    };

    const finishTransfer = startPhotoVaultTrace('upload.storage_upload_started');
    const uploads = await Promise.allSettled([
      timed('upload.full.transfer', () =>
        uploadCiphertext(
          fullRef,
          openedFullBlob,
          { ownerId: uid, photoId: assetId, assetKind: 'full' },
          (bytes) => report(0, bytes),
        ),
      ),
      timed('upload.thumbnail.transfer', () =>
        uploadCiphertext(
          thumbnailRef,
          openedThumbnailBlob,
          { ownerId: uid, photoId: assetId, assetKind: 'thumbnail' },
          (bytes) => report(1, bytes),
        ),
      ),
    ]);
    finishTransfer('upload.storage_upload_completed', {
      rejected: uploads.filter((result) => result.status === 'rejected').length,
    });
    if (uploads.some((result) => result.status === 'rejected')) {
      const rejected = uploads.find((result) => result.status === 'rejected');
      const uploadCause = rejected?.status === 'rejected' ? rejected.reason : undefined;
      const rolledBack = await rollback();
      if (!rolledBack.ok) {
        // An orphaned ciphertext outranks the upload error as the reported
        // issue, but the upload cause is still the more useful diagnosis —
        // log it before it is lost to the throw below.
        logPhotoVaultIssue(SCOPE, 'vaultUploadFailed', sanitizedErrorCode(uploadCause));
        fail('vaultUploadRollbackFailed', rolledBack.reason);
      }
      fail('vaultUploadFailed', uploadCause);
    }

    return {
      assetId,
      storagePath,
      thumbnailStoragePath,
      encryptedSize: fullEncrypted.encryptedSize,
      thumbnailEncryptedSize: thumbnailEncrypted.encryptedSize,
      encryption: encryptionMetadata(fullEncrypted),
      thumbnailEncryption: encryptionMetadata(thumbnailEncrypted),
      rollback,
    };
  } finally {
    if (thumbnailPlaintextUri) discardDecryptedPhoto(thumbnailPlaintextUri);
    closeEncryptedUploadBlob(fullUploadBlob);
    closeEncryptedUploadBlob(thumbnailUploadBlob);
    if (fullEncrypted) discardEncryptedPhoto(fullEncrypted.encryptedUri);
    if (thumbnailEncrypted) discardEncryptedPhoto(thumbnailEncrypted.encryptedUri);
  }
}

/** The document body for one photo, in the shape the rules accept. */
function photoDocumentBody(params: {
  assets: UploadedAssets;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  pose?: ProgressPhotoPose;
  dateKey?: string;
}): Record<string, unknown> {
  const { assets, pose, dateKey } = params;
  return {
    storagePath: assets.storagePath,
    thumbnailStoragePath: assets.thumbnailStoragePath,
    ...(pose !== undefined && dateKey !== undefined ? { assetId: assets.assetId, dateKey, pose } : {}),
    createdAt: serverTimestamp(),
    takenAt: Timestamp.fromDate(params.takenAt),
    originalMimeType: params.originalMimeType,
    encryptedSize: assets.encryptedSize,
    thumbnailEncryptedSize: assets.thumbnailEncryptedSize,
    encryption: assets.encryption,
    thumbnailEncryption: assets.thumbnailEncryption,
  };
}

/**
 * Creates two independently sealed assets, uploads both, then commits metadata.
 *
 * NO LONGER ON THE PRODUCTION SAVE PATH. The gallery now goes through
 * `prepareProgressPhotoUpload` + the durable queue, so a save is never blocked
 * on the network. This one-shot version is retained deliberately rather than
 * deleted: it is the reference implementation of the all-or-nothing semantics
 * (upload both, commit, roll back everything on any failure) that the resumable
 * path had to depart from, and its suite still pins the rollback behaviour the
 * new path's `discardPreparedRemoteState` is measured against.
 *
 * It writes its ciphertext to the RECLAIMABLE staging directory, which is why
 * it can never be the save path again: a photo that only exists there is one
 * OS cache purge away from being gone.
 */
export async function uploadProgressPhoto(
  params: UploadProgressPhotoParams,
): Promise<ProgressPhoto> {
  const finishTotal = startPhotoVaultPerf('upload.total');
  const finishTrace = startPhotoVaultTrace('upload.started', {
    pose: params.pose ?? 'none',
  });
  // Nothing is traced between `upload.started` and the next line when the
  // session gate rejects: `currentUnlockedUid()` throws synchronously, outside
  // the try below, so a missing `upload.vault_session_validated` means the
  // vault was already locked when this save began.
  const uid = currentUnlockedUid();
  tracePhotoVault('upload.vault_session_validated');
  const finishKey = startPhotoVaultTrace('upload.vault_key_started');
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();
  finishKey('upload.vault_key_result', { ok: true });

  const pose = params.pose;
  if (pose !== undefined && !isProgressPhotoPose(pose)) fail('vaultMetadataInvalid');
  // The day comes from the photo's own capture time, read in the LOCAL
  // calendar — see `localDateKey`. Never from the clock and never from UTC.
  const dateKey = pose === undefined ? undefined : localDateKey(params.takenAt);

  try {
    const assets = await uploadNewAssets({
      uid,
      sourceUri: params.sourceUri,
      width: params.width,
      height: params.height,
      vaultKey,
      vaultKeyVersion,
      onProgress: params.onProgress,
    });
    // Storage always addresses an opaque UUID. Only the Firestore document id
    // changes between the two shapes.
    const photoId =
      pose === undefined || dateKey === undefined
        ? assets.assetId
        : progressPhotoDocumentId(dateKey, pose);

    const finishFirestore = startPhotoVaultTrace('upload.firestore_write_started');
    try {
      await timed('upload.firestore', () =>
        setDoc(
          photoDoc(uid, photoId),
          photoDocumentBody({
            assets,
            takenAt: params.takenAt,
            originalMimeType: params.originalMimeType,
            pose,
            dateKey,
          }),
        ),
      );
      finishFirestore('upload.firestore_write_completed');
    } catch (error) {
      finishFirestore('upload.firestore_write_failed', {
        code: sanitizedErrorCode(error),
      });
      // Both objects go, whatever the cause: no ciphertext is left behind
      // outside the rollback policy.
      const rolledBack = await assets.rollback();
      if (!rolledBack.ok) {
        // Same precedence as the upload path: the orphan is what we report,
        // but the metadata cause is logged first so it is not lost.
        logPhotoVaultIssue(SCOPE, 'vaultMetadataCreateFailed', sanitizedErrorCode(error));
        fail('vaultUploadRollbackFailed', rolledBack.reason);
      }
      // A posed document is named after its (day, pose), so writing over an
      // existing one is an update — which the rules deny. Rather than guess
      // from the error code, ask whether the slot is actually taken: another
      // device may have filled it while this upload was running. One extra
      // read, only on the failure path, buys an honest message.
      if (pose !== undefined && (await slotIsTaken(uid, photoId))) {
        fail('vaultPhotoSlotTaken', error);
      }
      fail('vaultMetadataCreateFailed', error);
    }

    // Firestore has confirmed the first durable authority for this asset.
    // The one-bit locked-layout hint must never flip on the optimistic card or
    // on Storage upload alone, both of which can still roll back.
    const finishPresence = startPhotoVaultTrace('upload.content_presence_started');
    await setPhotoVaultContentPresence(uid, true);
    finishPresence('upload.content_presence_completed');

    finishTrace('upload.completed', { pose: pose ?? 'none' });
    return {
      photoId,
      assetId: assets.assetId,
      ...(pose !== undefined && dateKey !== undefined ? { pose, dateKey } : {}),
      storagePath: assets.storagePath,
      thumbnailStoragePath: assets.thumbnailStoragePath,
      takenAt: params.takenAt,
      createdAt: null,
      originalMimeType: params.originalMimeType,
      encryptedSize: assets.encryptedSize,
      thumbnailEncryptedSize: assets.thumbnailEncryptedSize,
      encryption: assets.encryption,
      thumbnailEncryption: assets.thumbnailEncryption,
    };
  } catch (error) {
    finishTrace('upload.failed', {
      issue: error instanceof PhotoVaultError ? error.issue : 'unknown',
      code: sanitizedErrorCode(error),
    });
    if (error instanceof PhotoVaultError) throw error;
    return fail('vaultUploadFailed', error);
  } finally {
    finishTotal();
  }
}

// ── Local-first save ───────────────────────────────────────────────────────
//
// The save above does everything in one breath, with the user watching. The
// pair below splits it at the only boundary that matters for safety:
//
//   prepare  reads the user's plaintext and uses the vault key, so it REQUIRES
//            an unlocked session — and it ends with durable ciphertext on this
//            device, which is the point at which the photo is genuinely saved.
//
//   sync     moves bytes that are already sealed. It needs no key, decrypts
//            nothing, and reads no plaintext, so gating it on the vault
//            session would protect nothing while costing the user their photo
//            every time the screen locked mid-upload.
//
// The gate for sync is therefore identity, not visibility: the job must belong
// to the user who is signed in right now. That is what `requireSignedInUser`
// enforces, and it is the same guarantee Storage and Firestore enforce
// themselves through the auth token and their rules.

/**
 * Remote-sync gate.
 *
 * Deliberately NOT `requirePhotoVaultUnlocked`. A relock hides the gallery and
 * destroys every decrypted representation — that is the vault's visual
 * authorization, and it is untouched. Finishing the transfer of a blob that
 * was encrypted while the vault WAS open is a different act, and making it
 * depend on the screen still being unlocked would mean a photo is lost to a
 * backgrounded app rather than protected from anyone.
 */
function requireSignedInUser(uid: string): void {
  if (!uid || auth.currentUser?.uid !== uid) fail('vaultLocked');
}

/** What preparation produced: sealed, durable, and not yet anywhere remote. */
export interface PreparedProgressPhoto {
  /** Resolved from the unlocked session, so the caller never supplies one. */
  uid: string;
  assetId: string;
  documentId: string;
  pose?: ProgressPhotoPose;
  dateKey?: string;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  encryptedSize: number;
  thumbnailEncryptedSize: number;
  encryption: ProgressPhotoEncryption;
  thumbnailEncryption: ProgressPhotoEncryption;
}

/**
 * Seals one photo into two durable ciphertexts.
 *
 * This is the whole of what the user waits for. When it returns, the photo
 * survives a crash, a force-kill and a locked vault — nothing that happens
 * afterwards can lose it, which is what makes closing the sheet here honest
 * rather than a hidden loading state.
 *
 * Requires an unlocked vault, because it reads the staged plaintext and uses
 * the vault key. Both envelopes are written STRAIGHT to their durable paths;
 * there is no reclaimable intermediate copy that a later step has to move.
 */
export async function prepareProgressPhotoUpload(
  params: UploadProgressPhotoParams,
): Promise<PreparedProgressPhoto> {
  const finishTotal = startPhotoVaultPerf('upload.prepare.total');
  const finishTrace = startPhotoVaultTrace('upload.local_prepare_started', {
    pose: params.pose ?? 'none',
  });
  // Plaintext and key are about to be touched: this is exactly the operation
  // the vault session exists to authorize.
  const uid = currentUnlockedUid();
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();

  const pose = params.pose;
  if (pose !== undefined && !isProgressPhotoPose(pose)) fail('vaultMetadataInvalid');
  const dateKey = pose === undefined ? undefined : localDateKey(params.takenAt);

  const assetId = randomUUID();
  const { fullUri, thumbnailUri } = durableAssetPaths(uid, assetId);
  let thumbnailPlaintextUri: string | null = null;
  let sealed = false;

  try {
    const thumbnail = await timed('upload.thumbnail.generate', () =>
      createPhotoVaultThumbnail({
        sourceUri: params.sourceUri,
        width: params.width ?? 1600,
        height: params.height ?? 1600,
      }),
    );
    thumbnailPlaintextUri = thumbnail.uri;
    recordPhotoVaultBytes('upload.thumbnail.plaintext', {
      bytes: thumbnail.size,
      width: thumbnail.width,
      height: thumbnail.height,
    });
    await cacheLockedPreviewDerivative(
      uid,
      assetId,
      thumbnail.uri,
      currentPhotoVaultLockedPreviewEpoch(),
    );

    const [fullEncrypted, thumbnailEncrypted] = await Promise.all([
      timed('upload.full.encrypt', () =>
        encryptPhotoFile({
          sourceUri: params.sourceUri,
          vaultKeyBase64: vaultKey,
          vaultKeyVersion,
          targetUri: fullUri,
        }),
      ),
      timed('upload.thumbnail.encrypt', () =>
        encryptPhotoFile({
          sourceUri: thumbnail.uri,
          vaultKeyBase64: vaultKey,
          vaultKeyVersion,
          targetUri: thumbnailUri,
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

    recordPhotoVaultBytes('upload.full.encrypted', { bytes: fullEncrypted.encryptedSize });
    recordPhotoVaultBytes('upload.thumbnail.encrypted', {
      bytes: thumbnailEncrypted.encryptedSize,
    });

    sealed = true;
    finishTrace('upload.local_prepare_completed', { pose: pose ?? 'none' });
    return {
      uid,
      assetId,
      documentId:
        pose === undefined || dateKey === undefined
          ? assetId
          : progressPhotoDocumentId(dateKey, pose),
      ...(pose !== undefined && dateKey !== undefined ? { pose, dateKey } : {}),
      takenAt: params.takenAt,
      originalMimeType: params.originalMimeType,
      encryptedSize: fullEncrypted.encryptedSize,
      thumbnailEncryptedSize: thumbnailEncrypted.encryptedSize,
      encryption: encryptionMetadata(fullEncrypted),
      thumbnailEncryption: encryptionMetadata(thumbnailEncrypted),
    };
  } catch (error) {
    finishTrace('upload.local_prepare_failed', {
      issue: error instanceof PhotoVaultError ? error.issue : 'unknown',
    });
    if (error instanceof PhotoVaultError) throw error;
    return fail('vaultUploadFailed', error);
  } finally {
    // The 480px JPEG is plaintext and has done its job either way.
    if (thumbnailPlaintextUri) discardDecryptedPhoto(thumbnailPlaintextUri);
    // A half-sealed asset has no job to claim it and nothing would ever
    // reclaim it, so it is removed here rather than left for a sweep.
    if (!sealed) discardDurableAsset(uid, assetId);
    finishTotal();
  }
}

/** Where one of this asset's two objects lives in Storage. */
function assetRef(uid: string, assetId: string, kind: 'full' | 'thumbnail') {
  return ref(
    storage,
    kind === 'full'
      ? storagePathFor(uid, assetId)
      : thumbnailStoragePathFor(uid, assetId),
  );
}

/**
 * Whether Storage already holds this object, at the size we expect.
 *
 * The Storage rules only permit creating an object where nothing exists
 * (`resource == null`), so an upload that landed and was then forgotten —
 * killed between the transfer and the checkpoint that records it — cannot
 * simply be repeated: the retry would be REFUSED, and a job would fail forever
 * over work that was already done. Asking first is what makes a resumed job
 * idempotent. Only ever called on a retry, so the happy path pays nothing.
 */
export async function preparedAssetExistsRemotely(
  uid: string,
  assetId: string,
  kind: 'full' | 'thumbnail',
  expectedSize: number,
): Promise<boolean> {
  requireSignedInUser(uid);
  const finish = startPhotoVaultPerf('upload.sync.probe');
  try {
    const metadata = await getMetadata(assetRef(uid, assetId, kind));
    // A size disagreement means the object is not the one this job sealed;
    // treating it as ours would publish bytes we cannot account for.
    return metadata.size === expectedSize;
  } catch (error) {
    if (isObjectNotFound(error)) return false;
    // Anything else (offline, denied) is not proof of absence, and answering
    // "absent" would send an upload that is about to be refused.
    fail('vaultUploadFailed', error);
  } finally {
    finish();
  }
}

/**
 * Uploads one already-sealed object from the durable store.
 *
 * Never reads plaintext and never touches the vault key. The bytes are opened
 * straight from the durable file, so this works identically whether the vault
 * is open or locked.
 */
export async function uploadPreparedAsset(params: {
  uid: string;
  job: PhotoVaultUploadJob;
  kind: 'full' | 'thumbnail';
  onProgress?: (transferred: number) => void;
}): Promise<void> {
  const { uid, job, kind } = params;
  requireSignedInUser(uid);

  const { fullUri, thumbnailUri } = durableAssetPaths(uid, job.assetId);
  const sourceUri = kind === 'full' ? fullUri : thumbnailUri;
  const expectedSize =
    kind === 'full' ? job.encryptedSize : job.thumbnailEncryptedSize;

  let blob: Blob | null = null;
  try {
    blob = await openEncryptedUploadBlob(sourceUri);
    if (blob.size !== expectedSize) {
      // The durable copy no longer matches what the job describes, so the
      // metadata already recorded for it would be wrong.
      fail('vaultMetadataInvalid');
    }
    await timed(
      kind === 'full' ? 'upload.sync.full.transfer' : 'upload.sync.thumbnail.transfer',
      () =>
        uploadCiphertext(
          assetRef(uid, job.assetId, kind),
          blob!,
          { ownerId: uid, photoId: job.assetId, assetKind: kind },
          (bytes) => params.onProgress?.(bytes),
        ),
    );
  } catch (error) {
    if (error instanceof PhotoVaultError) throw error;
    fail('vaultUploadFailed', error);
  } finally {
    closeEncryptedUploadBlob(blob);
  }
}

/** The document body a prepared job commits, in the shape the rules accept. */
function preparedDocumentBody(job: PhotoVaultUploadJob): Record<string, unknown> {
  const posed = job.pose !== undefined && job.dateKey !== undefined;
  return {
    storagePath: storagePathFor(job.uid, job.assetId),
    thumbnailStoragePath: thumbnailStoragePathFor(job.uid, job.assetId),
    ...(posed ? { assetId: job.assetId, dateKey: job.dateKey, pose: job.pose } : {}),
    createdAt: serverTimestamp(),
    takenAt: Timestamp.fromDate(new Date(job.takenAt)),
    originalMimeType: job.originalMimeType,
    encryptedSize: job.encryptedSize,
    thumbnailEncryptedSize: job.thumbnailEncryptedSize,
    encryption: job.encryption,
    thumbnailEncryption: job.thumbnailEncryption,
  };
}

/**
 * Whether the document this job would write already exists AND is this job's.
 *
 * The `assetId` comparison is what separates "my own write already landed" from
 * "someone else filled this (day, pose) slot". The first means the job is
 * further along than its checkpoint claimed; the second is a genuine conflict
 * that no retry can resolve.
 */
export async function preparedMetadataState(
  uid: string,
  job: PhotoVaultUploadJob,
): Promise<'absent' | 'ours' | 'foreign'> {
  requireSignedInUser(uid);
  let snapshot;
  try {
    snapshot = await getDoc(photoDoc(uid, job.documentId));
  } catch (error) {
    fail('vaultMetadataCreateFailed', error);
  }
  if (!snapshot.exists()) return 'absent';
  const data = snapshot.data() as { assetId?: unknown };
  // A pre-pose document is named after its asset, so the id itself is proof.
  const claimsThisAsset =
    data.assetId === job.assetId || job.documentId === job.assetId;
  return claimsThisAsset ? 'ours' : 'foreign';
}

/** Commits the metadata for an already-uploaded pair of objects. */
export async function commitPreparedMetadata(
  uid: string,
  job: PhotoVaultUploadJob,
): Promise<void> {
  requireSignedInUser(uid);
  try {
    await timed('upload.sync.firestore', () =>
      setDoc(photoDoc(uid, job.documentId), preparedDocumentBody(job)),
    );
  } catch (error) {
    // The document id IS the (day, pose) pair and the rules forbid `update`,
    // so a slot another device already filled surfaces here. Ask rather than
    // guess from the error code — one read, only on the failure path.
    if (job.pose !== undefined && (await slotIsTaken(uid, job.documentId))) {
      fail('vaultPhotoSlotTaken', error);
    }
    fail('vaultMetadataCreateFailed', error);
  }
}

/**
 * The gallery's view of a synced job.
 *
 * Built from the job rather than re-read from Firestore: every field was
 * settled at preparation time and the document was just written from exactly
 * these values, so a round trip would only confirm what we already wrote.
 */
export function progressPhotoFromJob(job: PhotoVaultUploadJob): ProgressPhoto {
  const posed = job.pose !== undefined && job.dateKey !== undefined;
  return {
    photoId: job.documentId,
    assetId: job.assetId,
    ...(posed ? { pose: job.pose, dateKey: job.dateKey } : {}),
    storagePath: storagePathFor(job.uid, job.assetId),
    thumbnailStoragePath: thumbnailStoragePathFor(job.uid, job.assetId),
    takenAt: new Date(job.takenAt),
    createdAt: null,
    originalMimeType: job.originalMimeType,
    encryptedSize: job.encryptedSize,
    thumbnailEncryptedSize: job.thumbnailEncryptedSize,
    encryption: job.encryption,
    thumbnailEncryption: job.thumbnailEncryption,
  };
}

/**
 * Removes whatever a cancelled job managed to place remotely.
 *
 * Best effort and deliberately tolerant: the job is being abandoned, so the
 * worst case is an unreferenced object that the backend's orphan sweep
 * reclaims after its grace period.
 */
export async function discardPreparedRemoteState(
  uid: string,
  job: PhotoVaultUploadJob,
): Promise<void> {
  if (auth.currentUser?.uid !== uid) return;
  if (job.stage === 'metadata-complete') {
    try {
      await deleteDoc(photoDoc(uid, job.documentId));
    } catch {
      logPhotoVaultIssue(SCOPE, 'vaultDeleteFailed');
    }
  }
  const targets: ReturnType<typeof ref>[] = [];
  if (job.uploadedFull) targets.push(assetRef(uid, job.assetId, 'full'));
  if (job.uploadedThumbnail) targets.push(assetRef(uid, job.assetId, 'thumbnail'));
  if (targets.length === 0) return;
  const results = await Promise.allSettled(targets.map((target) => deleteObject(target)));
  if (
    results.some((result) => result.status === 'rejected' && !isObjectNotFound(result.reason))
  ) {
    logPhotoVaultIssue(SCOPE, 'vaultDeleteFailed');
  }
}

export interface ReplaceProgressPhotoParams {
  /** The photo being replaced, as the client currently knows it. */
  current: ProgressPhoto;
  sourceUri: string;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  width?: number;
  height?: number;
  onProgress?: (progress: number) => void;
}

/**
 * Replaces the photo occupying one (day, pose) slot.
 *
 * The ordering is the whole point, and it is deliberate:
 *
 *   1. seal and upload the NEW ciphertext under a brand-new UUID;
 *   2. only then remove the old metadata, under a compare-and-swap;
 *   3. write the new metadata at the SAME document id;
 *   4. only then delete the old ciphertext.
 *
 * Nothing the user owns is destroyed until its replacement is fully durable.
 * A failure anywhere in 1–2 leaves the original photo completely intact.
 *
 * The document id is the (day, pose) pair and the rules forbid `update`, so a
 * swap is necessarily delete-then-create. Firestore also refuses two writes to
 * one document inside a single transaction, so these cannot be one atomic
 * step. The window between them is real and is compensated for in step 3
 * rather than hidden.
 */
export async function replaceProgressPhoto(
  params: ReplaceProgressPhotoParams,
): Promise<ProgressPhoto> {
  const finishTotal = startPhotoVaultPerf('upload.total');
  const uid = currentUnlockedUid();

  try {
    const current = await resolvePhoto(uid, params.current);
    const { pose, dateKey, assetId: expectedAssetId } = current;
    // Replacement is defined only for a posed slot. A pre-pose photo has no
    // (day, pose) identity to swap within, and inventing one would be wrong.
    if (pose === undefined || dateKey === undefined) fail('vaultReplaceSlotMissing');

    // The new picture carries its own capture time. If it belongs to another
    // day it is a NEW photo for that day, not a swap of this one — filing it
    // here would mean falsifying `takenAt`.
    if (localDateKey(params.takenAt) !== dateKey) fail('vaultReplaceDateMismatch');

    const documentId = progressPhotoDocumentId(dateKey, pose);
    const { vaultKey, vaultKeyVersion } = await requireVaultKey();

    // ── 1. New ciphertext first. The old photo is untouched throughout. ──
    const assets = await uploadNewAssets({
      uid,
      sourceUri: params.sourceUri,
      width: params.width,
      height: params.height,
      vaultKey,
      vaultKeyVersion,
      onProgress: params.onProgress,
    });

    // The new ciphertext is sealed and the plaintext is gone. From here on the
    // swap only moves opaque bytes and metadata, so the gate is identity — the
    // same policy the local-first sync path follows (see `requireSignedInUser`).
    //
    // This used to re-require the SESSION, which made a replace the one
    // operation a screen lock could abort halfway: create never re-checked,
    // replace did. The divergence was not a deliberate difference in risk, and
    // the safer-looking side was the worse one — aborting here rolls back a
    // swap the user explicitly confirmed, while the rollback itself is what
    // touches their existing photo.
    requireSignedInUser(uid);

    // ── 2. Remove the old metadata, but only if the slot still holds the
    // asset this replacement was built against. Another device may have
    // replaced it meanwhile, and overwriting that would destroy their photo.
    // The transaction covers metadata only; no Storage call happens inside.
    let previousBody: Record<string, unknown> | null = null;
    try {
      previousBody = await runTransaction(db, async (tx) => {
        const snapshot = await tx.get(photoDoc(uid, documentId));
        if (!snapshot.exists()) throw new PhotoVaultError('vaultReplaceSlotMissing');
        const data = snapshot.data() as { assetId?: unknown };
        if (data.assetId !== expectedAssetId) {
          throw new PhotoVaultError('vaultReplaceSlotChanged');
        }
        tx.delete(photoDoc(uid, documentId));
        return data as Record<string, unknown>;
      });
    } catch (error) {
      // The old photo is still the authority; take the new objects back out.
      const rolledBack = await assets.rollback();
      if (!rolledBack.ok) {
        logPhotoVaultIssue(
          SCOPE,
          isPhotoVaultError(error) ? error.issue : 'vaultDeleteFailed',
          sanitizedErrorCode(error),
        );
        fail('vaultUploadRollbackFailed', rolledBack.reason);
      }
      if (isPhotoVaultError(error)) throw error;
      fail('vaultDeleteFailed', error);
    }

    // ── 3. Claim the slot again with the new asset. ──
    try {
      await timed('upload.firestore', () =>
        setDoc(
          photoDoc(uid, documentId),
          photoDocumentBody({
            assets,
            takenAt: params.takenAt,
            originalMimeType: params.originalMimeType,
            pose,
            dateKey,
          }),
        ),
      );
    } catch (error) {
      // The delicate window: the old metadata is gone and the new one did not
      // land. Put the original back so the user keeps their photo.
      //
      // `createdAt` is re-stamped by the rules (`== request.time`), so the
      // restored document has a new creation time. That is metadata drift, and
      // it is the acceptable price for not losing a photo.
      const restored = await restorePreviousMetadata(uid, documentId, previousBody!);
      if (restored) {
        const rolledBack = await assets.rollback();
        if (!rolledBack.ok) {
          logPhotoVaultIssue(SCOPE, 'vaultMetadataCreateFailed', sanitizedErrorCode(error));
          fail('vaultUploadRollbackFailed', rolledBack.reason);
        }
        fail('vaultMetadataCreateFailed', error);
      }
      // Restoration failed too. Deliberately keep BOTH ciphertexts: the old
      // one is the user's photo and the new one may still be committed by a
      // retry. The conservative orphan sweep reclaims whichever loses.
      fail('vaultReplaceRestoreFailed', error);
    }

    // ── 4. The new photo is now the authority. The old objects are safe to
    // drop, and a failure here costs nothing: they are unreferenced, so the
    // orphan sweep reclaims them after its grace period.
    removeCachedThumbnail(uid, expectedAssetId);
    removeCachedFull(uid, expectedAssetId);
    removeLockedPreviewDerivative(uid, expectedAssetId);
    void discardReplacedAssets(uid, expectedAssetId, current.thumbnailStoragePath !== undefined);

    return {
      photoId: documentId,
      assetId: assets.assetId,
      pose,
      dateKey,
      storagePath: assets.storagePath,
      thumbnailStoragePath: assets.thumbnailStoragePath,
      takenAt: params.takenAt,
      createdAt: null,
      originalMimeType: params.originalMimeType,
      encryptedSize: assets.encryptedSize,
      thumbnailEncryptedSize: assets.thumbnailEncryptedSize,
      encryption: assets.encryption,
      thumbnailEncryption: assets.thumbnailEncryption,
    };
  } catch (error) {
    if (error instanceof PhotoVaultError) throw error;
    return fail('vaultUploadFailed', error);
  } finally {
    finishTotal();
  }
}

/**
 * Rewrites the document that was just removed.
 *
 * Only the fields the rules accept are re-sent, and `createdAt` is re-stamped
 * by the server. Returns whether the photo is addressable again.
 */
async function restorePreviousMetadata(
  uid: string,
  documentId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { createdAt: _stale, ...rest } = body;
    await setDoc(photoDoc(uid, documentId), { ...rest, createdAt: serverTimestamp() });
    return true;
  } catch (error) {
    logPhotoVaultIssue(SCOPE, 'vaultReplaceRestoreFailed', sanitizedErrorCode(error));
    return false;
  }
}

/**
 * Removes the ciphertext the replacement superseded.
 *
 * Best effort by design: the new photo is already the authority, so undoing it
 * because a stale object lingered would be worse than leaving an orphan the
 * scheduled sweep will collect.
 */
async function discardReplacedAssets(
  uid: string,
  assetId: string,
  hadThumbnail: boolean,
): Promise<void> {
  const targets = [ref(storage, storagePathFor(uid, assetId))];
  if (hadThumbnail) targets.push(ref(storage, thumbnailStoragePathFor(uid, assetId)));
  const results = await Promise.allSettled(targets.map((target) => deleteObject(target)));
  const failed = results.some(
    (result) => result.status === 'rejected' && !isObjectNotFound(result.reason),
  );
  if (failed) logPhotoVaultIssue(SCOPE, 'vaultDeleteFailed');
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
  // Every authenticated listing is authoritative and repairs a stale local
  // hint in either direction. No metadata leaves this function.
  await reconcilePhotoVaultContentPresence(uid, photos.length > 0);
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
    const assetIds = photos.map((photo) => photo.assetId);
    // Both namespaces are keyed by asset and both go stale the same way, so
    // one listing settles both rather than leaving fulls to accumulate until
    // their byte ceiling happens to notice.
    return reconcileCachedThumbnails(uid, assetIds) + reconcileCachedFulls(uid, assetIds);
  } catch {
    return 0;
  }
}

async function resolvePhoto(uid: string, photoOrId: ProgressPhoto | string): Promise<ProgressPhoto> {
  if (typeof photoOrId !== 'string') {
    // Re-derive every target path. Even a forged object cannot escape this uid.
    if (
      photoOrId.storagePath !== storagePathFor(uid, photoOrId.assetId) ||
      (photoOrId.thumbnailStoragePath !== undefined &&
        photoOrId.thumbnailStoragePath !== thumbnailStoragePathFor(uid, photoOrId.assetId))
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
 * Full-image pipeline.
 *
 * The PLAINTEXT half is deliberately unchanged: a full is still decrypted to a
 * short-lived file under `<cache>/photo-vault/tmp` and is still destroyed by
 * the lock. What changed is the CIPHERTEXT half — the envelope is now kept in
 * the same kind of on-device cache the thumbnails have used all along:
 *
 *   local `.full.enc` → decrypt            (no network at all)
 *   Storage `getBytes` → cache it → decrypt (network once)
 *
 * That is what makes a relock cheap rather than free-of-charge-once: the
 * plaintext is destroyed exactly as before, but reopening the photo afterwards
 * no longer pays for the download a second time. The cache holds ciphertext
 * only and is worthless without the Vault Key, which is why it is allowed to
 * outlive the lock that destroys every decrypted representation.
 */
async function downloadAsset(
  photo: ProgressPhoto,
  uid: string,
  kind: DownloadAssetKind,
): Promise<{ uri: string; size: number; photo: ProgressPhoto; isFullImage: true }> {
  const encryption = photo.encryption;
  const expectedSize = photo.encryptedSize;
  const objectPath = storagePathFor(uid, photo.assetId);
  const prefix = kind === 'legacy-full' ? 'gallery.legacy-full' : 'viewer.full';
  const { vaultKey, vaultKeyVersion } = await requireVaultKey();
  if (encryption.vaultKeyVersion !== vaultKeyVersion) fail('vaultDownloadIntegrityFailed');

  // Captured before any await. A logout or account switch bumps this, and the
  // cache refuses a write carrying the stale value.
  const epoch = currentPhotoVaultCacheEpoch();

  let bytes: Uint8Array | null = null;

  const cached = await timed(`${prefix}.cache-read` as PhotoVaultPerfStage, () =>
    readCachedFull({ uid, photoId: photo.assetId, expectedSize }),
  );
  if (cached) {
    try {
      // The same scrutiny the network path gets. Trusting local bytes more
      // would make the cache the weak link.
      validateEncryptedAsset(cached, encryption, expectedSize);
      bytes = cached;
      recordPhotoVaultCacheEvent('viewer.fullCipherCache.hit', { bytes: cached.length });
    } catch {
      // These local bytes cannot be trusted. Drop them and fall through to
      // exactly one network attempt — never a retry loop.
      removeCachedFull(uid, photo.assetId);
      recordPhotoVaultCacheEvent('viewer.fullCipherCache.corrupt');
    }
  }

  if (bytes === null) {
    recordPhotoVaultCacheEvent('viewer.fullCipherCache.miss');
    let downloaded: Uint8Array;
    try {
      downloaded = await timed(`${prefix}.download` as PhotoVaultPerfStage, async () => {
        const buffer = await getBytes(ref(storage, objectPath), MAX_ENCRYPTED_BYTES);
        return new Uint8Array(buffer);
      });
    } catch (error) {
      fail('vaultDownloadFailed', error);
    }
    validateEncryptedAsset(downloaded, encryption, expectedSize);

    // Stored before decrypting, so the cache write is never between the bytes
    // and the pixels. A refused or failed write only costs a re-download.
    const finishWrite = startPhotoVaultPerf(`${prefix}.cache-write` as PhotoVaultPerfStage);
    writeCachedFull({ uid, photoId: photo.assetId, bytes: downloaded, epoch });
    finishWrite();
    bytes = downloaded;
  }

  const { uri: encryptedUri } = writeEncryptedFile(bytes);
  try {
    const plaintext = await timed(`${prefix}.decrypt` as PhotoVaultPerfStage, () =>
      decryptPhotoFile({
        encryptedUri,
        vaultKeyBase64: vaultKey,
        extension: photo.originalMimeType === 'image/png' ? '.png' : '.jpg',
      }),
    );
    // Opportunistic backfill for a photo saved before this feature existed:
    // never a new decrypt of its own, only reused from the full plaintext
    // that legitimately exists right here for the viewer/legacy-grid render.
    if (!hasLockedPreviewDerivative(uid, photo.assetId)) {
      await cacheLockedPreviewDerivative(
        uid,
        photo.assetId,
        plaintext.uri,
        currentPhotoVaultLockedPreviewEpoch(),
      );
    }
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
    readCachedThumbnail({ uid, photoId: photo.assetId, expectedSize }),
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
      removeCachedThumbnail(uid, photo.assetId);
    }
  }

  recordPhotoVaultCacheOutcome('miss');

  let bytes: Uint8Array;
  try {
    bytes = await timed('gallery.thumbnail.download', async () => {
      const buffer = await getBytes(
        ref(storage, thumbnailStoragePathFor(uid, photo.assetId)),
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
  writeCachedThumbnail({ uid, photoId: photo.assetId, bytes, epoch });
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
    removeCachedThumbnail(uid, photo.assetId);
    removeCachedFull(uid, photo.assetId);
    removeLockedPreviewDerivative(uid, photo.assetId);
    const deletions: Promise<void>[] = [
      deleteStorageObject(ref(storage, storagePathFor(uid, photo.assetId)), 'delete.full.storage'),
    ];
    if (photo.thumbnailStoragePath) {
      deletions.push(
        deleteStorageObject(
          ref(storage, thumbnailStoragePathFor(uid, photo.assetId)),
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
