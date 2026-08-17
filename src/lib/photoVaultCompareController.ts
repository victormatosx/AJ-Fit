import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import { subscribeToPhotoVaultStatus } from './photoVaultLock';
import { startPhotoVaultPerf } from './photoVaultPerformance';
import { photoVaultSessionGeneration } from './photoVaultSession';
import type { GalleryPhoto } from './photoVaultGallery';
import {
  downloadProgressPhoto,
  type ProgressPhoto,
} from '../services/progressPhotos';
import { discardDecryptedPhoto } from '../services/photoVaultFileCrypto';

/**
 * Full-image lifecycle owned exclusively by one comparison session.
 *
 * The controller keeps only the two temporary file URIs and the remote
 * metadata needed for a retry. It deliberately does not retain gallery
 * thumbnails or publish either URI anywhere else. Closing the flow, changing
 * its pair, or locking the Vault invalidates the generation before removing
 * the files, so an older async result can never restore private state.
 */

export type PhotoVaultCompareSide = 'before' | 'after';

export interface PhotoVaultCompareState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  beforeFullUri: string | null;
  afterFullUri: string | null;
  failedSide: PhotoVaultCompareSide | null;
  issue: PhotoVaultIssue | null;
}

interface OwnedPair {
  key: string;
  before: ProgressPhoto;
  after: ProgressPhoto;
}

const SCOPE = 'photoVault.compare';
const INITIAL: PhotoVaultCompareState = {
  status: 'idle',
  beforeFullUri: null,
  afterFullUri: null,
  failedSide: null,
  issue: null,
};

let state: PhotoVaultCompareState = INITIAL;
let pair: OwnedPair | null = null;
let generation = 0;
let activeLoad: Promise<void> | null = null;
let finishPreviewReady: (() => number) | null = null;
const listeners = new Set<(next: PhotoVaultCompareState) => void>();

function emit(next: PhotoVaultCompareState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

function patch(next: Partial<PhotoVaultCompareState>): void {
  emit({ ...state, ...next });
}

function discardUri(uri: string | null): void {
  if (uri) discardDecryptedPhoto(uri);
}

function ownedUris(): string[] {
  return [
    ...new Set(
      [state.beforeFullUri, state.afterFullUri].filter(
        (uri): uri is string => uri !== null,
      ),
    ),
  ];
}

function invalidate(): void {
  generation += 1;
  activeLoad = null;
  finishPreviewReady = null;
  const uris = ownedUris();
  pair = null;

  // Remove renderable state before touching the filesystem.
  emit(INITIAL);
  for (const uri of uris) discardUri(uri);
}

function pairFromPhotos(input: {
  before: GalleryPhoto;
  after: GalleryPhoto;
}): OwnedPair | null {
  if (!input.before.metadata || !input.after.metadata) return null;
  return {
    key: `${input.before.metadata.assetId}:${input.after.metadata.assetId}`,
    before: input.before.metadata,
    after: input.after.metadata,
  };
}

function isCurrent(requestGeneration: number, sessionGeneration: number): boolean {
  return (
    requestGeneration === generation &&
    sessionGeneration === photoVaultSessionGeneration()
  );
}

function invalidateMismatchedSession(requestGeneration: number): void {
  if (requestGeneration !== generation) return;
  logPhotoVaultIssue(SCOPE, 'compareSessionInvalidated');
  invalidate();
}

async function loadSide(
  side: PhotoVaultCompareSide,
  metadata: ProgressPhoto,
  requestGeneration: number,
  sessionGeneration: number,
): Promise<boolean> {
  const existing = side === 'before' ? state.beforeFullUri : state.afterFullUri;
  if (existing) return true;

  const finish = startPhotoVaultPerf(`compare.${side}.full-load`);
  try {
    const result = await downloadProgressPhoto(metadata);
    if (!isCurrent(requestGeneration, sessionGeneration)) {
      discardUri(result.uri);
      if (requestGeneration === generation) {
        invalidateMismatchedSession(requestGeneration);
      }
      return false;
    }

    patch(
      side === 'before'
        ? { beforeFullUri: result.uri }
        : { afterFullUri: result.uri },
    );
    return true;
  } catch {
    if (requestGeneration !== generation) return false;
    if (sessionGeneration !== photoVaultSessionGeneration()) {
      invalidateMismatchedSession(requestGeneration);
      return false;
    }

    const issue: PhotoVaultIssue = 'compareFullLoadFailed';
    logPhotoVaultIssue(SCOPE, issue);
    patch({ status: 'error', failedSide: side, issue });
    finishPreviewReady = null;
    return false;
  } finally {
    finish();
  }
}

async function loadMissing(ownedPair: OwnedPair): Promise<void> {
  const requestGeneration = generation;
  const sessionGeneration = photoVaultSessionGeneration();
  patch({ status: 'loading', failedSide: null, issue: null });
  finishPreviewReady = startPhotoVaultPerf('compare.preview.ready');

  // Sequential by design. Only one encrypted byte buffer and one decrypt are
  // active at a time; the first temporary file is retained while the second
  // loads, and native bitmap decoding starts only when both URIs are ready.
  if (!(await loadSide('before', ownedPair.before, requestGeneration, sessionGeneration))) {
    return;
  }
  if (!(await loadSide('after', ownedPair.after, requestGeneration, sessionGeneration))) {
    return;
  }
  if (!isCurrent(requestGeneration, sessionGeneration)) {
    if (requestGeneration === generation) invalidateMismatchedSession(requestGeneration);
    return;
  }
  patch({ status: 'ready', failedSide: null, issue: null });
}

function startLoad(ownedPair: OwnedPair): Promise<void> {
  const operation = loadMissing(ownedPair);
  activeLoad = operation;
  void operation.finally(() => {
    if (activeLoad === operation) activeLoad = null;
  });
  return operation;
}

export function getPhotoVaultCompareState(): PhotoVaultCompareState {
  return state;
}

export function subscribeToPhotoVaultCompare(
  listener: (next: PhotoVaultCompareState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts a new pair, or returns the existing work for the same pair. */
export function loadPhotoVaultComparison(input: {
  before: GalleryPhoto;
  after: GalleryPhoto;
}): Promise<void> {
  const nextPair = pairFromPhotos(input);
  if (!nextPair) {
    invalidate();
    const issue: PhotoVaultIssue = 'compareFullLoadFailed';
    logPhotoVaultIssue(SCOPE, issue);
    emit({ ...INITIAL, status: 'error', failedSide: 'before', issue });
    return Promise.resolve();
  }

  if (pair?.key === nextPair.key) {
    if (activeLoad) return activeLoad;
    if (state.status === 'ready') return Promise.resolve();
    pair = nextPair;
    return startLoad(nextPair);
  }

  invalidate();
  pair = nextPair;
  return startLoad(nextPair);
}

/** Retries only whichever side is still missing. */
export function retryPhotoVaultComparison(): Promise<void> {
  if (!pair) return Promise.resolve();
  if (activeLoad) return activeLoad;
  if (state.status === 'ready') return Promise.resolve();
  return startLoad(pair);
}

/** Releases both full files and invalidates every outstanding result. */
export function discardPhotoVaultComparison(): void {
  invalidate();
}

/** Called after both native Image views have painted their full URI. */
export function markPhotoVaultComparePreviewReady(): void {
  if (state.status !== 'ready' || !finishPreviewReady) return;
  finishPreviewReady();
  finishPreviewReady = null;
}

subscribeToPhotoVaultStatus((status) => {
  if (status !== 'unlocked') discardPhotoVaultComparison();
});

/** Test seam. */
export function resetPhotoVaultCompareForTesting(): void {
  invalidate();
  listeners.clear();
}
