import type { RefObject } from 'react';
import { File } from 'expo-file-system';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import {
  getPhotoVaultStatus,
  subscribeToPhotoVaultStatus,
} from './photoVaultLock';
import {
  recordPhotoVaultPerfEvent,
  startPhotoVaultPerf,
} from './photoVaultPerformance';
import { photoVaultSessionGeneration } from './photoVaultSession';
import { getPhotoVaultCompareState } from './photoVaultCompareController';
import {
  createPhotoVaultShareFilePath,
  discardPhotoVaultShareFile,
} from '../services/photoVaultFileCrypto';

/** Native capture bitmap: 1080×1920×4 bytes ≈ 7.91 MiB before JPEG encoding. */
export const PHOTO_VAULT_COMPARE_EXPORT_WIDTH = 1080;
export const PHOTO_VAULT_COMPARE_EXPORT_HEIGHT = 1920;
export const PHOTO_VAULT_COMPARE_EXPORT_QUALITY = 0.88;

export interface PhotoVaultCompareCaptureSize {
  width: number;
  height: number;
}

export interface PhotoVaultCompareExportState {
  status: 'idle' | 'capturing' | 'ready' | 'error';
  exportUri: string | null;
  fileSize: number | null;
  issue: PhotoVaultIssue | null;
}

export interface CapturePhotoVaultComparisonInput {
  posterRef: RefObject<View | null>;
  posterReady: boolean;
  logoReady: boolean;
  beforeFullUri: string | null;
  afterFullUri: string | null;
}

const SCOPE = 'photoVault.compare.capture';
const INITIAL: PhotoVaultCompareExportState = {
  status: 'idle',
  exportUri: null,
  fileSize: null,
  issue: null,
};

let state: PhotoVaultCompareExportState = INITIAL;
let generation = 0;
let activeCapture: {
  generation: number;
  promise: Promise<PhotoVaultCompareExportState>;
} | null = null;
/** One explicit handoff lease; the share controller is the temporary owner. */
let shareLeaseUri: string | null = null;
const listeners = new Set<(next: PhotoVaultCompareExportState) => void>();

function emit(next: PhotoVaultCompareExportState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

function failCapture(): PhotoVaultCompareExportState {
  const issue: PhotoVaultIssue = 'compareCaptureFailed';
  logPhotoVaultIssue(SCOPE, issue);
  recordPhotoVaultPerfEvent('compare.capture.failed');
  emit({ ...state, status: 'error', issue });
  return state;
}

function releaseViewShotFile(uri: string | null): void {
  if (!uri) return;
  try {
    // react-native-view-shot validates this path natively: only its own
    // ReactNative tmp directory (iOS) or direct cache child (Android) can be
    // removed. It is intentionally separate from share/'s stricter cleanup.
    releaseCapture(uri);
  } catch {
    // Best effort. The library also sweeps its tmp files when it invalidates.
  }
}

function discardUnlessShareOwned(uri: string): void {
  if (shareLeaseUri !== uri) discardPhotoVaultShareFile(uri);
}

function viewShotFileUri(uri: string): string {
  // Android resolves `file://…`; iOS 5.1.0 resolves an absolute POSIX path.
  // Expo FileSystem's File constructor requires a URI on both platforms.
  if (uri.startsWith('file://')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  throw new Error('invalid view-shot tmpfile');
}

function captureIsCurrent(
  requestGeneration: number,
  sessionGeneration: number,
): boolean {
  return (
    requestGeneration === generation &&
    sessionGeneration === photoVaultSessionGeneration() &&
    getPhotoVaultStatus() === 'unlocked'
  );
}

/**
 * v5.1.0 treats output dimensions differently on the two native platforms.
 * Android scales the final Bitmap directly to the supplied pixel dimensions.
 * iOS passes them to UIGraphicsImageRenderer as points and uses device scale,
 * so Expo's SDK 56 guidance applies: divide desired physical pixels by the
 * PixelRatio. Standard iOS ratios (2x/3x) therefore produce exactly 1080x1920.
 */
export function photoVaultComparisonCaptureSize(
  platform: typeof Platform.OS = Platform.OS,
  pixelRatio = PixelRatio.get(),
): PhotoVaultCompareCaptureSize {
  if (platform === 'ios') {
    const safeRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    return {
      width: PHOTO_VAULT_COMPARE_EXPORT_WIDTH / safeRatio,
      height: PHOTO_VAULT_COMPARE_EXPORT_HEIGHT / safeRatio,
    };
  }
  return {
    width: PHOTO_VAULT_COMPARE_EXPORT_WIDTH,
    height: PHOTO_VAULT_COMPARE_EXPORT_HEIGHT,
  };
}

function preconditionsMet(input: CapturePhotoVaultComparisonInput): boolean {
  const full = getPhotoVaultCompareState();
  return (
    getPhotoVaultStatus() === 'unlocked' &&
    full.status === 'ready' &&
    input.beforeFullUri !== null &&
    input.afterFullUri !== null &&
    full.beforeFullUri === input.beforeFullUri &&
    full.afterFullUri === input.afterFullUri &&
    input.posterRef.current !== null &&
    input.posterReady &&
    input.logoReady
  );
}

async function runCapture(
  input: CapturePhotoVaultComparisonInput,
  requestGeneration: number,
  sessionGeneration: number,
): Promise<PhotoVaultCompareExportState> {
  let viewShotUri: string | null = null;
  let reservedShareUri: string | null = null;
  const previousExportUri = state.exportUri;
  const finishDuration = startPhotoVaultPerf('compare.capture.duration');
  recordPhotoVaultPerfEvent('compare.capture.start');

  try {
    const size = photoVaultComparisonCaptureSize();
    viewShotUri = await captureRef(input.posterRef, {
      width: size.width,
      height: size.height,
      format: 'jpg',
      quality: PHOTO_VAULT_COMPARE_EXPORT_QUALITY,
      result: 'tmpfile',
    });

    if (!captureIsCurrent(requestGeneration, sessionGeneration)) return state;

    reservedShareUri = createPhotoVaultShareFilePath('.jpg').uri;
    const source = new File(viewShotFileUri(viewShotUri));
    const target = new File(reservedShareUri);
    if (!source.exists || (source.size ?? 0) <= 0) throw new Error('empty capture');

    // Native file-to-file copy keeps the JPEG out of JS memory. The only
    // plaintext copies are view-shot's owned tmpfile and this share/ target.
    await source.copy(target);
    const fileSize = target.size ?? 0;
    if (!target.exists || fileSize <= 0) throw new Error('empty export');

    if (!captureIsCurrent(requestGeneration, sessionGeneration)) {
      discardPhotoVaultShareFile(reservedShareUri);
      reservedShareUri = null;
      return state;
    }

    const next: PhotoVaultCompareExportState = {
      status: 'ready',
      exportUri: reservedShareUri,
      fileSize,
      issue: null,
    };
    reservedShareUri = null;
    emit(next);
    recordPhotoVaultPerfEvent('compare.capture.complete', { bytes: fileSize });

    // A recapture becomes the owner only after the replacement exists and is
    // valid. Until this point the previous successful JPEG remains available.
    if (previousExportUri && previousExportUri !== next.exportUri) {
      discardUnlessShareOwned(previousExportUri);
    }
    return state;
  } catch {
    if (reservedShareUri) discardPhotoVaultShareFile(reservedShareUri);
    if (!captureIsCurrent(requestGeneration, sessionGeneration)) return state;
    return failCapture();
  } finally {
    releaseViewShotFile(viewShotUri);
    finishDuration();
  }
}

export function getPhotoVaultCompareExportState(): PhotoVaultCompareExportState {
  return state;
}

export function subscribeToPhotoVaultCompareExport(
  listener: (next: PhotoVaultCompareExportState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Captures the branded poster once; concurrent taps share this operation. */
export function capturePhotoVaultComparison(
  input: CapturePhotoVaultComparisonInput,
): Promise<PhotoVaultCompareExportState> {
  if (activeCapture?.generation === generation) return activeCapture.promise;
  if (!preconditionsMet(input)) return Promise.resolve(failCapture());

  const requestGeneration = generation;
  const sessionGeneration = photoVaultSessionGeneration();
  emit({ ...state, status: 'capturing', issue: null });
  const promise = runCapture(input, requestGeneration, sessionGeneration);
  const operation = { generation: requestGeneration, promise };
  activeCapture = operation;
  void promise.finally(() => {
    if (activeCapture === operation) activeCapture = null;
  });
  return promise;
}

/**
 * Transfers temporary ownership of the current branded JPEG to one native
 * share handoff. The URI is minted by this controller; callers cannot lease
 * an arbitrary path or either private full image.
 */
export function claimPhotoVaultComparisonExportForShare(): string | null {
  if (
    shareLeaseUri !== null ||
    getPhotoVaultStatus() !== 'unlocked' ||
    state.status !== 'ready' ||
    state.exportUri === null
  ) {
    return null;
  }
  shareLeaseUri = state.exportUri;
  return shareLeaseUri;
}

/**
 * Ends the OS handoff lease. A completed/cancelled sheet consumes the export.
 * A real failure keeps it only while the comparator still owns that exact URI,
 * allowing retry without capture; close/lock makes the same failure clean up.
 */
export function settlePhotoVaultComparisonExportShare(
  uri: string,
  outcome: 'completed' | 'failed',
): void {
  if (shareLeaseUri !== uri) return;
  shareLeaseUri = null;
  const comparatorStillOwns = state.exportUri === uri;

  if (outcome === 'completed' && comparatorStillOwns) emit(INITIAL);
  if (outcome === 'completed' || !comparatorStillOwns) {
    discardPhotoVaultShareFile(uri);
  }
}

/** Releases this comparator's one active export; never sweeps share/ globally. */
export function discardPhotoVaultComparisonExport(): void {
  generation += 1;
  const ownedUri = state.exportUri;
  emit(INITIAL);
  if (ownedUri) discardUnlessShareOwned(ownedUri);
}

subscribeToPhotoVaultStatus((status) => {
  if (status !== 'unlocked') discardPhotoVaultComparisonExport();
});

/** Test seam. */
export function resetPhotoVaultCompareExportForTesting(): void {
  const leasedUri = shareLeaseUri;
  const ownedUri = state.exportUri;
  shareLeaseUri = null;
  discardPhotoVaultComparisonExport();
  if (leasedUri && leasedUri !== ownedUri) discardPhotoVaultShareFile(leasedUri);
  activeCapture = null;
  listeners.clear();
}
