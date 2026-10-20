import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import { subscribeToPhotoVaultStatus } from './photoVaultLock';
import { recordPhotoVaultCacheEvent, startPhotoVaultPerf } from './photoVaultPerformance';
import {
  deleteProgressPhoto,
  downloadProgressPhoto,
  downloadProgressPhotoThumbnail,
  listProgressPhotos,
  prepareProgressPhotoUpload,
  reconcileProgressPhotoCache,
  replaceProgressPhoto,
  type ProgressPhoto,
  type ProgressPhotoMimeType,
} from '../services/progressPhotos';
import {
  cancelPhotoVaultUploadJob,
  enqueuePreparedPhoto,
  kickPhotoVaultUploadQueue,
  listPendingPhotoVaultJobs,
  retryPhotoVaultUploadJob,
  subscribeToPhotoVaultUploadDropped,
  subscribeToPhotoVaultUploadProgress,
  subscribeToPhotoVaultUploadSynced,
} from '../services/photoVaultUploadQueue';
import { subscribeToPhotoVaultUploadQueue } from '../services/photoVaultUploadQueueStore';
import { discardDecryptedPhoto } from '../services/photoVaultFileCrypto';
import { localDateKey, type ProgressPhotoPose } from './photoVaultIdentity';
import {
  notePhotoVaultUploadSettled,
  notePhotoVaultUploadStarted,
  startPhotoVaultTrace,
  tracePhotoVault,
} from './photoVaultDevTrace';

/**
 * Session-only private gallery controller.
 *
 * Two kinds of value flow through the LRU maps below, and the difference
 * matters:
 *
 *   - thumbnails are `data:image/jpeg;base64,…` strings that exist ONLY in
 *     this process. Dropping the reference is the whole cleanup; there is no
 *     file behind them.
 *   - fulls (and the legacy full fallback) are `file://` URIs into
 *     `<cache>/photo-vault/tmp`, and dropping them must also delete the file.
 *
 * `releasePlaintext` below is the single point that tells them apart, so no
 * call site has to remember which kind it is holding.
 *
 * Neither kind is a durable cache. Lock, logout and user switch remove every
 * URI from React state and then delete every owned file. The encrypted
 * `.thumb.enc` and `.full.enc` caches are deliberately NOT touched by any of
 * that: they are ciphertext, and re-downloading them after every lock was the
 * problem those caches exist to remove.
 *
 * So the two layers answer different questions, and both are needed:
 *
 *   this module's LRU   "is it still decrypted?" — free, dies with the lock.
 *   the ciphertext cache "must we pay the network?" — survives the lock.
 *
 * A relock therefore costs a decrypt, never a download.
 */

/** Plaintext that lives only in memory; there is no file to delete. */
function isInMemoryUri(uri: string): boolean {
  return uri.startsWith('data:');
}

/**
 * Releases one plaintext representation.
 *
 * The single place that decides which kind of cleanup a URI needs. An
 * in-memory data URI is released by the caller dropping its reference, and
 * must never be handed to the filesystem layer: it is decrypted image data,
 * and passing it to a path-based API is both pointless and the wrong shape of
 * thing to do with plaintext.
 */
function releasePlaintext(uri: string): void {
  if (isInMemoryUri(uri)) return;
  discardDecryptedPhoto(uri);
}

export interface GalleryPhoto {
  /** Firestore document id. `{dateKey}_{pose}` once posed, a UUID before. */
  photoId: string;
  /**
   * Opaque UUID addressing this photo's ciphertext. Null only while an
   * optimistic upload has not produced remote metadata yet.
   */
  assetId: string | null;
  /** Present once the photo carries a pose; absent on pre-pose photos. */
  pose?: ProgressPhotoPose;
  /** Local calendar day frozen at creation; absent on pre-pose photos. */
  dateKey?: string;
  takenAt: Date;
  metadata: ProgressPhoto | null;
  thumbnailUri: string | null;
  fullUri: string | null;
  /** Local normalized image shown only while a new upload settles. */
  previewUri: string | null;
  thumbnailLoading: boolean;
  fullLoading: boolean;
  failed: boolean;
  /**
   * Where this photo is in the save pipeline, or null once it is simply a
   * photo.
   *
   *   preparing  being normalized, sealed and written to durable storage. The
   *              only state the user actually waits on.
   *   uploading  durable on this device, still owed to the backend.
   *   failed     durable on this device; the last delivery attempt failed and
   *              a retry is scheduled. NEVER means the photo was lost.
   *
   * The distinction matters for what the UI may promise: `preparing` can still
   * fail in a way that loses the photo, `uploading` and `failed` cannot.
   */
  uploadStatus: 'preparing' | 'uploading' | 'failed' | null;
  uploadProgress: number | null;
  /** The durable job still owing this card's remote copy, if any. */
  jobId: string | null;
}

export interface GalleryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  photos: GalleryPhoto[];
  uploading: boolean;
  deletingId: string | null;
  issue: PhotoVaultIssue | null;
}

/**
 * One mounted thumbnail surface in one gallery generation.
 *
 * The opaque numeric key lets cleanup prove which acquire it balances. The
 * generation prevents a React cleanup from an old locked/reset tree from
 * decrementing a new session that happens to render the same photo id.
 */
export interface GalleryThumbnailOwner {
  readonly ownerKey: number;
  readonly generation: number;
  readonly photoId: string;
}

const SCOPE = 'photoVault.gallery';
/** Small ciphertexts can use more lanes without making full decrypts contend. */
export const MAX_CONCURRENT_THUMBNAIL_DOWNLOADS = 5;
export const MAX_CONCURRENT_FULL_DOWNLOADS = 2;
/**
 * 480*480*4 worst case ≈ 0.88 MiB decoded; 20 entries ≈ 17.6 MiB. The base64
 * strings themselves add roughly 53–80 KB each (≈ 1.1–1.6 MiB for 20), which
 * is small next to the decoded bitmaps this bound already accounts for.
 */
export const MAX_THUMBNAIL_CACHE_ENTRIES = 20;
/**
 * How many decrypted fulls one unlocked session may hold on to.
 *
 * Five rather than two, because two is smaller than the window the viewer
 * actually uses: with a previous/current/next prefetch, a limit of two evicts
 * a neighbour the user is one swipe away from, and A→B→A had to re-decrypt A
 * every single time. Five covers that window plus a couple of photos behind
 * it, which is what makes going back cheap.
 */
export const MAX_FULL_CACHE_ENTRIES = 5;
/**
 * …and the ceiling that actually protects memory.
 *
 * Counting entries alone is not a bound when entries differ by 20x. A
 * 1600px/0.85 JPEG is a few hundred KB on disk but decodes to ≈ 9.8 MiB, and a
 * pre-normalization legacy photo may be up to `MAX_ENCRYPTED_BYTES`. Both are
 * measured by the plaintext byte count the decrypt already reports, so a
 * handful of oversized legacy photos evict each other long before five of them
 * can sit in memory at once.
 */
export const MAX_FULL_CACHE_BYTES = 60 * 1024 * 1024;
/**
 * Thumbnails are bounded by count alone.
 *
 * Deliberate: they are a tightly clustered size class (one 480px/0.75 JPEG
 * each), so the entry ceiling above is already a byte ceiling in disguise and
 * a second limit would only be a number to keep in step with nothing.
 */
const UNBOUNDED_CACHE_BYTES = Number.POSITIVE_INFINITY;

const INITIAL: GalleryState = {
  status: 'idle',
  photos: [],
  uploading: false,
  deletingId: null,
  issue: null,
};

let state: GalleryState = INITIAL;
const listeners = new Set<(next: GalleryState) => void>();
/**
 * How many surfaces are currently rendering each thumbnail.
 *
 * Was a plain `Set`, which silently assumed one surface. It is not: the
 * comparator opens as a modal over the still-mounted gallery grid, so both
 * can render the same photo at once. With a set, whichever surface unmounted
 * first erased the other's claim — `drainThumbnailQueue` then skipped the
 * photo, and the cell left on screen stayed blank until it scrolled out and
 * back, because nothing re-announced it.
 *
 * Counting owners instead means a release only cancels work when the last
 * surface lets go. Absent key and zero are the same state; a count is never
 * stored as zero, so `size` stays proportional to what is on screen.
 */
const thumbnailOwners = new Map<string, number>();
const activeThumbnailOwners = new Map<number, GalleryThumbnailOwner>();

/**
 * Redirects a release aimed at a photo id that no longer exists.
 *
 * An optimistic upload renders under a local id and then becomes a real one.
 * The controller swaps the id in state, but the cell holding it re-runs its
 * effect afterwards and cleans up with the *old* id it captured. Without this
 * redirect that release would underflow while the real id kept a count no one
 * would ever return — a leak that pins a thumbnail for the whole session.
 *
 * Bounded by the number of optimistic uploads in a session, and cleared with
 * the counts on every reset.
 */
const thumbnailOwnerAliases = new Map<string, string>();
const thumbnailInFlight = new Set<string>();
const fullInFlight = new Set<string>();
const thumbnailQueue = new Set<string>();
/**
 * Fulls the user is actually waiting on. Always drained before the prefetch
 * queue below, so a speculative neighbour can never delay the photo on screen.
 */
const fullQueue = new Set<string>();
/**
 * Fulls requested speculatively for a neighbour. Best-effort by construction:
 * entries here are only started when a lane is free and nothing is pending in
 * `fullQueue`, and they are dropped outright when the window moves past them.
 */
const fullPrefetchQueue = new Set<string>();
const thumbnailWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const fullWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();

/**
 * One decrypted representation the session is holding.
 *
 * `bytes` is the plaintext length the decrypt reported — the only size this
 * layer can know without decoding the image, and enough to bound the cache
 * honestly rather than by counting entries of wildly different weight.
 */
interface CachedPlaintext {
  uri: string;
  bytes: number;
}

const thumbnailLru = new Map<string, CachedPlaintext>();
const fullLru = new Map<string, CachedPlaintext>();
const thumbnailRenderTimers = new Map<string, () => number>();
const viewerFirstRenderTimers = new Map<string, () => number>();
const viewerFullRenderTimers = new Map<string, () => number>();
/** The photo the viewer is showing right now. */
let viewerOwnerId: string | null = null;
/**
 * Everything the viewer may legitimately be holding: the photo on screen and
 * its two immediate neighbours.
 *
 * Replaces the single-id guard that used to gate every full result. With
 * prefetch there is more than one photo whose decrypt is legitimate, but the
 * set is still tiny and still bounded by the window — a result for anything
 * outside it is a swiped-past straggler whose plaintext must be deleted rather
 * than cached.
 */
const viewerWindowIds = new Set<string>();
let activeThumbnailDownloads = 0;
let activeFullDownloads = 0;
let generation = 0;
let localSequence = 0;
let thumbnailOwnerSequence = 0;

function emit(next: Partial<GalleryState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

function patchPhoto(photoId: string, patch: Partial<GalleryPhoto>): void {
  emit({ photos: state.photos.map((photo) => (photo.photoId === photoId ? { ...photo, ...patch } : photo)) });
}

export function getGalleryState(): GalleryState {
  return state;
}

export function subscribeToGallery(listener: (next: GalleryState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function issueOf(error: unknown): PhotoVaultIssue {
  return (error as { issue?: PhotoVaultIssue }).issue ?? 'vaultUnlockFailed';
}

function uniquePrivateUris(): string[] {
  return [
    ...new Set(
      state.photos.flatMap((photo) =>
        [photo.thumbnailUri, photo.fullUri, photo.previewUri].filter(
          (uri): uri is string => uri !== null,
        ),
      ),
    ),
  ];
}

/** Whether any surface is still rendering this thumbnail. */
function isThumbnailOwned(photoId: string): boolean {
  return thumbnailOwners.has(photoId);
}

/**
 * Registers one surface as rendering this thumbnail.
 *
 * O(1). Returns whether this was the first owner, which is the transition
 * that used to be a bare `mounted.add`.
 */
function acquireThumbnailOwnership(photoId: string): boolean {
  const next = (thumbnailOwners.get(photoId) ?? 0) + 1;
  thumbnailOwners.set(photoId, next);
  return next === 1;
}

/**
 * Gives up one surface's claim.
 *
 * O(1). Returns whether the last owner let go — only then may queued work be
 * cancelled. A release with no matching acquire clamps at zero and reports a
 * sanitized issue: going negative would let a later acquire count up from
 * below zero and leave a genuinely visible photo unowned.
 */
function releaseThumbnailOwnership(photoId: string): boolean {
  const ownedId = thumbnailOwnerAliases.get(photoId) ?? photoId;
  const current = thumbnailOwners.get(ownedId) ?? 0;

  if (current === 0) {
    logPhotoVaultIssue(SCOPE, 'vaultThumbnailOwnershipUnderflow');
    return false;
  }
  if (current > 1) {
    thumbnailOwners.set(ownedId, current - 1);
    return false;
  }

  thumbnailOwners.delete(ownedId);
  thumbnailOwnerAliases.delete(photoId);
  return true;
}

/**
 * Moves every claim from a local upload id to the real id that replaced it.
 *
 * The surfaces holding the old id have not re-rendered yet, so the alias
 * keeps their eventual release pointed at the right counter.
 */
function transferThumbnailOwnership(fromId: string, toId: string): void {
  const carried = thumbnailOwners.get(fromId) ?? 0;
  thumbnailOwners.delete(fromId);
  if (carried > 0) {
    thumbnailOwners.set(toId, (thumbnailOwners.get(toId) ?? 0) + carried);
    thumbnailOwnerAliases.set(fromId, toId);
  }
}

function clearThumbnailOwnership(): void {
  thumbnailOwners.clear();
  thumbnailOwnerAliases.clear();
  activeThumbnailOwners.clear();
}

function clearQueue(
  queue: Set<string>,
  waiters: Map<string, { promise: Promise<void>; resolve: () => void }>,
): void {
  queue.clear();
  for (const waiter of waiters.values()) waiter.resolve();
  waiters.clear();
}

function discardAllPrivateContent(preserveOwners = false): void {
  generation += 1;
  const uris = uniquePrivateUris();
  const clearedBytes = cachedBytes(fullLru);
  const clearedItems = fullLru.size;
  if (!preserveOwners) {
    clearThumbnailOwnership();
    viewerOwnerId = null;
  }
  // The window goes unconditionally. It is the gate every full result is
  // checked against, so emptying it is what stops an in-flight decrypt — the
  // photo on screen or a prefetched neighbour alike — from repopulating the
  // session cache after the vault has closed.
  viewerWindowIds.clear();
  clearQueue(thumbnailQueue, thumbnailWaiters);
  clearQueue(fullQueue, fullWaiters);
  clearQueue(fullPrefetchQueue, fullWaiters);
  thumbnailLru.clear();
  fullLru.clear();
  if (clearedItems > 0) {
    recordPhotoVaultCacheEvent('viewer.sessionCache.cleared', {
      items: clearedItems,
      bytes: clearedBytes,
    });
  }
  thumbnailRenderTimers.clear();
  viewerFirstRenderTimers.clear();
  viewerFullRenderTimers.clear();

  // Safe visual state first; filesystem cleanup never gets a chance to flash.
  emit({
    photos: state.photos.map((photo) => ({
      ...photo,
      thumbnailUri: null,
      fullUri: null,
      previewUri: null,
      thumbnailLoading: false,
      fullLoading: false,
      failed: false,
    })),
  });
  for (const uri of uris) releasePlaintext(uri);
}

export function discardDecryptedPhotos(): void {
  discardAllPrivateContent(false);
}

export function resetGallery(): void {
  discardAllPrivateContent(false);
  state = INITIAL;
  for (const listener of listeners) listener(state);
}

subscribeToPhotoVaultStatus((status) => {
  if (status !== 'unlocked') discardDecryptedPhotos();
});

function galleryPhotoFromMetadata(photo: ProgressPhoto, previous?: GalleryPhoto): GalleryPhoto {
  return {
    photoId: photo.photoId,
    assetId: photo.assetId,
    ...(photo.pose !== undefined ? { pose: photo.pose } : {}),
    ...(photo.dateKey !== undefined ? { dateKey: photo.dateKey } : {}),
    takenAt: photo.takenAt,
    metadata: photo,
    thumbnailUri: previous?.thumbnailUri ?? thumbnailLru.get(photo.photoId)?.uri ?? null,
    fullUri: previous?.fullUri ?? fullLru.get(photo.photoId)?.uri ?? null,
    previewUri: previous?.previewUri ?? null,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: null,
    uploadProgress: null,
    jobId: null,
  };
}

/** Metadata renders immediately; assets are queued separately by FlatList. */
export async function loadGallery(): Promise<void> {
  const requestGeneration = generation;
  const finishTrace = startPhotoVaultTrace('gallery.load.start', { requestGeneration });
  // `loading` is for a gallery with nothing to show. With cards already on
  // screen this revalidates behind them instead: the listing almost always
  // comes back identical, and replacing a gallery the user is already
  // looking at with a spinner is what made re-entering Fotos read as a cold
  // start. An emptied listing still lands — it is the same `ready` emit
  // below that publishes it.
  emit(state.photos.length === 0 ? { status: 'loading', issue: null } : { issue: null });
  try {
    const metadata = await listProgressPhotos();
    if (requestGeneration !== generation) {
      finishTrace('gallery.load.result', { outcome: 'generationChanged', generation });
      return;
    }
    finishTrace('gallery.load.result', { outcome: 'ready', photos: metadata.length });
    const previousById = new Map(state.photos.map((photo) => [photo.photoId, photo]));
    // Every card still owed to the backend survives a refresh, whatever stage
    // it is at — a listing that dropped a `failed` card would make a photo the
    // user still owns disappear from their own gallery.
    //
    // One is dropped: a pending card whose document the listing ALREADY
    // contains. That happens when a job's metadata write landed but the app
    // died before the job could be retired, and keeping both would show the
    // same photo twice. The listing is the authority, and the queue retires
    // the job on its next drain.
    const listed = new Set(metadata.map((photo) => photo.photoId));
    const pending = state.photos.filter(
      (photo) =>
        photo.uploadStatus !== null && !(photo.dateKey && photo.pose
          ? listed.has(`${photo.dateKey}_${photo.pose}`)
          : false),
    );
    emit({
      status: 'ready',
      photos: [
        ...pending,
        ...metadata.map((photo) => galleryPhotoFromMetadata(photo, previousById.get(photo.photoId))),
      ],
    });
    // Jobs that outlived the process have no card yet; give them one so a
    // photo saved before a restart is visible while it finishes syncing.
    void hydratePendingJobs().then(() => kickPhotoVaultUploadQueue('gallery-loaded'));

    for (const photoId of thumbnailOwners.keys()) void ensurePhotoLoaded(photoId);
    if (viewerOwnerId) void ensureFullPhotoLoaded(viewerOwnerId);

    // Deferred past this frame on purpose. Tidying the encrypted cache is
    // bookkeeping; running it inline would put a directory listing between the
    // state emit and the paint. It is also bounded per call, so a large
    // gallery cannot turn a refresh into a full filesystem scan.
    setTimeout(() => {
      if (requestGeneration !== generation) return;
      reconcileProgressPhotoCache(metadata);
    }, 0);
  } catch (error) {
    if (requestGeneration !== generation) {
      finishTrace('gallery.load.result', { outcome: 'staleError' });
      return;
    }
    const issue = issueOf(error);
    finishTrace('gallery.load.result', { outcome: 'error', issue });
    logPhotoVaultIssue(SCOPE, issue);
    emit({ status: 'error', issue });
  }
}

function touchLru(
  cache: Map<string, CachedPlaintext>,
  photoId: string,
  uri: string,
  bytes: number,
): void {
  cache.delete(photoId);
  cache.set(photoId, { uri, bytes });
}

/** Re-marks an existing entry as most recently used, keeping its size. */
function touchExistingLru(cache: Map<string, CachedPlaintext>, photoId: string): void {
  const entry = cache.get(photoId);
  if (!entry) return;
  cache.delete(photoId);
  cache.set(photoId, entry);
}

function cachedBytes(cache: Map<string, CachedPlaintext>): number {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  return total;
}

function uriStillReferenced(uri: string): boolean {
  return state.photos.some(
    (photo) =>
      photo.thumbnailUri === uri || photo.fullUri === uri || photo.previewUri === uri,
  );
}

/**
 * Drops least-recently-used entries until BOTH ceilings hold.
 *
 * Either limit can be the one that binds, and which one does is a property of
 * the photos, not of the configuration: five ordinary photos sit far inside the
 * byte budget, while two legacy ones can exceed it on their own.
 *
 * Anything inside the viewer's window is skipped rather than evicted — it is
 * on screen or one swipe away, so reclaiming it would guarantee the re-decrypt
 * this cache exists to avoid. `attempts` bounds the pass so a window that
 * cannot be evicted terminates instead of spinning.
 */
function evictLru(
  cache: Map<string, CachedPlaintext>,
  limitEntries: number,
  limitBytes: number,
  kind: 'thumbnail' | 'full',
): void {
  // Thumbnails pass an infinite byte budget, so skip summing what can never
  // exceed it rather than walking the map once per eviction for nothing.
  const bounded = Number.isFinite(limitBytes);
  const overBudget = () =>
    cache.size > limitEntries || (bounded && cachedBytes(cache) > limitBytes);

  let attempts = cache.size;
  let evicted = 0;
  let reclaimed = 0;
  while (overBudget() && attempts > 0) {
    attempts -= 1;
    const oldest = cache.entries().next().value as [string, CachedPlaintext] | undefined;
    if (!oldest) break;
    const [photoId, entry] = oldest;
    // Never evict what the viewer is currently painting, nor the neighbours it
    // is about to page onto.
    if (viewerWindowIds.has(photoId)) {
      cache.delete(photoId);
      cache.set(photoId, entry);
      continue;
    }
    cache.delete(photoId);
    const photo = state.photos.find((item) => item.photoId === photoId);
    if (photo) {
      if (kind === 'thumbnail') patchPhoto(photoId, { thumbnailUri: null });
      else {
        const patch: Partial<GalleryPhoto> = { fullUri: null };
        if (photo.thumbnailUri === entry.uri) patch.thumbnailUri = null;
        patchPhoto(photoId, patch);
      }
    }
    if (!uriStillReferenced(entry.uri)) releasePlaintext(entry.uri);
    evicted += 1;
    reclaimed += entry.bytes;
  }
  if (evicted > 0 && kind === 'full') {
    recordPhotoVaultCacheEvent('viewer.sessionCache.evicted', {
      items: evicted,
      bytes: reclaimed,
    });
  }
}

function settleWaiter(
  photoId: string,
  waiters: Map<string, { promise: Promise<void>; resolve: () => void }>,
): void {
  waiters.get(photoId)?.resolve();
  waiters.delete(photoId);
}

async function runThumbnailDownload(photoId: string, requestGeneration: number): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata || photo.thumbnailUri || photo.uploadStatus) {
    settleWaiter(photoId, thumbnailWaiters);
    return;
  }
  thumbnailInFlight.add(photoId);
  activeThumbnailDownloads += 1;
  patchPhoto(photoId, { thumbnailLoading: true, failed: false });
  const finishRender = startPhotoVaultPerf('gallery.thumbnail.render-ready');

  try {
    const result = await downloadProgressPhotoThumbnail(photo.metadata);
    // A data URI needs no cleanup; a legacy full URI owns a file that must be
    // deleted if this result arrives after the vault closed.
    const resultUri = result.isFullImage ? result.uri : result.dataUri;
    const current = state.photos.find((entry) => entry.photoId === photoId);
    if (requestGeneration !== generation || !current) {
      releasePlaintext(resultUri);
      return;
    }

    const oldPreview = current.previewUri;
    if (result.isFullImage) {
      touchLru(fullLru, photoId, resultUri, result.size);
      patchPhoto(photoId, {
        thumbnailUri: resultUri,
        fullUri: resultUri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(fullLru, MAX_FULL_CACHE_ENTRIES, MAX_FULL_CACHE_BYTES, 'full');
    } else {
      // A data URI has no file behind it, so its own string length is the only
      // footprint there is to account for.
      touchLru(thumbnailLru, photoId, resultUri, resultUri.length);
      patchPhoto(photoId, {
        thumbnailUri: resultUri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(
        thumbnailLru,
        MAX_THUMBNAIL_CACHE_ENTRIES,
        UNBOUNDED_CACHE_BYTES,
        'thumbnail',
      );
    }
    if (oldPreview && oldPreview !== resultUri && !uriStillReferenced(oldPreview)) {
      releasePlaintext(oldPreview);
    }
    thumbnailRenderTimers.set(photoId, finishRender);
  } catch (error) {
    if (requestGeneration === generation && state.photos.some((entry) => entry.photoId === photoId)) {
      const issue = issueOf(error);
      logPhotoVaultIssue(SCOPE, issue);
      patchPhoto(photoId, { thumbnailLoading: false, failed: true });
    }
    finishRender();
  } finally {
    thumbnailInFlight.delete(photoId);
    activeThumbnailDownloads = Math.max(0, activeThumbnailDownloads - 1);
    settleWaiter(photoId, thumbnailWaiters);
    drainThumbnailQueue();
  }
}

function drainThumbnailQueue(): void {
  while (activeThumbnailDownloads < MAX_CONCURRENT_THUMBNAIL_DOWNLOADS) {
    const photoId = thumbnailQueue.values().next().value as string | undefined;
    if (!photoId) return;
    thumbnailQueue.delete(photoId);
    if (!isThumbnailOwned(photoId) && !viewerWindowIds.has(photoId)) {
      settleWaiter(photoId, thumbnailWaiters);
      continue;
    }
    void runThumbnailDownload(photoId, generation);
  }
}

/** Grid requests only the thumbnail (or the explicit legacy full fallback). */
export function ensurePhotoLoaded(photoId: string): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata || photo.thumbnailUri || photo.uploadStatus || thumbnailInFlight.has(photoId)) {
    return thumbnailWaiters.get(photoId)?.promise ?? Promise.resolve();
  }
  const existing = thumbnailWaiters.get(photoId);
  if (existing) return existing.promise;
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  thumbnailWaiters.set(photoId, { promise, resolve });
  thumbnailQueue.add(photoId);
  drainThumbnailQueue();
  return promise;
}

async function runFullDownload(
  photoId: string,
  requestGeneration: number,
  priority: FullLoadPriority,
): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata || photo.fullUri) {
    settleWaiter(photoId, fullWaiters);
    return;
  }
  fullInFlight.add(photoId);
  activeFullDownloads += 1;
  // Only the photo on screen has a spinner to answer for. A neighbour being
  // prepared in the background must not make the viewer look busy.
  if (priority === 'current') patchPhoto(photoId, { fullLoading: true });
  if (priority === 'prefetch') recordPhotoVaultCacheEvent('viewer.prefetch.started');
  const finishRender = startPhotoVaultPerf('viewer.full.render-ready');
  try {
    const result = await downloadProgressPhoto(photo.metadata);
    const current = state.photos.find((entry) => entry.photoId === photoId);
    // The window may have moved on while this was decrypting. Accepting a
    // result for a photo that is no longer reachable would both cache plaintext
    // nobody asked for and keep its file alive past its usefulness.
    if (requestGeneration !== generation || !current || !viewerWindowIds.has(photoId)) {
      releasePlaintext(result.uri);
      if (priority === 'prefetch') recordPhotoVaultCacheEvent('viewer.prefetch.discarded');
      return;
    }
    touchLru(fullLru, photoId, result.uri, result.size);
    patchPhoto(photoId, { fullUri: result.uri, fullLoading: false, failed: false });
    evictLru(fullLru, MAX_FULL_CACHE_ENTRIES, MAX_FULL_CACHE_BYTES, 'full');
    if (priority === 'prefetch') {
      recordPhotoVaultCacheEvent('viewer.prefetch.completed', { bytes: result.size });
    }
    viewerFullRenderTimers.set(photoId, finishRender);
  } catch (error) {
    // A failed prefetch is not a user-visible failure: nothing was being shown
    // and the photo will simply load normally if it is ever opened.
    if (requestGeneration === generation && viewerOwnerId === photoId) {
      const issue = issueOf(error);
      logPhotoVaultIssue(SCOPE, issue);
      patchPhoto(photoId, { fullLoading: false, failed: true });
    }
    finishRender();
  } finally {
    fullInFlight.delete(photoId);
    activeFullDownloads = Math.max(0, activeFullDownloads - 1);
    settleWaiter(photoId, fullWaiters);
    drainFullQueue();
  }
}

/**
 * The next full to start, current before prefetch.
 *
 * Strict priority rather than a weighting: a speculative neighbour is only
 * ever worth starting when nothing the user is actually looking at is waiting
 * for a lane.
 */
function nextFullRequest(): { photoId: string; priority: FullLoadPriority } | null {
  const current = fullQueue.values().next().value as string | undefined;
  if (current !== undefined) {
    fullQueue.delete(current);
    return { photoId: current, priority: 'current' };
  }
  const prefetch = fullPrefetchQueue.values().next().value as string | undefined;
  if (prefetch !== undefined) {
    fullPrefetchQueue.delete(prefetch);
    return { photoId: prefetch, priority: 'prefetch' };
  }
  return null;
}

function drainFullQueue(): void {
  while (activeFullDownloads < MAX_CONCURRENT_FULL_DOWNLOADS) {
    const next = nextFullRequest();
    if (!next) return;
    // Queued while it was in the window, drained after the window moved on.
    if (!viewerWindowIds.has(next.photoId)) {
      settleWaiter(next.photoId, fullWaiters);
      continue;
    }
    void runFullDownload(next.photoId, generation, next.priority);
  }
}

/**
 * Whether this full is wanted for the photo on screen or merely anticipated.
 *
 * The distinction is deliberately the only scheduling concept here: it decides
 * which queue the request joins and whether a spinner is shown, and nothing
 * else. A full priority system would be more machinery than two states need.
 */
export type FullLoadPriority = 'current' | 'prefetch';

export function ensureFullPhotoLoaded(
  photoId: string,
  priority: FullLoadPriority = 'current',
): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata) return Promise.resolve();

  if (photo.fullUri) {
    // Already decrypted by this session: the whole point of the LRU.
    touchExistingLru(fullLru, photoId);
    if (priority === 'current') recordPhotoVaultCacheEvent('viewer.sessionCache.hit');
    return Promise.resolve();
  }

  if (fullInFlight.has(photoId)) {
    // Single-flight: a prefetch the user has now navigated onto is exactly the
    // operation they are waiting for, so it is joined rather than duplicated.
    return fullWaiters.get(photoId)?.promise ?? Promise.resolve();
  }

  const existing = fullWaiters.get(photoId);
  if (existing) {
    // Queued but not started. Promote a prefetch the viewer has caught up with
    // so it stops queueing behind other speculative work.
    if (priority === 'current' && fullPrefetchQueue.delete(photoId)) {
      fullQueue.add(photoId);
      recordPhotoVaultCacheEvent('viewer.sessionCache.miss');
      drainFullQueue();
    }
    return existing.promise;
  }

  if (priority === 'current') recordPhotoVaultCacheEvent('viewer.sessionCache.miss');
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  fullWaiters.set(photoId, { promise, resolve });
  (priority === 'current' ? fullQueue : fullPrefetchQueue).add(photoId);
  drainFullQueue();
  return promise;
}

export function mountGalleryPhoto(photoId: string): Promise<void> {
  acquireThumbnailOwnership(photoId);
  touchExistingLru(thumbnailLru, photoId);
  touchExistingLru(fullLru, photoId);
  return ensurePhotoLoaded(photoId);
}

export function unmountGalleryPhoto(photoId: string): void {
  // Only the last owner may cancel. A surface closing over another one that
  // is still showing this photo must leave its queued decrypt alone.
  if (!releaseThumbnailOwnership(photoId)) return;
  if (thumbnailQueue.delete(photoId)) settleWaiter(photoId, thumbnailWaiters);
}

/**
 * Production UI ownership API. Unlike the legacy photo-id pair above, this
 * returns a synchronous handle for the exact mounted effect that acquired the
 * thumbnail. Download/decrypt still runs asynchronously through the existing
 * queue and cache.
 */
export function claimGalleryThumbnail(photoId: string): GalleryThumbnailOwner {
  const owner: GalleryThumbnailOwner = {
    ownerKey: (thumbnailOwnerSequence += 1),
    generation,
    photoId,
  };
  activeThumbnailOwners.set(owner.ownerKey, owner);
  acquireThumbnailOwnership(photoId);

  touchExistingLru(thumbnailLru, photoId);
  touchExistingLru(fullLru, photoId);
  void ensurePhotoLoaded(photoId);
  return owner;
}

/** Releases exactly one mounted effect without crossing a reset boundary. */
export function releaseGalleryThumbnail(owner: GalleryThumbnailOwner): void {
  // Reset/lock clears the owner registry after advancing generation. A cleanup
  // from that old React tree is expected and must not touch the new session.
  if (owner.generation !== generation) return;

  const activeOwner = activeThumbnailOwners.get(owner.ownerKey);
  if (
    !activeOwner ||
    activeOwner.generation !== owner.generation ||
    activeOwner.photoId !== owner.photoId
  ) {
    // Same-generation duplicate/forged releases remain real programming
    // errors; retain the sanitized underflow signal rather than hiding them.
    logPhotoVaultIssue(SCOPE, 'vaultThumbnailOwnershipUnderflow');
    return;
  }

  activeThumbnailOwners.delete(owner.ownerKey);
  if (!releaseThumbnailOwnership(owner.photoId)) return;
  if (thumbnailQueue.delete(owner.photoId)) {
    settleWaiter(owner.photoId, thumbnailWaiters);
  }
}

/**
 * Which photos the viewer may hold at one moment.
 *
 * Exactly the page on screen and the two it can reach with a single swipe.
 * Deliberately not an index range into the gallery: the caller knows the order
 * its own filter produced, and passing ids keeps this module from having to
 * agree with the UI about what "next" means.
 */
export interface ViewerNeighbours {
  previous?: string | null;
  next?: string | null;
}

/**
 * Viewer opens on the already-visible thumbnail, then requests full separately.
 *
 * The neighbours are prepared at prefetch priority, so they only ever use a
 * lane the photo on screen is not using. Everything outside this window is
 * dropped from the queues — paging forward must not leave a trail of
 * speculative decrypts running behind the user.
 */
export function claimGalleryPhotoForViewer(
  photoId: string,
  neighbours: ViewerNeighbours = {},
): void {
  viewerOwnerId = photoId;

  const window = new Set<string>([photoId]);
  if (neighbours.previous) window.add(neighbours.previous);
  if (neighbours.next) window.add(neighbours.next);

  // Anything that fell out of the window and has not started yet is abandoned
  // now, rather than being drained later and discarded after the work is done.
  for (const queued of [...fullPrefetchQueue]) {
    if (window.has(queued)) continue;
    fullPrefetchQueue.delete(queued);
    settleWaiter(queued, fullWaiters);
  }

  viewerWindowIds.clear();
  for (const id of window) viewerWindowIds.add(id);

  viewerFirstRenderTimers.set(
    photoId,
    startPhotoVaultPerf('viewer.placeholder.render-ready'),
  );
  void ensurePhotoLoaded(photoId);
  // The photo on screen is requested first, so it is the one holding a lane by
  // the time either neighbour is considered.
  void ensureFullPhotoLoaded(photoId, 'current');
  if (neighbours.next) void ensureFullPhotoLoaded(neighbours.next, 'prefetch');
  if (neighbours.previous) void ensureFullPhotoLoaded(neighbours.previous, 'prefetch');
}

export function releaseGalleryPhotoFromViewer(photoId: string | null): void {
  if (photoId && viewerOwnerId === photoId) viewerOwnerId = null;
  if (photoId && fullQueue.delete(photoId)) settleWaiter(photoId, fullWaiters);
  if (photoId) {
    viewerFirstRenderTimers.delete(photoId);
    viewerFullRenderTimers.delete(photoId);
  }
  // The viewer is closing rather than paging: nothing is a neighbour of
  // anything any more, so no further prefetch result may be accepted.
  if (viewerOwnerId === null) {
    viewerWindowIds.clear();
    for (const queued of [...fullPrefetchQueue]) {
      fullPrefetchQueue.delete(queued);
      settleWaiter(queued, fullWaiters);
    }
  }
}

export function markGalleryPhotoRendered(photoId: string): void {
  thumbnailRenderTimers.get(photoId)?.();
  thumbnailRenderTimers.delete(photoId);
}

export function markViewerPhotoRendered(photoId: string, fullRendered: boolean): void {
  viewerFirstRenderTimers.get(photoId)?.();
  viewerFirstRenderTimers.delete(photoId);
  if (fullRendered) {
    viewerFullRenderTimers.get(photoId)?.();
    viewerFullRenderTimers.delete(photoId);
  }
}

export interface AddPhotoInput {
  sourceUri: string;
  takenAt: Date;
  originalMimeType: ProgressPhotoMimeType;
  /**
   * Which view of the body this is. Present for every photo added through the
   * posed flow; absent only for the compatibility path kept for older callers
   * and tests. The day is never passed in — the service derives it from
   * `takenAt` so the UI cannot file a photo under a day it did not happen.
   */
  pose?: ProgressPhotoPose;
  width?: number;
  height?: number;
}

/**
 * Releases a picked photo the user decided not to save.
 *
 * The picker stages its output inside the vault's plaintext directory, so an
 * abandoned selection still has to be removed. Routed through the controller
 * so the UI never touches the filesystem itself.
 */
export function discardGalleryPreview(uri: string | null): void {
  if (uri) releasePlaintext(uri);
}

/** Whether this (day, pose) is already filled by a photo the client knows about. */
export function isSlotTaken(dateKey: string, pose: ProgressPhotoPose): boolean {
  return state.photos.some((photo) => photo.dateKey === dateKey && photo.pose === pose);
}

/**
 * The outcome of one photo operation, carrying its OWN failure.
 *
 * Deliberately not a bare boolean. `state.issue` is a single shared slot, and
 * callers used to read it straight after awaiting — which was only correct
 * while photos were saved strictly one at a time. Three poses committing at
 * once can each fail differently, and the last writer would otherwise decide
 * what all three reported. The issue travels with the result instead.
 */
export interface GalleryPhotoResult {
  ok: boolean;
  issue?: PhotoVaultIssue;
}

/**
 * Saves a photo locally and hands delivery to the durable queue.
 *
 * This resolves as soon as the photo is SEALED AND DURABLE — not when the
 * backend has it. That is the whole point of the local-first split: by the
 * time this returns, the ciphertext survives a crash, a force-kill and a
 * locked vault, so closing the sheet is a statement about the photo being
 * safe rather than a loading state being hidden.
 *
 * What is still outstanding afterwards is recorded in a persisted job, and the
 * card keeps saying so until it lands.
 */
export async function addGalleryPhoto(input: AddPhotoInput): Promise<GalleryPhotoResult> {
  const requestGeneration = generation;
  const localId = `local-upload-${(localSequence += 1)}`;
  const finishTrace = startPhotoVaultTrace('gallery.add.start', {
    pose: input.pose ?? 'none',
    requestGeneration,
  });
  notePhotoVaultUploadStarted();
  // The day is computed the same way the service will, so the optimistic card
  // lands in the slot the finished photo will occupy — no jump from
  // "unclassified" to a pose once the upload settles.
  const optimisticDateKey =
    input.pose === undefined ? undefined : localDateKey(input.takenAt);
  const optimistic: GalleryPhoto = {
    photoId: localId,
    // No remote identity yet; both are filled in when the upload resolves.
    // Deliberately null rather than a placeholder: a fake id could collide
    // with a real UUID in the cache.
    assetId: null,
    ...(input.pose !== undefined ? { pose: input.pose } : {}),
    ...(optimisticDateKey !== undefined ? { dateKey: optimisticDateKey } : {}),
    takenAt: input.takenAt,
    metadata: null,
    thumbnailUri: null,
    fullUri: null,
    previewUri: input.sourceUri,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: 'preparing',
    uploadProgress: 0,
    jobId: null,
  };
  emit({
    status: 'ready',
    uploading: true,
    issue: null,
    photos: [optimistic, ...state.photos],
  });
  tracePhotoVault('gallery.add.optimisticCard', { photos: state.photos.length });

  try {
    // ── The only part the user waits for. ──
    const prepared = await prepareProgressPhotoUpload(input);
    // Durable from here on. Every later failure is a delivery problem, never a
    // lost photo, which is why nothing below removes the card.
    const job = await enqueuePreparedPhoto(prepared.uid, prepared);

    if (requestGeneration !== generation) {
      // The vault closed while this was being sealed.
      //
      // The CARD goes: it belongs to a session that has ended, and the lock
      // already took its preview, so leaving it would paint an imageless
      // placeholder into the next session. `hydratePendingJobs` rebuilds a
      // clean one from the job on the next authenticated load.
      //
      // The JOB stays, and that is the important half: the photo is sealed and
      // durable, and the worker does not need the vault open to deliver it.
      emit({
        photos: state.photos.filter((photo) => photo.photoId !== localId),
      });
      emit({ uploading: state.photos.some((photo) => photo.uploadStatus !== null) });
      kickPhotoVaultUploadQueue('prepared-while-locked');
      finishTrace('gallery.add.finished', { ok: true, outcome: 'generationChanged' });
      return { ok: true };
    }

    patchPhoto(localId, {
      uploadStatus: 'uploading',
      uploadProgress: 0,
      jobId: job.jobId,
    });
    emit({ uploading: state.photos.some((photo) => photo.uploadStatus !== null) });
    tracePhotoVault('gallery.add.uiReleased', { pose: input.pose ?? 'none' });
    kickPhotoVaultUploadQueue('photo-prepared');
    finishTrace('gallery.add.finished', { ok: true, outcome: 'prepared' });
    return { ok: true };
  } catch (error) {
    // Preparation is the one stage that can still lose the photo: nothing
    // durable exists yet, so the card has to go.
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    const preview = state.photos.find((photo) => photo.photoId === localId)?.previewUri;
    emit({
      issue,
      photos: state.photos.filter((photo) => photo.photoId !== localId),
    });
    emit({ uploading: state.photos.some((photo) => photo.uploadStatus !== null) });
    if (preview) releasePlaintext(preview);
    finishTrace('gallery.add.finished', {
      ok: false,
      outcome: 'error',
      issue,
      generationChanged: requestGeneration !== generation,
    });
    return { ok: false, issue };
  } finally {
    notePhotoVaultUploadSettled();
  }
}

// ── Durable queue ──────────────────────────────────────────────────────────

/**
 * A job that landed becomes an ordinary photo.
 *
 * The card keeps its place and its preview until the real thumbnail decrypts,
 * so the grid does not blink at the moment of confirmation.
 */
subscribeToPhotoVaultUploadSynced((photo, job) => {
  const current = state.photos.find((entry) => entry.jobId === job.jobId);
  if (!current) return;
  const settled = galleryPhotoFromMetadata(photo, current);
  settled.previewUri = current.previewUri;
  emit({
    photos: state.photos.map((entry) => (entry.jobId === job.jobId ? settled : entry)),
  });
  emit({ uploading: state.photos.some((entry) => entry.uploadStatus !== null) });
  transferThumbnailOwnership(current.photoId, photo.photoId);
  void ensurePhotoLoaded(photo.photoId);
});

/**
 * A job that can never complete takes its card with it.
 *
 * Only ever fired for genuinely terminal outcomes — the slot was claimed by
 * another device, or the ciphertext is gone — never for a retryable failure.
 */
subscribeToPhotoVaultUploadDropped((job) => {
  const current = state.photos.find((entry) => entry.jobId === job.jobId);
  if (!current) return;
  emit({
    photos: state.photos.filter((entry) => entry.jobId !== job.jobId),
    issue: job.lastIssue ?? 'vaultUploadFailed',
  });
  emit({ uploading: state.photos.some((entry) => entry.uploadStatus !== null) });
  if (current.previewUri && !uriStillReferenced(current.previewUri)) {
    releasePlaintext(current.previewUri);
  }
});

subscribeToPhotoVaultUploadProgress((jobId, progress) => {
  const current = state.photos.find((entry) => entry.jobId === jobId);
  if (current) patchPhoto(current.photoId, { uploadProgress: progress });
});

/**
 * Mirrors the persisted queue onto the cards.
 *
 * A failed delivery changes what the card should SAY, never whether it exists:
 * the photo is durable, a retry is already scheduled, and the card stays put.
 */
subscribeToPhotoVaultUploadQueue((jobs) => {
  const byJobId = new Map(jobs.map((job) => [job.jobId, job]));
  let changed = false;
  const photos = state.photos.map((photo) => {
    if (!photo.jobId) return photo;
    const job = byJobId.get(photo.jobId);
    if (!job) return photo;
    const next: GalleryPhoto['uploadStatus'] = job.state === 'failed' ? 'failed' : 'uploading';
    if (photo.uploadStatus === next) return photo;
    changed = true;
    return { ...photo, uploadStatus: next };
  });
  if (changed) emit({ photos });
});

/**
 * Rebuilds cards for jobs that outlived the process.
 *
 * A photo prepared before a force-kill has no preview any more — the plaintext
 * was in the reclaimable cache and the lock or the restart took it. The card
 * is therefore deliberately imageless: it says the photo exists and is still
 * syncing, which is true, and shows nothing private, which is required.
 */
async function hydratePendingJobs(): Promise<void> {
  const jobs = await listPendingPhotoVaultJobs();
  const known = new Set(state.photos.map((photo) => photo.jobId).filter(Boolean));
  const restored = jobs
    .filter((job) => !known.has(job.jobId))
    .map<GalleryPhoto>((job) => ({
      photoId: `local-upload-${(localSequence += 1)}`,
      assetId: null,
      ...(job.pose !== undefined ? { pose: job.pose } : {}),
      ...(job.dateKey !== undefined ? { dateKey: job.dateKey } : {}),
      takenAt: new Date(job.takenAt),
      metadata: null,
      thumbnailUri: null,
      fullUri: null,
      previewUri: null,
      thumbnailLoading: false,
      fullLoading: false,
      failed: false,
      uploadStatus: job.state === 'failed' ? 'failed' : 'uploading',
      uploadProgress: null,
      jobId: job.jobId,
    }));
  if (restored.length === 0) return;
  emit({ photos: [...restored, ...state.photos] });
  tracePhotoVault('gallery.pendingJobsHydrated', { count: restored.length });
}

/**
 * Asks the queue to try this card's job again right now.
 *
 * Only meaningful for a card whose bytes are already durable, which is exactly
 * the set that can show a failed state.
 */
export async function retryGalleryPhoto(photoId: string): Promise<boolean> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.jobId) return false;
  patchPhoto(photoId, { uploadStatus: 'uploading', failed: false });
  await retryPhotoVaultUploadJob(photo.jobId);
  return true;
}

/**
 * Swaps the photo occupying a slot.
 *
 * The old thumbnail stays on screen for the whole operation, with the card
 * marked as uploading. That is not cosmetic: until the new metadata is
 * committed the OLD photo really is still the authority, and clearing it early
 * would show a state the vault is not in. Only a confirmed success swaps the
 * card for the new photo.
 */
export async function replaceGalleryPhoto(
  photoId: string,
  input: AddPhotoInput,
): Promise<GalleryPhotoResult> {
  const requestGeneration = generation;
  const existing = state.photos.find((photo) => photo.photoId === photoId);
  if (!existing?.metadata) {
    // The slot is held by an upload that has not committed yet, so there is no
    // persisted photo to swap. Reporting it explicitly matters: an untyped
    // failure would surface as "your current photo was kept", which is false.
    emit({ issue: 'vaultReplaceSlotMissing' });
    return { ok: false, issue: 'vaultReplaceSlotMissing' };
  }

  patchPhoto(photoId, { uploadStatus: 'uploading', uploadProgress: 0, failed: false });
  emit({ uploading: true, issue: null });

  try {
    const replaced = await replaceProgressPhoto({
      current: existing.metadata,
      sourceUri: input.sourceUri,
      takenAt: input.takenAt,
      originalMimeType: input.originalMimeType,
      width: input.width,
      height: input.height,
      onProgress: (progress) => patchPhoto(photoId, { uploadProgress: progress }),
    });
    if (requestGeneration !== generation) {
      // The vault closed mid-flight. The swap did commit remotely, so the next
      // authenticated load will show it; nothing is repainted behind the lock.
      emit({ uploading: false });
      return { ok: true };
    }

    const previousThumbnail = existing.thumbnailUri;
    const previousFull = existing.fullUri;
    // Same document id, new asset: the card keeps its place in the day.
    thumbnailLru.delete(photoId);
    fullLru.delete(photoId);
    emit({
      uploading: false,
      photos: state.photos.map((photo) =>
        photo.photoId === photoId ? galleryPhotoFromMetadata(replaced) : photo,
      ),
    });
    for (const uri of new Set([previousThumbnail, previousFull])) {
      if (uri) releasePlaintext(uri);
    }
    void ensurePhotoLoaded(photoId);
    return { ok: true };
  } catch (error) {
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    if (requestGeneration === generation) {
      // The old photo is still the authority; restore its card as it was.
      patchPhoto(photoId, { uploadStatus: null, uploadProgress: null, failed: true });
      emit({ uploading: false, issue });
      // A changed slot means another device already replaced it: only a
      // refetch can show what is actually there now.
      if (issue === 'vaultReplaceSlotChanged') void loadGallery();
    }
    return { ok: false, issue };
  }
}

/** Optimistic removal; failures restore/refetch instead of pretending success. */
export async function removeGalleryPhoto(photoId: string): Promise<boolean> {
  const index = state.photos.findIndex((photo) => photo.photoId === photoId);
  const photo = index >= 0 ? state.photos[index]! : null;

  // A photo that has not synced yet has no Firestore document to delete, so
  // the normal path cannot remove it. Cancelling its job is the equivalent
  // act: it drops the record, the durable ciphertext, and anything the job
  // already managed to place remotely.
  if (photo && !photo.metadata && photo.jobId) {
    emit({
      deletingId: photoId,
      issue: null,
      photos: state.photos.filter((entry) => entry.photoId !== photoId),
    });
    await cancelPhotoVaultUploadJob(photo.jobId);
    if (photo.previewUri && !uriStillReferenced(photo.previewUri)) {
      releasePlaintext(photo.previewUri);
    }
    emit({
      deletingId: null,
      uploading: state.photos.some((entry) => entry.uploadStatus !== null),
    });
    return true;
  }

  if (!photo?.metadata) return false;
  emit({
    deletingId: photoId,
    issue: null,
    photos: state.photos.filter((entry) => entry.photoId !== photoId),
  });

  try {
    await deleteProgressPhoto(photo.metadata);
    thumbnailLru.delete(photoId);
    fullLru.delete(photoId);
    for (const uri of new Set([photo.thumbnailUri, photo.fullUri, photo.previewUri])) {
      if (uri) releasePlaintext(uri);
    }
    emit({ deletingId: null });
    return true;
  } catch (error) {
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    emit({ deletingId: null, issue });
    if (issue === 'vaultPartialDelete') {
      thumbnailLru.delete(photoId);
      fullLru.delete(photoId);
      for (const uri of new Set([photo.thumbnailUri, photo.fullUri, photo.previewUri])) {
        if (uri) releasePlaintext(uri);
      }
      await loadGallery();
    } else {
      const restored = [...state.photos];
      restored.splice(Math.min(index, restored.length), 0, photo);
      emit({ photos: restored });
    }
    return false;
  }
}

/**
 * Test seam: how many surfaces currently claim each thumbnail.
 *
 * A snapshot, not the live map — a test that mutated it would silently
 * corrupt the controller it is meant to be checking.
 */
export function thumbnailOwnershipForTesting(): Record<string, number> {
  return Object.fromEntries(thumbnailOwners);
}

/** Test seam: stale ids still redirecting to the id that replaced them. */
export function thumbnailOwnerAliasesForTesting(): Record<string, string> {
  return Object.fromEntries(thumbnailOwnerAliases);
}

/** Test seam. */
export function resetGalleryForTesting(): void {
  state = INITIAL;
  listeners.clear();
  clearThumbnailOwnership();
  thumbnailInFlight.clear();
  fullInFlight.clear();
  clearQueue(thumbnailQueue, thumbnailWaiters);
  clearQueue(fullQueue, fullWaiters);
  clearQueue(fullPrefetchQueue, fullWaiters);
  thumbnailLru.clear();
  fullLru.clear();
  thumbnailRenderTimers.clear();
  viewerFirstRenderTimers.clear();
  viewerFullRenderTimers.clear();
  viewerOwnerId = null;
  viewerWindowIds.clear();
  activeThumbnailDownloads = 0;
  activeFullDownloads = 0;
  // Advance rather than reset: a test can intentionally hold an old UI token
  // across this seam and must get the same stale-cleanup semantics as runtime.
  generation += 1;
  localSequence = 0;
  thumbnailOwnerSequence = 0;
}
