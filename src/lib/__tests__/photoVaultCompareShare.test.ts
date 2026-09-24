import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  share: vi.fn(),
  claim: vi.fn(),
  settle: vi.fn(),
  vaultStatus: 'unlocked',
  lockListeners: [] as ((status: string) => void)[],
  logError: vi.fn(),
  perfEvent: vi.fn(),
  perfFinish: vi.fn(),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: mocks.available,
  shareAsync: mocks.share,
}));

vi.mock('../photoVaultCompareExport', () => ({
  claimPhotoVaultComparisonExportForShare: mocks.claim,
  settlePhotoVaultComparisonExportShare: mocks.settle,
}));

vi.mock('../photoVaultLock', () => ({
  getPhotoVaultStatus: () => mocks.vaultStatus,
  subscribeToPhotoVaultStatus: (listener: (status: string) => void) => {
    mocks.lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('../photoVaultPerformance', () => ({
  startPhotoVaultPerf: vi.fn(() => mocks.perfFinish),
  recordPhotoVaultPerfEvent: mocks.perfEvent,
}));

vi.mock('../logger', () => ({ logError: mocks.logError }));

import {
  PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS,
  PHOTO_VAULT_SHARE_MIME_TYPE,
  PHOTO_VAULT_SHARE_UTI,
  discardPhotoVaultComparisonShare,
  getPhotoVaultCompareShareState,
  isPhotoVaultComparisonShareInFlight,
  resetPhotoVaultCompareShareForTesting,
  sharePhotoVaultComparison,
  subscribeToPhotoVaultCompareShare,
  subscribeToPhotoVaultComparisonShareInFlight,
} from '../photoVaultCompareShare';

const EXPORT_URI =
  'file:///cache/photo-vault/share/11111111-1111-4111-8111-111111111111.jpg';

function emitLock(): void {
  mocks.vaultStatus = 'locked';
  for (const listener of mocks.lockListeners) listener('locked');
}

beforeEach(() => {
  resetPhotoVaultCompareShareForTesting();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.vaultStatus = 'unlocked';
  mocks.available.mockResolvedValue(true);
  mocks.share.mockResolvedValue(undefined);
  mocks.claim.mockReturnValue(EXPORT_URI);
});

async function finishSuccessfulShare(
  pending: Promise<ReturnType<typeof getPhotoVaultCompareShareState>>,
): Promise<void> {
  await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS);
  await pending;
}

describe('generic native share handoff', () => {
  it('checks availability and shares the active 15E JPEG once', async () => {
    vi.useFakeTimers();

    const pending = sharePhotoVaultComparison();
    await finishSuccessfulShare(pending);

    expect(mocks.available).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledWith(EXPORT_URI, {
      mimeType: 'image/jpeg',
      UTI: 'public.jpeg',
    });
    expect(mocks.settle).toHaveBeenCalledWith(EXPORT_URI, 'completed');
  });

  it('keeps the MIME, UTI and grace period as closed constants', () => {
    expect(PHOTO_VAULT_SHARE_MIME_TYPE).toBe('image/jpeg');
    expect(PHOTO_VAULT_SHARE_UTI).toBe('public.jpeg');
    expect(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS).toBe(1_000);
  });

  it('publishes sharing then completed after cleanup', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const unsubscribe = subscribeToPhotoVaultCompareShare((next) => {
      seen.push(next.status);
    });

    const pending = sharePhotoVaultComparison();
    await finishSuccessfulShare(pending);
    unsubscribe();

    expect(seen).toEqual(['sharing', 'completed']);
  });

  it('treats a resolved Promise as completed or cancelled without inventing a distinction', async () => {
    vi.useFakeTimers();

    const pending = sharePhotoVaultComparison();
    await finishSuccessfulShare(pending);

    expect(getPhotoVaultCompareShareState()).toEqual({
      status: 'completed',
      issue: null,
    });
  });

  it('records sanitized lifecycle and Promise duration events', async () => {
    vi.useFakeTimers();

    const pending = sharePhotoVaultComparison();
    await finishSuccessfulShare(pending);

    expect(mocks.perfEvent).toHaveBeenCalledWith('compare.share.start');
    expect(mocks.perfEvent).toHaveBeenCalledWith('compare.share.complete');
    expect(mocks.perfFinish).toHaveBeenCalledTimes(1);
  });
});

describe('availability and failure', () => {
  it('reports unavailable without opening the sheet or consuming the export', async () => {
    mocks.available.mockResolvedValueOnce(false);

    const result = await sharePhotoVaultComparison();

    expect(result).toEqual({
      status: 'error',
      issue: 'compareShareUnavailable',
    });
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it('maps an availability rejection without exposing its raw error', async () => {
    mocks.available.mockRejectedValueOnce(new Error('native private detail'));

    await sharePhotoVaultComparison();

    expect(getPhotoVaultCompareShareState().issue).toBe('compareShareUnavailable');
    expect(mocks.logError).toHaveBeenCalledWith(
      'photoVault:photoVault.compare.share',
      expect.objectContaining({ message: 'compareShareUnavailable' }),
      { issue: 'compareShareUnavailable' },
    );
  });

  it('keeps the leased JPEG for retry after shareAsync rejects', async () => {
    mocks.share.mockRejectedValueOnce(new Error('destination private detail'));

    const result = await sharePhotoVaultComparison();

    expect(result).toEqual({ status: 'error', issue: 'compareShareFailed' });
    expect(mocks.settle).toHaveBeenCalledWith(EXPORT_URI, 'failed');
  });

  it('retries with the same export URI and never calls capture or download', async () => {
    mocks.share
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    await sharePhotoVaultComparison();
    await sharePhotoVaultComparison();

    expect(mocks.share).toHaveBeenCalledTimes(2);
    expect(mocks.share).toHaveBeenNthCalledWith(1, EXPORT_URI, expect.any(Object));
    expect(mocks.share).toHaveBeenNthCalledWith(2, EXPORT_URI, expect.any(Object));
  });

  it('fails closed when no active branded export can be leased', async () => {
    mocks.claim.mockReturnValueOnce(null);

    await sharePhotoVaultComparison();

    expect(mocks.share).not.toHaveBeenCalled();
    expect(getPhotoVaultCompareShareState().issue).toBe('compareShareFailed');
  });
});

describe('concurrency and private lifecycle', () => {
  it('coalesces repeated taps into one native share sheet', async () => {
    vi.useFakeTimers();
    let resolveShare: () => void = () => {};
    mocks.share.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveShare = resolve; }),
    );

    const first = sharePhotoVaultComparison();
    const second = sharePhotoVaultComparison();
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    resolveShare();
    await vi.advanceTimersByTimeAsync(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS);
    await Promise.all([first, second]);

    expect(mocks.available).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledTimes(1);
  });

  it('does not start the handoff when lock happens during availability', async () => {
    let resolveAvailability: (available: boolean) => void = () => {};
    mocks.available.mockReturnValueOnce(
      new Promise<boolean>((resolve) => { resolveAvailability = resolve; }),
    );
    const pending = sharePhotoVaultComparison();

    emitLock();
    resolveAvailability(true);
    await pending;

    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
    expect(getPhotoVaultCompareShareState().status).toBe('idle');
  });

  it('keeps handoff ownership through lock and cleans only after resolve plus grace', async () => {
    vi.useFakeTimers();
    let resolveShare: () => void = () => {};
    mocks.share.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveShare = resolve; }),
    );
    const pending = sharePhotoVaultComparison();
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));

    expect(isPhotoVaultComparisonShareInFlight()).toBe(true);
    emitLock();
    expect(isPhotoVaultComparisonShareInFlight()).toBe(true);
    expect(mocks.settle).not.toHaveBeenCalled();
    resolveShare();
    await vi.advanceTimersByTimeAsync(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS - 1);
    expect(isPhotoVaultComparisonShareInFlight()).toBe(true);
    expect(mocks.settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(mocks.settle).toHaveBeenCalledWith(EXPORT_URI, 'completed');
    expect(isPhotoVaultComparisonShareInFlight()).toBe(false);
    expect(getPhotoVaultCompareShareState().status).toBe('idle');
  });

  it('publishes a sanitized handoff signal for active → lock → active coordination', async () => {
    vi.useFakeTimers();
    let resolveShare: () => void = () => {};
    mocks.share.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveShare = resolve; }),
    );
    const seen: boolean[] = [];
    const unsubscribe = subscribeToPhotoVaultComparisonShareInFlight((inFlight) => {
      seen.push(inFlight);
    });

    const pending = sharePhotoVaultComparison();
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
    emitLock();
    resolveShare();
    await vi.advanceTimersByTimeAsync(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS);
    await pending;
    unsubscribe();

    expect(seen).toEqual([true, false]);
  });

  it('keeps handoff ownership when the comparator closes mid-share', async () => {
    vi.useFakeTimers();
    let resolveShare: () => void = () => {};
    mocks.share.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveShare = resolve; }),
    );
    const pending = sharePhotoVaultComparison();
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));

    discardPhotoVaultComparisonShare();
    expect(mocks.settle).not.toHaveBeenCalled();
    resolveShare();
    await vi.advanceTimersByTimeAsync(PHOTO_VAULT_SHARE_CLEANUP_GRACE_MS);
    await pending;

    expect(mocks.settle).toHaveBeenCalledWith(EXPORT_URI, 'completed');
    expect(getPhotoVaultCompareShareState().status).toBe('idle');
  });

  it('does not call native sharing while already locked', async () => {
    mocks.vaultStatus = 'locked';

    await sharePhotoVaultComparison();

    expect(mocks.available).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });
});

describe('structural boundaries', () => {
  const source = readFileSync('src/lib/photoVaultCompareShare.ts', 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('uses only the generic Expo sharing API and the 15E export lease', () => {
    expect(code).toContain("from 'expo-sharing'");
    expect(code).toContain('Sharing.isAvailableAsync()');
    expect(code).toContain('Sharing.shareAsync(exportUri');
    expect(code).toContain('claimPhotoVaultComparisonExportForShare()');
  });

  it('pins the audited Expo module and its native sheet implementations', () => {
    const packageJson = JSON.parse(
      readFileSync('node_modules/expo-sharing/package.json', 'utf8'),
    ) as { version: string };
    const ios = readFileSync('node_modules/expo-sharing/ios/SharingModule.swift', 'utf8');
    const android = readFileSync(
      'node_modules/expo-sharing/android/src/main/java/expo/modules/sharing/SharingModule.kt',
      'utf8',
    );

    expect(packageJson.version).toBe('57.0.21');
    expect(ios).toContain('UIActivityViewController');
    expect(ios).toContain('completionWithItemsHandler');
    expect(ios).toContain('promise.resolve(nil)');
    expect(android).toContain('FileProvider.getUriForFile');
    expect(android).toContain('Intent.ACTION_SEND');
    expect(android).toContain('FLAG_GRANT_READ_URI_PERMISSION');
    expect(android).toContain('OnActivityResult');
  });

  it('never shares either private full, a thumbnail, or a Storage URL', () => {
    for (const prohibited of [
      'beforeFullUri',
      'afterFullUri',
      'thumbnailUri',
      'downloadProgressPhoto',
      'captureRef',
      'getDownloadURL',
    ]) {
      expect(code).not.toContain(prohibited);
    }
  });

  it('contains no destination SDK, target detection, upload or base64 path', () => {
    for (const prohibited of [
      'instagram-stories://',
      'Instagram',
      'WhatsApp',
      'Telegram',
      'Linking',
      'canOpenURL',
      'MediaLibrary',
      'firebase/firestore',
      'firebase/storage',
      'base64',
    ]) {
      expect(code).not.toContain(prohibited);
    }
  });

  it('leaves crash recovery and logout cleanup in their existing owners', () => {
    const app = readFileSync('App.tsx', 'utf8');
    const context = readFileSync('src/state/PhotoVaultContext.tsx', 'utf8');
    expect(app).toContain('cleanupPhotoVaultShareFiles()');
    expect(context).toContain('cleanupPhotoVaultShareFiles();');
    expect(code).not.toContain('cleanupPhotoVaultShareFiles');
  });

  it('does not change the global lock/session implementations', () => {
    expect(code).not.toContain('lockPhotoVault');
    expect(code).not.toContain('closePhotoVaultSession');
    expect(code).not.toContain('cleanupPhotoVaultTempFiles');
  });
});
