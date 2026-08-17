import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  discard: vi.fn(),
  logError: vi.fn(),
  perf: vi.fn(() => vi.fn()),
  lockListeners: [] as ((status: string) => void)[],
  sessionGeneration: 7,
}));

vi.mock('../../services/progressPhotos', () => ({
  downloadProgressPhoto: mocks.download,
}));

vi.mock('../../services/photoVaultFileCrypto', () => ({
  discardDecryptedPhoto: mocks.discard,
}));

vi.mock('../photoVaultLock', () => ({
  subscribeToPhotoVaultStatus: (listener: (status: string) => void) => {
    mocks.lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('../photoVaultSession', () => ({
  photoVaultSessionGeneration: () => mocks.sessionGeneration,
}));

vi.mock('../photoVaultPerformance', () => ({
  startPhotoVaultPerf: mocks.perf,
}));

vi.mock('../logger', () => ({ logError: mocks.logError }));

import type { GalleryPhoto } from '../photoVaultGallery';
import {
  discardPhotoVaultComparison,
  getPhotoVaultCompareState,
  loadPhotoVaultComparison,
  markPhotoVaultComparePreviewReady,
  resetPhotoVaultCompareForTesting,
  retryPhotoVaultComparison,
  subscribeToPhotoVaultCompare,
} from '../photoVaultCompareController';

const IV = 'YWJjZGVmZ2hpamts';

function photo(id: string): GalleryPhoto {
  const metadata = {
    photoId: id,
    assetId: `asset-${id}`,
    storagePath: `users/alice/progressPhotos/asset-${id}.enc`,
    takenAt: new Date(`2026-0${id === 'before' ? '1' : '8'}-12T12:00:00Z`),
    createdAt: null,
    originalMimeType: 'image/jpeg',
    encryptedSize: 2048,
    encryption: {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: IV,
      vaultKeyVersion: 1,
    },
  };
  return {
    photoId: id,
    assetId: metadata.assetId,
    takenAt: metadata.takenAt,
    metadata,
    thumbnailUri: `data:image/jpeg;base64,${id}`,
    fullUri: null,
    previewUri: null,
    thumbnailLoading: false,
    fullLoading: false,
    failed: false,
    uploadStatus: null,
    uploadProgress: null,
  };
}

function resultFor(entry: GalleryPhoto) {
  return {
    uri: `file:///cache/photo-vault/tmp/${entry.photoId}.jpg`,
    size: 1200,
    photo: entry.metadata,
  };
}

const before = photo('before');
const after = photo('after');

function emitLock(): void {
  for (const listener of mocks.lockListeners) listener('locked');
}

beforeEach(() => {
  resetPhotoVaultCompareForTesting();
  vi.clearAllMocks();
  mocks.sessionGeneration = 7;
  mocks.download.mockImplementation(async (metadata: GalleryPhoto['metadata']) => ({
    uri: `file:///cache/photo-vault/tmp/${metadata?.photoId}.jpg`,
    size: 1200,
    photo: metadata,
  }));
});

describe('independent full loading', () => {
  it('loads before and after through the secure loader, sequentially', async () => {
    let resolveBefore: (value: unknown) => void = () => {};
    let resolveAfter: (value: unknown) => void = () => {};
    mocks.download
      .mockReturnValueOnce(new Promise((resolve) => { resolveBefore = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveAfter = resolve; }));

    const pending = loadPhotoVaultComparison({ before, after });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenNthCalledWith(1, before.metadata);

    resolveBefore(resultFor(before));
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2));
    expect(mocks.download).toHaveBeenNthCalledWith(2, after.metadata);

    resolveAfter(resultFor(after));
    await pending;

    expect(getPhotoVaultCompareState()).toMatchObject({
      status: 'ready',
      beforeFullUri: resultFor(before).uri,
      afterFullUri: resultFor(after).uri,
    });
  });

  it('owns two distinct temporary URIs', async () => {
    await loadPhotoVaultComparison({ before, after });

    const state = getPhotoVaultCompareState();
    expect(state.beforeFullUri).toBe(resultFor(before).uri);
    expect(state.afterFullUri).toBe(resultFor(after).uri);
    expect(state.beforeFullUri).not.toBe(state.afterFullUri);
  });

  it('does not reload a ready pair in the same comparison session', async () => {
    await loadPhotoVaultComparison({ before, after });
    await loadPhotoVaultComparison({ before, after });

    expect(mocks.download).toHaveBeenCalledTimes(2);
  });

  it('publishes loading and ready states to subscribers', async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToPhotoVaultCompare((next) => seen.push(next.status));

    await loadPhotoVaultComparison({ before, after });
    unsubscribe();

    expect(seen).toContain('loading');
    expect(seen.at(-1)).toBe('ready');
  });
});

describe('cleanup and invalidation', () => {
  it('releases both URIs when the comparator closes', async () => {
    await loadPhotoVaultComparison({ before, after });

    discardPhotoVaultComparison();

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(mocks.discard).toHaveBeenCalledWith(resultFor(after).uri);
    expect(getPhotoVaultCompareState()).toEqual({
      status: 'idle',
      beforeFullUri: null,
      afterFullUri: null,
      failedSide: null,
      issue: null,
    });
  });

  it('releases both URIs synchronously on lock', async () => {
    await loadPhotoVaultComparison({ before, after });

    emitLock();

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(mocks.discard).toHaveBeenCalledWith(resultFor(after).uri);
    expect(getPhotoVaultCompareState().status).toBe('idle');
  });

  it('releases the previous pair before loading a changed selection', async () => {
    await loadPhotoVaultComparison({ before, after });
    const changedAfter = photo('changed-after');

    await loadPhotoVaultComparison({ before, after: changedAfter });

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(mocks.discard).toHaveBeenCalledWith(resultFor(after).uri);
    expect(getPhotoVaultCompareState().afterFullUri).toBe(resultFor(changedAfter).uri);
  });

  it('discards a result that arrives after close without repopulating state', async () => {
    let resolveBefore: (value: unknown) => void = () => {};
    mocks.download.mockReturnValueOnce(
      new Promise((resolve) => { resolveBefore = resolve; }),
    );
    const pending = loadPhotoVaultComparison({ before, after });

    discardPhotoVaultComparison();
    resolveBefore(resultFor(before));
    await pending;

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(getPhotoVaultCompareState().beforeFullUri).toBeNull();
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('discards a result that arrives after lock without repopulating state', async () => {
    let resolveBefore: (value: unknown) => void = () => {};
    mocks.download.mockReturnValueOnce(
      new Promise((resolve) => { resolveBefore = resolve; }),
    );
    const pending = loadPhotoVaultComparison({ before, after });

    emitLock();
    resolveBefore(resultFor(before));
    await pending;

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(getPhotoVaultCompareState().beforeFullUri).toBeNull();
    expect(getPhotoVaultCompareState().status).toBe('idle');
  });

  it('releases before and discards a late after when lock interrupts the second load', async () => {
    let resolveAfter: (value: unknown) => void = () => {};
    mocks.download
      .mockResolvedValueOnce(resultFor(before))
      .mockReturnValueOnce(new Promise((resolve) => { resolveAfter = resolve; }));
    const pending = loadPhotoVaultComparison({ before, after });
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2));

    emitLock();
    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    resolveAfter(resultFor(after));
    await pending;

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(after).uri);
    expect(getPhotoVaultCompareState()).toMatchObject({
      status: 'idle',
      beforeFullUri: null,
      afterFullUri: null,
    });
  });

  it('discards a late result from an older pair', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.download.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const oldLoad = loadPhotoVaultComparison({ before, after });

    const changedBefore = photo('changed-before');
    const newLoad = loadPhotoVaultComparison({ before: changedBefore, after });
    await newLoad;
    resolveOld(resultFor(before));
    await oldLoad;

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(getPhotoVaultCompareState().beforeFullUri).toBe(resultFor(changedBefore).uri);
  });

  it('rejects a result from another Vault session', async () => {
    let resolveBefore: (value: unknown) => void = () => {};
    mocks.download.mockReturnValueOnce(new Promise((resolve) => { resolveBefore = resolve; }));
    const pending = loadPhotoVaultComparison({ before, after });

    mocks.sessionGeneration += 1;
    resolveBefore(resultFor(before));
    await pending;

    expect(mocks.discard).toHaveBeenCalledWith(resultFor(before).uri);
    expect(getPhotoVaultCompareState().status).toBe('idle');
    expect(mocks.logError).toHaveBeenCalledWith(
      'photoVault:photoVault.compare',
      expect.objectContaining({ message: 'compareSessionInvalidated' }),
      { issue: 'compareSessionInvalidated' },
    );
  });
});

describe('controlled errors and retry', () => {
  it('reports a controlled before failure', async () => {
    mocks.download.mockRejectedValueOnce(new Error('storage/private-provider-detail'));

    await loadPhotoVaultComparison({ before, after });

    expect(getPhotoVaultCompareState()).toMatchObject({
      status: 'error',
      failedSide: 'before',
      issue: 'compareFullLoadFailed',
      beforeFullUri: null,
      afterFullUri: null,
    });
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('keeps before owned when after fails', async () => {
    mocks.download
      .mockResolvedValueOnce(resultFor(before))
      .mockRejectedValueOnce(new Error('offline'));

    await loadPhotoVaultComparison({ before, after });

    expect(getPhotoVaultCompareState()).toMatchObject({
      status: 'error',
      failedSide: 'after',
      beforeFullUri: resultFor(before).uri,
      afterFullUri: null,
    });
    expect(mocks.discard).not.toHaveBeenCalledWith(resultFor(before).uri);
  });

  it('retries only the missing side', async () => {
    mocks.download
      .mockResolvedValueOnce(resultFor(before))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(resultFor(after));

    await loadPhotoVaultComparison({ before, after });
    await retryPhotoVaultComparison();

    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.download.mock.calls.filter(([metadata]) => metadata === before.metadata)).toHaveLength(1);
    expect(getPhotoVaultCompareState().status).toBe('ready');
  });

  it('retries from before and then continues to after', async () => {
    mocks.download
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(resultFor(before))
      .mockResolvedValueOnce(resultFor(after));

    await loadPhotoVaultComparison({ before, after });
    await retryPhotoVaultComparison();

    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.download).toHaveBeenNthCalledWith(2, before.metadata);
    expect(mocks.download).toHaveBeenNthCalledWith(3, after.metadata);
    expect(getPhotoVaultCompareState().status).toBe('ready');
  });

  it('records only sanitized comparison timing labels', async () => {
    await loadPhotoVaultComparison({ before, after });
    markPhotoVaultComparePreviewReady();

    expect(mocks.perf).toHaveBeenCalledWith('compare.before.full-load');
    expect(mocks.perf).toHaveBeenCalledWith('compare.after.full-load');
    expect(mocks.perf).toHaveBeenCalledWith('compare.preview.ready');
    expect(JSON.stringify(mocks.perf.mock.calls)).not.toContain(before.assetId);
    expect(JSON.stringify(mocks.perf.mock.calls)).not.toContain(after.assetId);
  });
});

describe('structural isolation', () => {
  const source = readFileSync('src/lib/photoVaultCompareController.ts', 'utf8');

  it('uses the secure full loader directly', () => {
    expect(source).toContain('downloadProgressPhoto(metadata)');
  });

  it.each([
    'viewerOwnerId',
    'claimGalleryPhotoForViewer',
    'ensureFullPhotoLoaded',
    'fullLru',
  ])('does not contain the gallery full symbol %s', (symbol) => {
    expect(source).not.toContain(symbol);
  });

  it.each([
    'firebase/firestore',
    'firebase/storage',
    'getDownloadURL',
    'expo-sharing',
    'react-native-view-shot',
    'expo-image',
    'createPhotoVaultShareFilePath',
  ])('does not reach for %s', (symbol) => {
    expect(source).not.toContain(symbol);
  });
});
