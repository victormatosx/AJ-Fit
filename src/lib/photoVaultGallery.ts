import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import { subscribeToPhotoVaultStatus } from './photoVaultLock';
import { startPhotoVaultPerf } from './photoVaultPerformance';
import {
  deleteProgressPhoto,
  downloadProgressPhoto,
  downloadProgressPhotoThumbnail,
  listProgressPhotos,
  reconcileProgressPhotoCache,
  replaceProgressPhoto,
  uploadProgressPhoto,
  type ProgressPhoto,
  type ProgressPhotoMimeType,
} from '../services/progressPhotos';
import { discardDecryptedPhoto } from '../services/photoVaultFileCrypto';
import { localDateKey, type ProgressPhotoPose } from './photoVaultIdentity';

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
 * `.thumb.enc` cache is deliberately NOT touched by any of that: it is
 * ciphertext, and re-downloading it after every lock was the problem this
 * phase exists to remove.
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
  uploadStatus: 'uploading' | null;
  uploadProgress: number | null;
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
/** A 1600px square can decode to ≈ 9.8 MiB; retain at most two. */
export const MAX_FULL_CACHE_ENTRIES = 2;

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
const fullQueue = new Set<string>();
const thumbnailWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const fullWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const thumbnailLru = new Map<string, string>();
const fullLru = new Map<string, string>();
const thumbnailRenderTimers = new Map<string, () => number>();
const viewerFirstRenderTimers = new Map<string, () => number>();
const viewerFullRenderTimers = new Map<string, () => number>();
let viewerOwnerId: string | null = null;
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
  if (!preserveOwners) {
    clearThumbnailOwnership();
    viewerOwnerId = null;
  }
  clearQueue(thumbnailQueue, thumbnailWaiters);
  clearQueue(fullQueue, fullWaiters);
  thumbnailLru.clear();
  fullLru.clear();
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
    thumbnailUri: previous?.thumbnailUri ?? thumbnailLru.get(photo.photoId) ?? null,
    fullUri: previous?.fullUri ?? fullLru.get(photo.photoId) ?? null,
    previewUri: previous?.previewUri ?? null,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: null,
    uploadProgress: null,
  };
}

/** Metadata renders immediately; assets are queued separately by FlatList. */
export async function loadGallery(): Promise<void> {
  const requestGeneration = generation;
  emit({ status: 'loading', issue: null });
  try {
    const metadata = await listProgressPhotos();
    if (requestGeneration !== generation) return;
    const previousById = new Map(state.photos.map((photo) => [photo.photoId, photo]));
    const pending = state.photos.filter((photo) => photo.uploadStatus === 'uploading');
    emit({
      status: 'ready',
      photos: [
        ...pending,
        ...metadata.map((photo) => galleryPhotoFromMetadata(photo, previousById.get(photo.photoId))),
      ],
    });
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
    if (requestGeneration !== generation) return;
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    emit({ status: 'error', issue });
  }
}

function touchLru(cache: Map<string, string>, photoId: string, uri: string): void {
  cache.delete(photoId);
  cache.set(photoId, uri);
}

function uriStillReferenced(uri: string): boolean {
  return state.photos.some(
    (photo) =>
      photo.thumbnailUri === uri || photo.fullUri === uri || photo.previewUri === uri,
  );
}

function evictLru(cache: Map<string, string>, limit: number, kind: 'thumbnail' | 'full'): void {
  let attempts = cache.size;
  while (cache.size > limit && attempts > 0) {
    attempts -= 1;
    const oldest = cache.entries().next().value as [string, string] | undefined;
    if (!oldest) return;
    const [photoId, uri] = oldest;
    // Never evict what the viewer is currently painting.
    if (viewerOwnerId === photoId) {
      cache.delete(photoId);
      cache.set(photoId, uri);
      continue;
    }
    cache.delete(photoId);
    const photo = state.photos.find((entry) => entry.photoId === photoId);
    if (photo) {
      if (kind === 'thumbnail') patchPhoto(photoId, { thumbnailUri: null });
      else {
        const patch: Partial<GalleryPhoto> = { fullUri: null };
        if (photo.thumbnailUri === uri) patch.thumbnailUri = null;
        patchPhoto(photoId, patch);
      }
    }
    if (!uriStillReferenced(uri)) releasePlaintext(uri);
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
      touchLru(fullLru, photoId, resultUri);
      patchPhoto(photoId, {
        thumbnailUri: resultUri,
        fullUri: resultUri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(fullLru, MAX_FULL_CACHE_ENTRIES, 'full');
    } else {
      touchLru(thumbnailLru, photoId, resultUri);
      patchPhoto(photoId, {
        thumbnailUri: resultUri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(thumbnailLru, MAX_THUMBNAIL_CACHE_ENTRIES, 'thumbnail');
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
    if (!isThumbnailOwned(photoId) && viewerOwnerId !== photoId) {
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

async function runFullDownload(photoId: string, requestGeneration: number): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata || photo.fullUri) {
    settleWaiter(photoId, fullWaiters);
    return;
  }
  fullInFlight.add(photoId);
  activeFullDownloads += 1;
  patchPhoto(photoId, { fullLoading: true });
  const finishRender = startPhotoVaultPerf('viewer.full.render-ready');
  try {
    const result = await downloadProgressPhoto(photo.metadata);
    const current = state.photos.find((entry) => entry.photoId === photoId);
    if (requestGeneration !== generation || !current || viewerOwnerId !== photoId) {
      releasePlaintext(result.uri);
      return;
    }
    touchLru(fullLru, photoId, result.uri);
    patchPhoto(photoId, { fullUri: result.uri, fullLoading: false, failed: false });
    evictLru(fullLru, MAX_FULL_CACHE_ENTRIES, 'full');
    viewerFullRenderTimers.set(photoId, finishRender);
  } catch (error) {
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

function drainFullQueue(): void {
  while (activeFullDownloads < MAX_CONCURRENT_FULL_DOWNLOADS) {
    const photoId = fullQueue.values().next().value as string | undefined;
    if (!photoId) return;
    fullQueue.delete(photoId);
    if (viewerOwnerId !== photoId) {
      settleWaiter(photoId, fullWaiters);
      continue;
    }
    void runFullDownload(photoId, generation);
  }
}

export function ensureFullPhotoLoaded(photoId: string): Promise<void> {
  const photo = state.photos.find((entry) => entry.photoId === photoId);
  if (!photo?.metadata || photo.fullUri || fullInFlight.has(photoId)) {
    return fullWaiters.get(photoId)?.promise ?? Promise.resolve();
  }
  const existing = fullWaiters.get(photoId);
  if (existing) return existing.promise;
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  fullWaiters.set(photoId, { promise, resolve });
  fullQueue.add(photoId);
  drainFullQueue();
  return promise;
}

export function mountGalleryPhoto(photoId: string): Promise<void> {
  acquireThumbnailOwnership(photoId);
  const cachedThumbnail = thumbnailLru.get(photoId);
  const cachedFull = fullLru.get(photoId);
  if (cachedThumbnail) touchLru(thumbnailLru, photoId, cachedThumbnail);
  if (cachedFull) touchLru(fullLru, photoId, cachedFull);
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

  const cachedThumbnail = thumbnailLru.get(photoId);
  const cachedFull = fullLru.get(photoId);
  if (cachedThumbnail) touchLru(thumbnailLru, photoId, cachedThumbnail);
  if (cachedFull) touchLru(fullLru, photoId, cachedFull);
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

/** Viewer opens on the already-visible thumbnail, then requests full separately. */
export function claimGalleryPhotoForViewer(photoId: string): void {
  viewerOwnerId = photoId;
  viewerFirstRenderTimers.set(
    photoId,
    startPhotoVaultPerf('viewer.placeholder.render-ready'),
  );
  void ensurePhotoLoaded(photoId);
  void ensureFullPhotoLoaded(photoId);
}

export function releaseGalleryPhotoFromViewer(photoId: string | null): void {
  if (photoId && viewerOwnerId === photoId) viewerOwnerId = null;
  if (photoId && fullQueue.delete(photoId)) settleWaiter(photoId, fullWaiters);
  if (photoId) {
    viewerFirstRenderTimers.delete(photoId);
    viewerFullRenderTimers.delete(photoId);
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

/** Adds an in-memory card immediately; no queue or plaintext state is persisted. */
export async function addGalleryPhoto(input: AddPhotoInput): Promise<boolean> {
  const requestGeneration = generation;
  const localId = `local-upload-${(localSequence += 1)}`;
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
    uploadStatus: 'uploading',
    uploadProgress: 0,
  };
  emit({
    status: 'ready',
    uploading: true,
    issue: null,
    photos: [optimistic, ...state.photos],
  });

  try {
    const uploaded = await uploadProgressPhoto({
      ...input,
      onProgress: (progress) => patchPhoto(localId, { uploadProgress: progress }),
    });
    if (requestGeneration !== generation) {
      emit({
        uploading: false,
        photos: state.photos.filter((photo) => photo.photoId !== localId),
      });
      // Lock already removed the preview from state and disk. The remote
      // photo will be discovered by the next authenticated gallery load.
      return true;
    }
    const current = state.photos.find((photo) => photo.photoId === localId);
    const remote = galleryPhotoFromMetadata(uploaded, current);
    remote.previewUri = current?.previewUri ?? null;
    emit({
      uploading: false,
      photos: state.photos.map((photo) => (photo.photoId === localId ? remote : photo)),
    });
    transferThumbnailOwnership(localId, uploaded.photoId);
    void ensurePhotoLoaded(uploaded.photoId);
    return true;
  } catch (error) {
    const issue = issueOf(error);
    logPhotoVaultIssue(SCOPE, issue);
    const preview = state.photos.find((photo) => photo.photoId === localId)?.previewUri;
    emit({
      uploading: false,
      issue,
      photos: state.photos.filter((photo) => photo.photoId !== localId),
    });
    if (preview) releasePlaintext(preview);
    return false;
  }
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
): Promise<boolean> {
  const requestGeneration = generation;
  const existing = state.photos.find((photo) => photo.photoId === photoId);
  if (!existing?.metadata) {
    // The slot is held by an upload that has not committed yet, so there is no
    // persisted photo to swap. Reporting it explicitly matters: an untyped
    // failure would surface as "your current photo was kept", which is false.
    emit({ issue: 'vaultReplaceSlotMissing' });
    return false;
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
      return true;
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
    return true;
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
    return false;
  }
}

/** Optimistic removal; failures restore/refetch instead of pretending success. */
export async function removeGalleryPhoto(photoId: string): Promise<boolean> {
  const index = state.photos.findIndex((photo) => photo.photoId === photoId);
  const photo = index >= 0 ? state.photos[index]! : null;
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
  thumbnailLru.clear();
  fullLru.clear();
  thumbnailRenderTimers.clear();
  viewerFirstRenderTimers.clear();
  viewerFullRenderTimers.clear();
  viewerOwnerId = null;
  activeThumbnailDownloads = 0;
  activeFullDownloads = 0;
  // Advance rather than reset: a test can intentionally hold an old UI token
  // across this seam and must get the same stale-cleanup semantics as runtime.
  generation += 1;
  localSequence = 0;
  thumbnailOwnerSequence = 0;
}
