import {
  isProgressPhotoPose,
  isValidDateKey,
  isVaultUuid,
  progressPhotoDocumentId,
  type ProgressPhotoPose,
} from './photoVaultIdentity';
import type { PhotoVaultIssue } from './photoVaultErrors';

/**
 * One pending photo upload, as it survives a restart.
 *
 * Pure domain: no filesystem, no Firebase, no AsyncStorage, no React. The
 * record defined here is what `services/photoVaultUploadQueueStore` persists
 * and what `services/photoVaultUploadQueue` drives to completion, so the rules
 * about what a job *is* can be exercised without any of that machinery.
 *
 * WHAT A JOB IS FOR
 *
 * Saving a photo used to be one indivisible act: normalize, encrypt, upload,
 * commit metadata — with the user watching all of it. A job exists so the
 * durable half can finish first and the remote half can finish later, after
 * the sheet has closed and, if need be, after the app has been killed and
 * reopened. By the time a job exists, the user's photo is already sealed and
 * on disk; the job only records what still has to happen to it remotely.
 *
 * WHAT A JOB DELIBERATELY DOES NOT CARRY
 *
 *   - the vault key, or anything derived from it;
 *   - plaintext, or a path to any;
 *   - a temporary URI of any kind;
 *   - an auth token.
 *
 * It also stores no absolute file paths at all. The durable blobs are
 * addressed by `(uid, assetId)` and their location is re-derived on use — iOS
 * moves an app's container between launches and restores, so a path captured
 * today is not guaranteed to resolve tomorrow. `iv` IS stored: it is not
 * secret (it is framed inside the ciphertext and mirrored in the Firestore
 * metadata), and keeping it is what lets the metadata be committed later
 * without ever decrypting anything.
 */

/**
 * Bumped whenever this record's shape changes incompatibly. A stored job whose
 * version is not this one is discarded rather than guessed at — the blobs it
 * points to are swept as orphans, which costs one unsent photo instead of
 * risking a malformed write built from a record we do not understand.
 */
export const PHOTO_VAULT_UPLOAD_JOB_VERSION = 1;

/**
 * How far a job has got REMOTELY. Local preparation is already finished by the
 * time any of these apply — a job that has not been prepared does not exist.
 *
 *   pending-upload    Storage does not hold both objects yet.
 *   storage-complete  Both objects are in Storage; Firestore has no document.
 *   metadata-complete The Firestore document exists; only the local content
 *                     hint is still unconfirmed.
 *   synced            Everything landed. A job never rests here — reaching it
 *                     is what removes the job and its blobs from the device.
 *
 * The distinction between the first two is not bookkeeping. The Storage rules
 * require `resource == null` to create an object, so re-uploading one that
 * already landed is REFUSED, not overwritten. A resumed job must therefore
 * know which objects it has already placed and continue from there.
 */
export type PhotoVaultUploadStage =
  | 'pending-upload'
  | 'storage-complete'
  | 'metadata-complete'
  | 'synced';

/** What the worker is doing with this job right now. */
export type PhotoVaultUploadState = 'pending' | 'uploading' | 'failed';

/** Structurally identical to `ProgressPhotoEncryption`, restated to keep this module service-free. */
export interface PhotoVaultJobEncryption {
  version: number;
  algorithm: string;
  iv: string;
  vaultKeyVersion: number;
}

export interface PhotoVaultUploadJob {
  version: number;
  /** Stable across every retry and restart; never reused. */
  jobId: string;
  uid: string;
  /** Names both ciphertexts. The durable paths are derived from this. */
  assetId: string;
  /** `{dateKey}_{pose}` for a posed photo, the assetId for a pre-pose one. */
  documentId: string;
  pose?: ProgressPhotoPose;
  dateKey?: string;
  /** Epoch ms. Restored to a `Date` only when the metadata is written. */
  takenAt: number;
  originalMimeType: string;
  encryptedSize: number;
  thumbnailEncryptedSize: number;
  encryption: PhotoVaultJobEncryption;
  thumbnailEncryption: PhotoVaultJobEncryption;
  stage: PhotoVaultUploadStage;
  state: PhotoVaultUploadState;
  /** Per-object checkpoints inside `pending-upload`. */
  uploadedFull: boolean;
  uploadedThumbnail: boolean;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms before which the worker must leave this job alone. */
  nextAttemptAt: number;
  lastIssue?: PhotoVaultIssue;
}

/** First backoff step. Short enough to ride out a tunnel, long enough not to spin. */
export const RETRY_BASE_MS = 15_000;
/** Ceiling, so a long outage settles into an occasional retry rather than a loop. */
export const RETRY_MAX_MS = 10 * 60_000;
/**
 * A job nobody could sync for this long is abandoned.
 *
 * Generous on purpose: reaching it means the account was signed out or offline
 * for a month, and the encrypted blob is still the user's photo. Disk is the
 * cheaper thing to spend.
 */
export const JOB_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Exponential, capped, and never zero — attempt 1 already waits `RETRY_BASE_MS`. */
export function retryDelayMs(attempts: number): number {
  const step = Math.max(1, Math.floor(attempts));
  return Math.min(RETRY_BASE_MS * 2 ** (step - 1), RETRY_MAX_MS);
}

function isEncryption(value: unknown): value is PhotoVaultJobEncryption {
  const e = value as Record<string, unknown> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.version === 'number' &&
    Number.isInteger(e.version) &&
    typeof e.algorithm === 'string' &&
    e.algorithm.length > 0 &&
    typeof e.iv === 'string' &&
    e.iv.length > 0 &&
    typeof e.vaultKeyVersion === 'number' &&
    Number.isInteger(e.vaultKeyVersion) &&
    e.vaultKeyVersion >= 1
  );
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const STAGES: readonly PhotoVaultUploadStage[] = [
  'pending-upload',
  'storage-complete',
  'metadata-complete',
  'synced',
];
const STATES: readonly PhotoVaultUploadState[] = ['pending', 'uploading', 'failed'];

/**
 * Strictly validates one stored record.
 *
 * Fail-closed and shape-complete, in the same spirit as `parseStoredPhoto`: a
 * job drives writes to Storage and Firestore, so a record we cannot fully
 * account for is discarded rather than partially trusted. The checks that
 * matter most are the identity ones — `assetId` becomes a file name and a
 * Storage path, and `documentId` becomes a Firestore path segment.
 */
export function isPhotoVaultUploadJob(value: unknown): value is PhotoVaultUploadJob {
  const job = value as Record<string, unknown> | null;
  if (typeof job !== 'object' || job === null) return false;
  if (job.version !== PHOTO_VAULT_UPLOAD_JOB_VERSION) return false;

  if (typeof job.jobId !== 'string' || job.jobId.length === 0) return false;
  if (typeof job.uid !== 'string' || job.uid.length === 0 || job.uid.length > 128) return false;
  // The asset names a file and a Storage object; anything but a UUID would let
  // a stored string decide a path.
  if (!isVaultUuid(job.assetId)) return false;

  const posedFields = Number('pose' in job) + Number('dateKey' in job);
  if (posedFields !== 0 && posedFields !== 2) return false;
  if (posedFields === 2) {
    if (!isProgressPhotoPose(job.pose) || !isValidDateKey(job.dateKey)) return false;
    // The document id IS the (day, pose) pair; a disagreement means the record
    // and its address describe different photos.
    if (job.documentId !== progressPhotoDocumentId(job.dateKey, job.pose)) return false;
  } else if (job.documentId !== job.assetId) {
    // A pre-pose photo is filed under its own asset id and nothing else.
    return false;
  }

  if (!isEpoch(job.takenAt)) return false;
  if (typeof job.originalMimeType !== 'string' || job.originalMimeType.length === 0) return false;
  if (!isPositiveInt(job.encryptedSize)) return false;
  if (!isPositiveInt(job.thumbnailEncryptedSize)) return false;
  if (!isEncryption(job.encryption) || !isEncryption(job.thumbnailEncryption)) return false;
  // Nonce reuse under one key is the one crypto mistake that cannot be
  // tolerated, and a record claiming it is not one this client wrote.
  if (job.encryption.iv === job.thumbnailEncryption.iv) return false;

  if (!STAGES.includes(job.stage as PhotoVaultUploadStage)) return false;
  if (!STATES.includes(job.state as PhotoVaultUploadState)) return false;
  if (typeof job.uploadedFull !== 'boolean' || typeof job.uploadedThumbnail !== 'boolean') {
    return false;
  }
  // A stage past the uploads must agree with the per-object checkpoints, or a
  // resumed job would skip an object it never actually placed.
  if (job.stage !== 'pending-upload' && !(job.uploadedFull && job.uploadedThumbnail)) {
    return false;
  }

  if (typeof job.attempts !== 'number' || !Number.isInteger(job.attempts) || job.attempts < 0) {
    return false;
  }
  if (!isEpoch(job.createdAt) || !isEpoch(job.updatedAt) || !isEpoch(job.nextAttemptAt)) {
    return false;
  }
  if ('lastIssue' in job && typeof job.lastIssue !== 'string') return false;

  return true;
}

/** Keeps only the records this build understands, in their stored order. */
export function parsePhotoVaultUploadJobs(value: unknown): PhotoVaultUploadJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPhotoVaultUploadJob);
}

export interface NewJobInput {
  jobId: string;
  uid: string;
  assetId: string;
  pose?: ProgressPhotoPose;
  dateKey?: string;
  takenAt: number;
  originalMimeType: string;
  encryptedSize: number;
  thumbnailEncryptedSize: number;
  encryption: PhotoVaultJobEncryption;
  thumbnailEncryption: PhotoVaultJobEncryption;
}

/**
 * Builds a job for content that is ALREADY encrypted and already durable.
 *
 * Nothing here can fail over the network, and nothing here needs the vault
 * key: by this point the only thing left is to tell the backend about bytes
 * that already exist on this device.
 */
export function createPhotoVaultUploadJob(
  input: NewJobInput,
  now: number,
): PhotoVaultUploadJob {
  const posed = input.pose !== undefined && input.dateKey !== undefined;
  return {
    version: PHOTO_VAULT_UPLOAD_JOB_VERSION,
    jobId: input.jobId,
    uid: input.uid,
    assetId: input.assetId,
    documentId: posed
      ? progressPhotoDocumentId(input.dateKey!, input.pose!)
      : input.assetId,
    ...(posed ? { pose: input.pose, dateKey: input.dateKey } : {}),
    takenAt: input.takenAt,
    originalMimeType: input.originalMimeType,
    encryptedSize: input.encryptedSize,
    thumbnailEncryptedSize: input.thumbnailEncryptedSize,
    encryption: input.encryption,
    thumbnailEncryption: input.thumbnailEncryption,
    stage: 'pending-upload',
    state: 'pending',
    uploadedFull: false,
    uploadedThumbnail: false,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    // Due immediately: the app is in the foreground at the moment a job is
    // created, which is the best chance it will get.
    nextAttemptAt: now,
  };
}

export function markJobUploading(job: PhotoVaultUploadJob, now: number): PhotoVaultUploadJob {
  return { ...job, state: 'uploading', updatedAt: now };
}

/**
 * Records that one of the two ciphertexts is now in Storage.
 *
 * The stage only advances once BOTH have landed — a job that uploaded the
 * thumbnail and then lost the network must resume knowing it still owes the
 * full image, and must not re-send the thumbnail the rules would now refuse.
 */
export function markAssetUploaded(
  job: PhotoVaultUploadJob,
  kind: 'full' | 'thumbnail',
  now: number,
): PhotoVaultUploadJob {
  const next: PhotoVaultUploadJob = {
    ...job,
    uploadedFull: kind === 'full' ? true : job.uploadedFull,
    uploadedThumbnail: kind === 'thumbnail' ? true : job.uploadedThumbnail,
    updatedAt: now,
  };
  if (next.uploadedFull && next.uploadedThumbnail && next.stage === 'pending-upload') {
    next.stage = 'storage-complete';
  }
  return next;
}

export function markMetadataWritten(
  job: PhotoVaultUploadJob,
  now: number,
): PhotoVaultUploadJob {
  return {
    ...job,
    // Reaching the document implies both objects are there — the write would
    // not have been attempted otherwise — so the checkpoints are made explicit
    // rather than left to disagree with the stage.
    uploadedFull: true,
    uploadedThumbnail: true,
    stage: 'metadata-complete',
    updatedAt: now,
  };
}

export function markJobSynced(job: PhotoVaultUploadJob, now: number): PhotoVaultUploadJob {
  return {
    ...job,
    uploadedFull: true,
    uploadedThumbnail: true,
    stage: 'synced',
    state: 'pending',
    updatedAt: now,
  };
}

/**
 * Records a failed attempt and schedules the next one.
 *
 * The stage is untouched: whatever the job had already achieved remotely is
 * still achieved, and forgetting it is what would cause a duplicate.
 */
export function markJobFailed(
  job: PhotoVaultUploadJob,
  issue: PhotoVaultIssue,
  now: number,
): PhotoVaultUploadJob {
  const attempts = job.attempts + 1;
  return {
    ...job,
    state: 'failed',
    attempts,
    lastIssue: issue,
    updatedAt: now,
    nextAttemptAt: now + retryDelayMs(attempts),
  };
}

/** Whether the worker may pick this job up now. */
export function isJobDue(job: PhotoVaultUploadJob, now: number): boolean {
  return job.state !== 'uploading' && job.nextAttemptAt <= now;
}

export function isJobExpired(job: PhotoVaultUploadJob, now: number): boolean {
  return now - job.createdAt > JOB_MAX_AGE_MS;
}

/**
 * When the worker should next wake, or null if there is nothing to wait for.
 *
 * Returns 0 when something is already due. Used to arm a single timer instead
 * of polling: the queue sleeps until its earliest deadline and no longer.
 */
export function nextWakeDelayMs(
  jobs: readonly PhotoVaultUploadJob[],
  now: number,
): number | null {
  const waiting = jobs.filter((job) => job.state !== 'uploading');
  if (waiting.length === 0) return null;
  const earliest = Math.min(...waiting.map((job) => job.nextAttemptAt));
  return Math.max(0, earliest - now);
}

/**
 * Whether a retry must first ask the backend what it already has.
 *
 * A first attempt cannot have placed anything, so it goes straight to work. A
 * later one might have been killed between a successful upload and persisting
 * the checkpoint that records it, and the Storage rules turn that invisible
 * success into a refusal on retry — so from the second attempt onwards the
 * worker probes before it writes.
 */
export function shouldProbeRemoteState(job: PhotoVaultUploadJob): boolean {
  return job.attempts > 0;
}
