import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import { subscribeToPhotoVaultStatus } from './photoVaultLock';
import { startPhotoVaultPerf } from './photoVaultPerformance';
import {
  deleteProgressPhoto,
  downloadProgressPhoto,
  downloadProgressPhotoThumbnail,
  listProgressPhotos,
  uploadProgressPhoto,
  type ProgressPhoto,
  type ProgressPhotoMimeType,
} from '../services/progressPhotos';
import { discardDecryptedPhoto } from '../services/photoVaultFileCrypto';

/**
 * Session-only private gallery controller.
 *
 * The maps below are only an in-memory LRU index over short-lived files in
 * `<cache>/photo-vault/tmp`; they are never a durable image cache. Lock,
 * logout and user switch synchronously remove every URI from React state and
 * then delete every owned file.
 */

export interface GalleryPhoto {
  photoId: string;
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

const SCOPE = 'photoVault.gallery';
/** Small ciphertexts can use more lanes without making full decrypts contend. */
export const MAX_CONCURRENT_THUMBNAIL_DOWNLOADS = 5;
export const MAX_CONCURRENT_FULL_DOWNLOADS = 2;
/** 480*480*4 worst case ≈ 0.88 MiB decoded; 20 entries ≈ 17.6 MiB. */
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
const mounted = new Set<string>();
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
    mounted.clear();
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
  for (const uri of uris) discardDecryptedPhoto(uri);
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
    for (const photoId of mounted) void ensurePhotoLoaded(photoId);
    if (viewerOwnerId) void ensureFullPhotoLoaded(viewerOwnerId);
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
    if (!uriStillReferenced(uri)) discardDecryptedPhoto(uri);
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
    const current = state.photos.find((entry) => entry.photoId === photoId);
    if (requestGeneration !== generation || !current) {
      discardDecryptedPhoto(result.uri);
      return;
    }

    const oldPreview = current.previewUri;
    if (result.isFullImage) {
      touchLru(fullLru, photoId, result.uri);
      patchPhoto(photoId, {
        thumbnailUri: result.uri,
        fullUri: result.uri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(fullLru, MAX_FULL_CACHE_ENTRIES, 'full');
    } else {
      touchLru(thumbnailLru, photoId, result.uri);
      patchPhoto(photoId, {
        thumbnailUri: result.uri,
        previewUri: null,
        thumbnailLoading: false,
        failed: false,
      });
      evictLru(thumbnailLru, MAX_THUMBNAIL_CACHE_ENTRIES, 'thumbnail');
    }
    if (oldPreview && oldPreview !== result.uri && !uriStillReferenced(oldPreview)) {
      discardDecryptedPhoto(oldPreview);
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
    if (!mounted.has(photoId) && viewerOwnerId !== photoId) {
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
      discardDecryptedPhoto(result.uri);
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
  mounted.add(photoId);
  const cachedThumbnail = thumbnailLru.get(photoId);
  const cachedFull = fullLru.get(photoId);
  if (cachedThumbnail) touchLru(thumbnailLru, photoId, cachedThumbnail);
  if (cachedFull) touchLru(fullLru, photoId, cachedFull);
  return ensurePhotoLoaded(photoId);
}

export function unmountGalleryPhoto(photoId: string): void {
  mounted.delete(photoId);
  if (thumbnailQueue.delete(photoId)) settleWaiter(photoId, thumbnailWaiters);
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
  width?: number;
  height?: number;
}

/** Adds an in-memory card immediately; no queue or plaintext state is persisted. */
export async function addGalleryPhoto(input: AddPhotoInput): Promise<boolean> {
  const requestGeneration = generation;
  const localId = `local-upload-${(localSequence += 1)}`;
  const optimistic: GalleryPhoto = {
    photoId: localId,
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
    if (mounted.delete(localId)) mounted.add(uploaded.photoId);
    mounted.add(uploaded.photoId);
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
    if (preview) discardDecryptedPhoto(preview);
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
      if (uri) discardDecryptedPhoto(uri);
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
        if (uri) discardDecryptedPhoto(uri);
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

/** Test seam. */
export function resetGalleryForTesting(): void {
  state = INITIAL;
  listeners.clear();
  mounted.clear();
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
  generation = 0;
  localSequence = 0;
}
