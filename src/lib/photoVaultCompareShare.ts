import * as Sharing from 'expo-sharing';

import { logPhotoVaultIssue, type PhotoVaultIssue } from './photoVaultErrors';
import {
  getPhotoVaultStatus,
  subscribeToPhotoVaultStatus,
} from './photoVaultLock';
import {
  recordPhotoVaultPerfEvent,
  startPhotoVaultPerf,
} from './photoVaultPerformance';
import {
  claimPhotoVaultComparisonExportForShare,
  settlePhotoVaultComparisonExportShare,
} from './photoVaultCompareExport';

export const PHOTO_VAULT_SHARE_MIME_TYPE = 'image/jpeg';
export const PHOTO_VAULT_SHARE_UTI = 'public.jpeg';

/**
 * `shareAsync()` resolves when the native sheet/activity returns, not when the
 * destination documents its final read. Keep the handoff lease for one small,
 * centralized grace period after resolve; native sheet lifecycle remains the
 * primary guarantee, while startup/logout remain crash/session backstops.
 */
export const PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS = 1_000;

export interface PhotoVaultCompareShareState {
  status: 'idle' | 'sharing' | 'completed' | 'error';
  issue: PhotoVaultIssue | null;
}

const SCOPE = 'photoVault.compare.share';
const INITIAL: PhotoVaultCompareShareState = { status: 'idle', issue: null };

let state: PhotoVaultCompareShareState = INITIAL;
let generation = 0;
let activeShare: {
  promise: Promise<PhotoVaultCompareShareState>;
} | null = null;
const listeners = new Set<(next: PhotoVaultCompareShareState) => void>();
const handoffListeners = new Set<(inFlight: boolean) => void>();

function emit(next: PhotoVaultCompareShareState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

function emitHandoffState(): void {
  const inFlight = activeShare !== null;
  for (const listener of handoffListeners) listener(inFlight);
}

function isCurrent(requestGeneration: number): boolean {
  return requestGeneration === generation && getPhotoVaultStatus() === 'unlocked';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(
  issue: Extract<PhotoVaultIssue, 'compareShareUnavailable' | 'compareShareFailed'>,
  requestGeneration: number,
): PhotoVaultCompareShareState {
  logPhotoVaultIssue(SCOPE, issue);
  recordPhotoVaultPerfEvent('compare.share.failed');
  if (isCurrent(requestGeneration)) emit({ status: 'error', issue });
  return state;
}

async function runShare(requestGeneration: number): Promise<PhotoVaultCompareShareState> {
  recordPhotoVaultPerfEvent('compare.share.start');

  let available: boolean;
  try {
    available = await Sharing.isAvailableAsync();
  } catch {
    return fail('compareShareUnavailable', requestGeneration);
  }
  if (!available) return fail('compareShareUnavailable', requestGeneration);
  if (!isCurrent(requestGeneration)) return state;

  const exportUri = claimPhotoVaultComparisonExportForShare();
  if (!exportUri) return fail('compareShareFailed', requestGeneration);

  const finishPromiseDuration = startPhotoVaultPerf('compare.share.duration');
  try {
    await Sharing.shareAsync(exportUri, {
      mimeType: PHOTO_VAULT_SHARE_MIME_TYPE,
      UTI: PHOTO_VAULT_SHARE_UTI,
    });
    // The Promise covers the native sheet/activity lifecycle. This margin is
    // only defense-in-depth for a destination finishing its file read.
    finishPromiseDuration();
    recordPhotoVaultPerfEvent('compare.share.complete');
    await delay(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS);
    settlePhotoVaultComparisonExportShare(exportUri, 'completed');
    if (isCurrent(requestGeneration)) emit({ status: 'completed', issue: null });
    return state;
  } catch {
    finishPromiseDuration();
    settlePhotoVaultComparisonExportShare(exportUri, 'failed');
    return fail('compareShareFailed', requestGeneration);
  }
}

export function getPhotoVaultCompareShareState(): PhotoVaultCompareShareState {
  return state;
}

export function subscribeToPhotoVaultCompareShare(
  listener: (next: PhotoVaultCompareShareState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the native share operation still owns its handoff lifecycle.
 *
 * This contains no export URI or destination information. The Vault provider
 * uses only this boolean to avoid releasing iOS screen-capture protection
 * while UIActivityViewController is still the active native presentation.
 */
export function isPhotoVaultComparisonShareInFlight(): boolean {
  return activeShare !== null;
}

export function subscribeToPhotoVaultComparisonShareInFlight(
  listener: (inFlight: boolean) => void,
): () => void {
  handoffListeners.add(listener);
  return () => handoffListeners.delete(listener);
}

/** Opens one generic native share sheet for the active branded export. */
export function sharePhotoVaultComparison(): Promise<PhotoVaultCompareShareState> {
  if (activeShare) return activeShare.promise;
  if (getPhotoVaultStatus() !== 'unlocked') {
    return Promise.resolve(fail('compareShareFailed', generation));
  }

  const requestGeneration = generation;
  emit({ status: 'sharing', issue: null });
  const promise = runShare(requestGeneration);
  const operation = { promise };
  activeShare = operation;
  emitHandoffState();
  void promise.finally(() => {
    if (activeShare === operation) {
      activeShare = null;
      emitHandoffState();
    }
  });
  return promise;
}

/**
 * Invalidates only UI state. An already-started native handoff deliberately
 * keeps running and retains its leased JPEG until its Promise + grace settle.
 */
export function discardPhotoVaultComparisonShare(): void {
  generation += 1;
  emit(INITIAL);
}

subscribeToPhotoVaultStatus((status) => {
  if (status !== 'unlocked') discardPhotoVaultComparisonShare();
});

/** Test seam. */
export function resetPhotoVaultCompareShareForTesting(): void {
  generation += 1;
  state = INITIAL;
  activeShare = null;
  listeners.clear();
  handoffListeners.clear();
}
