import AsyncStorage from '@react-native-async-storage/async-storage';

import { logError } from '../lib/logger';
import {
  parsePhotoVaultUploadJobs,
  type PhotoVaultUploadJob,
} from '../lib/photoVaultUploadJob';

/**
 * Persistence for the pending-upload queue.
 *
 * WHY ASYNCSTORAGE
 *
 * The project already persists small structured records this way
 * (`pendingUnitsSync`, `pendingLanguageSync`, the vault's own content-presence
 * hint), and the queue is the same kind of thing: a handful of entries, read
 * whole, written whole. SQLite would be a new dependency and a new failure
 * mode for a list that holds three items on a busy day. The photo BYTES are
 * not here — they are files in `photoVaultDurableStore`; this is only the
 * index that says what those files are still owed.
 *
 * WHY ONE KEY RATHER THAN ONE PER JOB
 *
 * The queue is always read in full (the worker needs to pick the earliest due
 * job) and the set is tiny, so a single document keeps every mutation atomic
 * from the reader's point of view. There is no partial-write state in which a
 * job exists half-added.
 *
 * WRITE ORDERING
 *
 * Three poses finish preparing at almost the same instant and all three append
 * to this key. A naive read-modify-write would lose two of them. Every
 * mutation therefore goes through `mutateJobs`, which chains onto the previous
 * write exactly as `photoVaultContentPresence` does — so appends serialize
 * instead of racing, and the last writer never clobbers the other two.
 *
 * WHAT IS STORED: metadata only. No key material, no plaintext, no temporary
 * URI, no token, no absolute path — see `lib/photoVaultUploadJob`.
 */

const STORAGE_KEY = 'ajfit-photo-vault-upload-queue-v1';

type QueueListener = (jobs: PhotoVaultUploadJob[]) => void;

const listeners = new Set<QueueListener>();

/**
 * The queue as last read or written.
 *
 * A cache, not the authority — but it is what makes a mutation a pure function
 * of a known state rather than of a re-read that a concurrent write may have
 * already changed. `null` means "not loaded yet"; the first access hydrates it.
 */
let cached: PhotoVaultUploadJob[] | null = null;
/** Serializes mutations so concurrent appends cannot overwrite one another. */
let writeChain: Promise<void> = Promise.resolve();

export function subscribeToPhotoVaultUploadQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(jobs: PhotoVaultUploadJob[]): void {
  for (const listener of listeners) listener(jobs);
}

/**
 * Every stored job, newest state first read from disk.
 *
 * Malformed or unknown-version records are dropped by the parser rather than
 * repaired. Their blobs become unclaimed and the durable store's
 * reconciliation reclaims them, which is the correct outcome: a record this
 * build cannot understand must not be used to write to Firestore.
 */
export async function readPhotoVaultUploadQueue(): Promise<PhotoVaultUploadJob[]> {
  if (cached !== null) return cached;

  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (error) {
    logError('photoVaultUploadQueue:read', error);
    return [];
  }
  if (raw === null) {
    cached = [];
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable JSON is not something to keep retrying against.
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    cached = [];
    return cached;
  }

  cached = parsePhotoVaultUploadJobs(parsed);
  return cached;
}

async function persist(jobs: PhotoVaultUploadJob[]): Promise<void> {
  try {
    if (jobs.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch (error) {
    // The in-memory queue is still correct and the blobs are still on disk, so
    // the upload can proceed; only its survival across a restart is at risk.
    logError('photoVaultUploadQueue:write', error);
  }
}

/**
 * Applies one transformation to the whole queue, serialized against every other.
 *
 * `transform` must be pure: it may be called only once, but it runs after any
 * earlier mutation has settled, so it always sees the result of those.
 */
export function mutatePhotoVaultUploadQueue(
  transform: (jobs: PhotoVaultUploadJob[]) => PhotoVaultUploadJob[],
): Promise<PhotoVaultUploadJob[]> {
  const run = writeChain.catch(() => undefined).then(async () => {
    const current = await readPhotoVaultUploadQueue();
    const next = transform(current);
    cached = next;
    await persist(next);
    publish(next);
    return next;
  });

  // Chained without the value, so one failed mutation cannot reject the next.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function addPhotoVaultUploadJob(job: PhotoVaultUploadJob): Promise<PhotoVaultUploadJob[]> {
  return mutatePhotoVaultUploadQueue((jobs) => [
    // Replacing by id keeps this idempotent: re-adding a job that already
    // exists must never create a second one claiming the same asset.
    ...jobs.filter((entry) => entry.jobId !== job.jobId),
    job,
  ]);
}

export function updatePhotoVaultUploadJob(
  jobId: string,
  update: (job: PhotoVaultUploadJob) => PhotoVaultUploadJob,
): Promise<PhotoVaultUploadJob[]> {
  return mutatePhotoVaultUploadQueue((jobs) =>
    jobs.map((job) => (job.jobId === jobId ? update(job) : job)),
  );
}

export function removePhotoVaultUploadJob(jobId: string): Promise<PhotoVaultUploadJob[]> {
  return mutatePhotoVaultUploadQueue((jobs) => jobs.filter((job) => job.jobId !== jobId));
}

/** Synchronous read of the last known queue. Empty until the first load. */
export function peekPhotoVaultUploadQueue(): PhotoVaultUploadJob[] {
  return cached ?? [];
}

/** Test seam: forgets the cached queue without touching storage. */
export function resetPhotoVaultUploadQueueCacheForTesting(): void {
  cached = null;
  writeChain = Promise.resolve();
  listeners.clear();
}
