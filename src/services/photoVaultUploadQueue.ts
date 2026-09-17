import { randomUUID } from 'expo-crypto';

import { auth } from '../lib/firebase';
import {
  PhotoVaultError,
  isPhotoVaultError,
  logPhotoVaultIssue,
  type PhotoVaultIssue,
} from '../lib/photoVaultErrors';
import { startPhotoVaultPerf } from '../lib/photoVaultPerformance';
import { startPhotoVaultTrace, tracePhotoVault } from '../lib/photoVaultDevTrace';
import {
  createPhotoVaultUploadJob,
  isJobDue,
  isJobExpired,
  markAssetUploaded,
  markJobFailed,
  markJobSynced,
  markJobUploading,
  markMetadataWritten,
  nextWakeDelayMs,
  shouldProbeRemoteState,
  type PhotoVaultUploadJob,
} from '../lib/photoVaultUploadJob';
import {
  commitPreparedMetadata,
  discardPreparedRemoteState,
  preparedAssetExistsRemotely,
  preparedMetadataState,
  progressPhotoFromJob,
  uploadPreparedAsset,
  type PreparedProgressPhoto,
  type ProgressPhoto,
} from './progressPhotos';
import {
  discardDurableAsset,
  discardDurableAssetsForUser,
  durableAssetIsIntact,
  listDurableUids,
  reconcileDurableAssets,
} from './photoVaultDurableStore';
import { setPhotoVaultContentPresence } from './photoVaultContentPresence';
import {
  addPhotoVaultUploadJob,
  mutatePhotoVaultUploadQueue,
  peekPhotoVaultUploadQueue,
  readPhotoVaultUploadQueue,
  removePhotoVaultUploadJob,
  updatePhotoVaultUploadJob,
} from './photoVaultUploadQueueStore';

/**
 * Drives prepared photos to the backend, whenever that turns out to be possible.
 *
 * WHAT THIS IS NOT
 *
 * Not a background service. Nothing here runs while the process is dead, and
 * no native background task is registered. The model is deliberately the
 * simplest one that never loses a photo:
 *
 *   app active   — a job starts syncing the moment it is created;
 *   app closed   — the job and its ciphertext sit on disk, untouched;
 *   next launch  — cold-start reconciliation validates them and the worker
 *                  resumes where the checkpoints say it was.
 *
 * There is no polling. The worker sleeps on a single timer armed from the
 * earliest job deadline, and is otherwise woken only by real events: a new
 * job, the app returning to the foreground, or the vault being unlocked.
 *
 * WHAT IT NEVER DOES
 *
 * It does not decrypt, it does not read plaintext, and it never asks for the
 * vault key. It moves envelopes that were sealed while the vault was open, so
 * a locked vault does not stop it — see `requireSignedInUser` in
 * `progressPhotos`. The gate it DOES respect is identity: a job is only ever
 * processed for the uid that is signed in right now, which is what keeps a
 * signed-out or switched account's work suspended rather than executed.
 */

const SCOPE = 'photoVault.uploadQueue';

/** Matches the three poses of one save; more lanes would only contend. */
const MAX_CONCURRENT_SYNC_JOBS = 3;

export type PhotoVaultSyncedListener = (photo: ProgressPhoto, job: PhotoVaultUploadJob) => void;
export type PhotoVaultJobDroppedListener = (job: PhotoVaultUploadJob) => void;
export type PhotoVaultJobProgressListener = (jobId: string, progress: number) => void;

const syncedListeners = new Set<PhotoVaultSyncedListener>();
const droppedListeners = new Set<PhotoVaultJobDroppedListener>();
const progressListeners = new Set<PhotoVaultJobProgressListener>();

/** Announces a job that fully landed, so the gallery can swap its card. */
export function subscribeToPhotoVaultUploadSynced(
  listener: PhotoVaultSyncedListener,
): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

/** Announces a job that can never complete, so its card stops claiming it will. */
export function subscribeToPhotoVaultUploadDropped(
  listener: PhotoVaultJobDroppedListener,
): () => void {
  droppedListeners.add(listener);
  return () => droppedListeners.delete(listener);
}

/** In-memory only: transfer progress is never worth a disk write. */
export function subscribeToPhotoVaultUploadProgress(
  listener: PhotoVaultJobProgressListener,
): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

let draining = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
/** Set while a drain is running so a kick during it schedules exactly one more. */
let rerunRequested = false;

function now(): number {
  return Date.now();
}

function issueOf(error: unknown): PhotoVaultIssue {
  return isPhotoVaultError(error) ? error.issue : 'vaultUploadFailed';
}

/**
 * Registers a sealed photo for delivery.
 *
 * Called immediately after `prepareProgressPhotoUpload`, at which point the
 * bytes are already durable — so a failure to persist the job would strand
 * them, and the caller treats that as a save failure rather than a warning.
 */
export async function enqueuePreparedPhoto(
  uid: string,
  prepared: PreparedProgressPhoto,
): Promise<PhotoVaultUploadJob> {
  const job = createPhotoVaultUploadJob(
    {
      jobId: randomUUID(),
      uid,
      assetId: prepared.assetId,
      ...(prepared.pose !== undefined && prepared.dateKey !== undefined
        ? { pose: prepared.pose, dateKey: prepared.dateKey }
        : {}),
      takenAt: prepared.takenAt.getTime(),
      originalMimeType: prepared.originalMimeType,
      encryptedSize: prepared.encryptedSize,
      thumbnailEncryptedSize: prepared.thumbnailEncryptedSize,
      encryption: prepared.encryption,
      thumbnailEncryption: prepared.thumbnailEncryption,
    },
    now(),
  );
  await addPhotoVaultUploadJob(job);
  tracePhotoVault('queue.job.enqueued', { pose: job.pose ?? 'none' });
  return job;
}

/**
 * Asks the worker to run, without waiting for it.
 *
 * Safe to call from anywhere and as often as anything likes: a kick during a
 * drain sets a single rerun flag rather than starting a second worker.
 */
export function kickPhotoVaultUploadQueue(reason: string): void {
  tracePhotoVault('queue.kick', { reason });
  if (draining) {
    rerunRequested = true;
    return;
  }
  void drain();
}

function clearWakeTimer(): void {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
}

/**
 * Arms one timer for the earliest pending deadline.
 *
 * The alternative — checking on an interval — would keep waking a process that
 * has nothing to do, which is exactly what a backoff is supposed to prevent.
 */
function scheduleNextWake(): void {
  clearWakeTimer();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const mine = peekPhotoVaultUploadQueue().filter((job) => job.uid === uid);
  const delay = nextWakeDelayMs(mine, now());
  if (delay === null) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void drain();
  }, delay);
}

/**
 * Removes a job and everything it owns on this device.
 *
 * The remote side is cleaned up only when asked, because the two callers want
 * opposite things: a job that SUCCEEDED must keep what it uploaded, while one
 * the user cancelled must not leave it behind.
 */
async function retireJob(
  job: PhotoVaultUploadJob,
  options: { discardRemote: boolean },
): Promise<void> {
  if (options.discardRemote) {
    try {
      await discardPreparedRemoteState(job.uid, job);
    } catch {
      // An orphan the backend sweep reclaims is not worth failing over.
      logPhotoVaultIssue(SCOPE, 'vaultDeleteFailed');
    }
  }
  await removePhotoVaultUploadJob(job.jobId);
  // Only after the job is gone: a blob deleted while its job still referenced
  // it would leave a record pointing at nothing.
  discardDurableAsset(job.uid, job.assetId);
}

/**
 * Brings the checkpoints back in line with what the backend actually has.
 *
 * Only ever runs on a retry. A first attempt cannot have placed anything, and
 * paying two extra round trips to confirm that would slow down the case that
 * matters most — the one the user is still watching.
 */
async function reconcileCheckpoints(job: PhotoVaultUploadJob): Promise<PhotoVaultUploadJob> {
  if (!shouldProbeRemoteState(job)) return job;

  let current = job;
  if (!current.uploadedFull) {
    const exists = await preparedAssetExistsRemotely(
      current.uid,
      current.assetId,
      'full',
      current.encryptedSize,
    );
    if (exists) current = markAssetUploaded(current, 'full', now());
  }
  if (!current.uploadedThumbnail) {
    const exists = await preparedAssetExistsRemotely(
      current.uid,
      current.assetId,
      'thumbnail',
      current.thumbnailEncryptedSize,
    );
    if (exists) current = markAssetUploaded(current, 'thumbnail', now());
  }

  if (current.stage === 'storage-complete') {
    const state = await preparedMetadataState(current.uid, current);
    if (state === 'ours') current = markMetadataWritten(current, now());
    else if (state === 'foreign') {
      // Another device filled this (day, pose). No retry can resolve that, and
      // overwriting is refused by the rules anyway.
      //
      // A real `PhotoVaultError` and not an ad-hoc object carrying an `issue`
      // field: the classifier below tests the TYPE, so a look-alike would be
      // read as a generic upload failure and retried forever against a slot
      // that will never free up.
      throw new PhotoVaultError('vaultPhotoSlotTaken');
    }
  }

  if (current !== job) {
    tracePhotoVault('queue.job.checkpointsRecovered', {
      stage: current.stage,
      uploadedFull: current.uploadedFull,
      uploadedThumbnail: current.uploadedThumbnail,
    });
    await updatePhotoVaultUploadJob(job.jobId, () => current);
  }
  return current;
}

/**
 * Carries one job as far towards `synced` as it can get right now.
 *
 * Every stage persists its checkpoint BEFORE the next one starts. That
 * ordering is the whole idempotency story: a process killed at any point
 * resumes from the last thing that is known to have happened, and never
 * repeats a write the Storage rules would refuse the second time.
 */
async function processJob(input: PhotoVaultUploadJob): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || uid !== input.uid) return;

  const finishSync = startPhotoVaultPerf('upload.sync.total');
  const finishTrace = startPhotoVaultTrace('queue.sync_started', {
    stage: input.stage,
    attempts: input.attempts,
  });

  // The bytes are the one thing that cannot be reconstructed. A job whose
  // ciphertext is gone can never complete, so it is retired rather than
  // retried forever against a file that will not come back.
  if (!durableAssetIsIntact(uid, input.assetId, input)) {
    logPhotoVaultIssue(SCOPE, 'vaultFileReadFailed');
    finishTrace('queue.sync_completed', { outcome: 'blobsMissing' });
    finishSync();
    await retireJob(input, { discardRemote: true });
    for (const listener of droppedListeners) listener(input);
    return;
  }

  let job = markJobUploading(input, now());
  await updatePhotoVaultUploadJob(job.jobId, () => job);

  try {
    job = await reconcileCheckpoints(job);

    if (job.stage === 'pending-upload' && !job.uploadedFull) {
      await uploadPreparedAsset({
        uid,
        job,
        kind: 'full',
        onProgress: (bytes) => {
          const total = job.encryptedSize + job.thumbnailEncryptedSize;
          if (total > 0) {
            for (const listener of progressListeners) listener(job.jobId, bytes / total);
          }
        },
      });
      job = markAssetUploaded(job, 'full', now());
      await updatePhotoVaultUploadJob(job.jobId, () => job);
    }

    if (job.stage === 'pending-upload' && !job.uploadedThumbnail) {
      await uploadPreparedAsset({ uid, job, kind: 'thumbnail' });
      job = markAssetUploaded(job, 'thumbnail', now());
      await updatePhotoVaultUploadJob(job.jobId, () => job);
    }

    if (job.stage === 'storage-complete') {
      await commitPreparedMetadata(uid, job);
      job = markMetadataWritten(job, now());
      await updatePhotoVaultUploadJob(job.jobId, () => job);
    }

    if (job.stage === 'metadata-complete') {
      // Firestore has confirmed the first durable remote authority, which is
      // the only thing allowed to flip the locked-layout hint.
      await setPhotoVaultContentPresence(uid, true);
      job = markJobSynced(job, now());
      const photo = progressPhotoFromJob(job);
      await retireJob(job, { discardRemote: false });
      for (const listener of syncedListeners) listener(photo, job);
      finishTrace('queue.sync_completed', { outcome: 'synced' });
    }
  } catch (error) {
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    finishTrace('queue.sync_completed', { outcome: 'failed', issue });

    if (issue === 'vaultPhotoSlotTaken') {
      // Terminal: the slot belongs to another photo and always will. Keeping
      // the job would retry a write that is refused by definition.
      await retireJob(job, { discardRemote: true });
      for (const listener of droppedListeners) listener(job);
      return;
    }

    const failed = markJobFailed(job, issue, now());
    await updatePhotoVaultUploadJob(job.jobId, () => failed);
  } finally {
    finishSync();
  }
}

async function drain(): Promise<void> {
  if (draining) {
    rerunRequested = true;
    return;
  }
  draining = true;
  clearWakeTimer();

  try {
    do {
      rerunRequested = false;
      const uid = auth.currentUser?.uid;
      // Signed out, or between identities: the queue suspends rather than
      // running someone else's work. Nothing is discarded here.
      if (!uid) break;

      const jobs = await readPhotoVaultUploadQueue();
      const due = jobs
        .filter((job) => job.uid === uid && job.stage !== 'synced' && isJobDue(job, now()))
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, MAX_CONCURRENT_SYNC_JOBS);
      if (due.length === 0) break;

      // The three poses of one save travel together, exactly as they were
      // prepared. `allSettled` because one failing pose must not strand the
      // other two mid-drain.
      await Promise.allSettled(due.map((job) => processJob(job)));
    } while (rerunRequested || hasDueWork());
  } catch (error) {
    logPhotoVaultIssue(SCOPE, issueOf(error));
  } finally {
    draining = false;
    scheduleNextWake();
  }
}

function hasDueWork(): boolean {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  return peekPhotoVaultUploadQueue().some(
    (job) => job.uid === uid && job.stage !== 'synced' && isJobDue(job, now()),
  );
}

/**
 * Cancels one job on the user's behalf, e.g. deleting a photo that never synced.
 *
 * Removes the remote fragments too: unlike a completed job, nothing should
 * survive this.
 */
export async function cancelPhotoVaultUploadJob(jobId: string): Promise<boolean> {
  const jobs = await readPhotoVaultUploadQueue();
  const job = jobs.find((entry) => entry.jobId === jobId);
  if (!job) return false;
  await retireJob(job, { discardRemote: true });
  tracePhotoVault('queue.job.cancelled', { stage: job.stage });
  return true;
}

/**
 * Jobs still owed for the user who is signed in right now.
 *
 * Scoped here rather than by the caller so no surface has to know how to ask
 * that question correctly — a gallery that filtered by uid itself would be one
 * more place that could get cross-account isolation wrong.
 */
export async function listPendingPhotoVaultJobs(): Promise<PhotoVaultUploadJob[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const jobs = await readPhotoVaultUploadQueue();
  return jobs.filter((job) => job.uid === uid && job.stage !== 'synced');
}

/** Clears any backoff so a user-initiated retry is attempted right away. */
export async function retryPhotoVaultUploadJob(jobId: string): Promise<void> {
  await updatePhotoVaultUploadJob(jobId, (job) => ({
    ...job,
    state: 'pending',
    nextAttemptAt: now(),
  }));
  kickPhotoVaultUploadQueue('manual-retry');
}

export interface QueueReconciliation {
  jobs: number;
  droppedJobs: number;
  reclaimedAssets: number;
}

/**
 * Cold-start reconciliation between the manifest and the bytes on disk.
 *
 * Runs before anything can be shown and without any vault session, because it
 * looks at ciphertext and record-keeping only. Its bias is deliberate and
 * one-directional: a job is dropped only when it is PROVEN unusable — its
 * blobs are missing or truncated, or it has been unsendable for a month — and
 * a blob is deleted only when no surviving job names it. Anything ambiguous is
 * kept, because the cost of keeping it is disk and the cost of dropping it is
 * a photo the user believed was saved.
 */
export async function reconcilePhotoVaultUploadQueue(): Promise<QueueReconciliation> {
  const finishTrace = startPhotoVaultTrace('queue.reconcile.start');
  const stored = await readPhotoVaultUploadQueue();
  const timestamp = now();

  const survivors: PhotoVaultUploadJob[] = [];
  const dropped: PhotoVaultUploadJob[] = [];
  for (const job of stored) {
    if (isJobExpired(job, timestamp)) {
      dropped.push(job);
      continue;
    }
    if (!durableAssetIsIntact(job.uid, job.assetId, job)) {
      dropped.push(job);
      continue;
    }
    survivors.push(
      // A job recorded as `uploading` was interrupted by whatever ended the
      // last process. It is pending again, and its attempt count is untouched
      // so an interrupted run still counts towards the probe threshold.
      job.state === 'uploading' ? { ...job, state: 'pending' } : job,
    );
  }

  if (dropped.length > 0) {
    await mutatePhotoVaultUploadQueue(() => survivors);
    for (const job of dropped) discardDurableAsset(job.uid, job.assetId);
  } else if (survivors.some((job, index) => job !== stored[index])) {
    await mutatePhotoVaultUploadQueue(() => survivors);
  }

  // Blobs nothing claims any more: a job removed by a crash-interrupted
  // retire, or one this build's parser rejected.
  let reclaimed = 0;
  for (const uid of listDurableUids()) {
    reclaimed += reconcileDurableAssets(
      uid,
      survivors.filter((job) => job.uid === uid).map((job) => job.assetId),
    );
  }

  finishTrace('queue.reconcile.result', {
    jobs: survivors.length,
    dropped: dropped.length,
    reclaimed,
  });
  return { jobs: survivors.length, droppedJobs: dropped.length, reclaimedAssets: reclaimed };
}

/**
 * Suspends the worker and drops everything belonging to other identities.
 *
 * Called on every identity change. Expressed as "keep only this uid" rather
 * than "remove the previous uid", exactly like the encrypted thumbnail cache,
 * so it stays correct without tracking who was signed in before — including a
 * logout (`null` keeps nothing) and namespaces left by an account this install
 * never saw sign in.
 *
 * A LOGOUT KEEPS THE SIGNED-OUT USER'S JOBS. The worker refuses to run without
 * a matching signed-in uid, so they are already suspended; deleting them would
 * destroy a photo the user was told had been saved, and they resume intact if
 * that account signs back in. Only `purgePhotoVaultUploadsForUser` — account
 * deletion — actually removes them.
 */
export async function isolatePhotoVaultUploadsFor(uid: string | null): Promise<void> {
  clearWakeTimer();
  if (uid === null) {
    tracePhotoVault('queue.suspended', { reason: 'signed-out' });
    return;
  }
  kickPhotoVaultUploadQueue('identity-change');
}

/**
 * Removes every trace of one account's pending uploads.
 *
 * For account deletion, where the user has asked for exactly that. The remote
 * side is handled by the backend's own teardown, so this only has to make sure
 * no ciphertext outlives the account on this device.
 */
export async function purgePhotoVaultUploadsForUser(uid: string): Promise<void> {
  clearWakeTimer();
  await mutatePhotoVaultUploadQueue((jobs) => jobs.filter((job) => job.uid !== uid));
  discardDurableAssetsForUser(uid);
  tracePhotoVault('queue.purged');
}

/** Test seam: stops the timer and forgets every listener. */
export function resetPhotoVaultUploadQueueForTesting(): void {
  clearWakeTimer();
  draining = false;
  rerunRequested = false;
  syncedListeners.clear();
  droppedListeners.clear();
  progressListeners.clear();
}
