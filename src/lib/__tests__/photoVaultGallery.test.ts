import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  downloadThumbnail: vi.fn(),
  reconcile: vi.fn(),
  downloadFull: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  discard: vi.fn(),
  lockListeners: [] as ((status: string) => void)[],
}));

vi.mock('../../services/progressPhotos', () => ({
  listProgressPhotos: mocks.list,
  reconcileProgressPhotoCache: mocks.reconcile,
  downloadProgressPhotoThumbnail: mocks.downloadThumbnail,
  downloadProgressPhoto: mocks.downloadFull,
  uploadProgressPhoto: mocks.upload,
  deleteProgressPhoto: mocks.remove,
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

import { PhotoVaultError } from '../photoVaultErrors';
import {
  MAX_CONCURRENT_THUMBNAIL_DOWNLOADS,
  MAX_FULL_CACHE_ENTRIES,
  MAX_THUMBNAIL_CACHE_ENTRIES,
  addGalleryPhoto,
  claimGalleryPhotoForViewer,
  discardDecryptedPhotos,
  getGalleryState,
  loadGallery,
  mountGalleryPhoto,
  releaseGalleryPhotoFromViewer,
  removeGalleryPhoto,
  resetGalleryForTesting,
  subscribeToGallery,
  unmountGalleryPhoto,
} from '../photoVaultGallery';

const IV = 'YWJjZGVmZ2hpamts';
const THUMB_IV = 'bW5vcHFyc3R1dnd4';

function photo(id: string, daysAgo = 0, withThumbnail = true) {
  const base = {
    photoId: id,
    takenAt: new Date(Date.now() - daysAgo * 86_400_000),
    storagePath: `users/alice/progressPhotos/${id}.enc`,
    createdAt: null,
    originalMimeType: 'image/jpeg',
    encryptedSize: 2048,
    encryption: { version: 1, algorithm: 'AES-256-GCM', iv: IV, vaultKeyVersion: 1 },
  };
  return withThumbnail
    ? {
        ...base,
        thumbnailStoragePath: `users/alice/progressPhotos/${id}.thumb.enc`,
        thumbnailEncryptedSize: 256,
        thumbnailEncryption: {
          version: 1,
          algorithm: 'AES-256-GCM',
          iv: THUMB_IV,
          vaultKeyVersion: 1,
        },
      }
    : base;
}

const UPLOAD = {
  sourceUri: 'file:///cache/photo-vault/tmp/pic.jpg',
  takenAt: new Date('2026-08-01T10:00:00Z'),
  originalMimeType: 'image/jpeg' as const,
  width: 1200,
  height: 1600,
};

function emitLock(status: string): void {
  for (const listener of mocks.lockListeners) listener(status);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGalleryForTesting();
  mocks.list.mockResolvedValue([photo('a'), photo('b', 1)]);
  mocks.downloadThumbnail.mockImplementation(async (metadata: ReturnType<typeof photo>) => ({
    dataUri: `data:image/jpeg;base64,THUMB-${metadata.photoId}`,
    photo: metadata,
    isFullImage: false,
  }));
  mocks.downloadFull.mockImplementation(async (metadata: ReturnType<typeof photo>) => ({
    uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
    size: 1200,
    photo: metadata,
  }));
  mocks.upload.mockResolvedValue(photo('new'));
  mocks.remove.mockResolvedValue(undefined);
});

describe('metadata and thumbnail loading', () => {
  it('renders metadata without eagerly downloading thumbnails or full images', async () => {
    await loadGallery();

    expect(getGalleryState().status).toBe('ready');
    expect(getGalleryState().photos).toHaveLength(2);
    expect(mocks.downloadThumbnail).not.toHaveBeenCalled();
    expect(mocks.downloadFull).not.toHaveBeenCalled();
  });

  it('loads only the encrypted thumbnail for a grid card', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');

    const loaded = getGalleryState().photos.find((entry) => entry.photoId === 'a');
    expect(loaded?.thumbnailUri).toBe('data:image/jpeg;base64,THUMB-a');
    expect(loaded?.fullUri).toBeNull();
    expect(mocks.downloadThumbnail).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'a' }));
    expect(mocks.downloadFull).not.toHaveBeenCalled();
  });

  it('uses a controlled full fallback for a legacy photo', async () => {
    const legacy = photo('legacy', 0, false);
    mocks.list.mockResolvedValue([legacy]);
    mocks.downloadThumbnail.mockResolvedValue({
      uri: 'file:///cache/photo-vault/tmp/legacy.full.jpg',
      size: 1200,
      photo: legacy,
      isFullImage: true,
    });
    await loadGallery();
    await mountGalleryPhoto('legacy');

    const loaded = getGalleryState().photos[0]!;
    expect(loaded.thumbnailUri).toBe(loaded.fullUri);
  });

  it('caps thumbnail download/decrypt concurrency separately', async () => {
    const photos = Array.from({ length: 12 }, (_, index) => photo(`p${index}`, index));
    mocks.list.mockResolvedValue(photos);
    let active = 0;
    let peak = 0;
    mocks.downloadThumbnail.mockImplementation(async (metadata: ReturnType<typeof photo>) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return {
        dataUri: `data:image/jpeg;base64,THUMB-${metadata.photoId}`,
        photo: metadata,
        isFullImage: false,
      };
    });
    await loadGallery();
    await Promise.all(photos.map((entry) => mountGalleryPhoto(entry.photoId)));

    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_THUMBNAIL_DOWNLOADS);
  });

  it('keeps a bounded session LRU after cells unmount', async () => {
    const photos = Array.from(
      { length: MAX_THUMBNAIL_CACHE_ENTRIES + 2 },
      (_, index) => photo(`p${index}`, index),
    );
    mocks.list.mockResolvedValue(photos);
    await loadGallery();
    for (const entry of photos) {
      await mountGalleryPhoto(entry.photoId);
      unmountGalleryPhoto(entry.photoId);
    }

    const retained = getGalleryState().photos.filter((entry) => entry.thumbnailUri).length;
    expect(retained).toBe(MAX_THUMBNAIL_CACHE_ENTRIES);
    // The two evicted thumbnails are base64 strings, so eviction is simply the
    // controller dropping them. There is no plaintext file to delete, which is
    // exactly what moving thumbnails to memory bought.
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});

describe('progressive viewer', () => {
  it('opens from the thumbnail and replaces it with full when ready', async () => {
    let releaseFull: (value: unknown) => void = () => {};
    mocks.downloadFull.mockReturnValue(
      new Promise((resolve) => {
        releaseFull = resolve;
      }),
    );
    await loadGallery();
    await mountGalleryPhoto('a');

    claimGalleryPhotoForViewer('a');
    expect(getGalleryState().photos[0]?.thumbnailUri).not.toBeNull();
    expect(getGalleryState().photos[0]?.fullUri).toBeNull();

    releaseFull({
      uri: 'file:///cache/photo-vault/tmp/a.full.jpg',
      size: 1200,
      photo: photo('a'),
    });
    await vi.waitFor(() => expect(getGalleryState().photos[0]?.fullUri).toContain('full.jpg'));
  });

  it('retains no more than the explicit full-image session limit', async () => {
    const photos = Array.from({ length: MAX_FULL_CACHE_ENTRIES + 1 }, (_, index) => photo(`p${index}`));
    mocks.list.mockResolvedValue(photos);
    await loadGallery();
    for (const entry of photos) {
      await mountGalleryPhoto(entry.photoId);
      claimGalleryPhotoForViewer(entry.photoId);
      await vi.waitFor(() =>
        expect(getGalleryState().photos.find((photo) => photo.photoId === entry.photoId)?.fullUri).not.toBeNull(),
      );
      releaseGalleryPhotoFromViewer(entry.photoId);
    }
    expect(getGalleryState().photos.filter((entry) => entry.fullUri)).toHaveLength(
      MAX_FULL_CACHE_ENTRIES,
    );
  });

  it('discards a late full result after lock', async () => {
    let releaseFull: (value: unknown) => void = () => {};
    mocks.downloadFull.mockReturnValue(new Promise((resolve) => { releaseFull = resolve; }));
    await loadGallery();
    await mountGalleryPhoto('a');
    claimGalleryPhotoForViewer('a');

    emitLock('locked');
    releaseFull({ uri: 'file:///cache/photo-vault/tmp/late.jpg', size: 1, photo: photo('a') });
    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith('file:///cache/photo-vault/tmp/late.jpg'));
    expect(getGalleryState().photos[0]?.fullUri).toBeNull();
  });
});

describe('optimistic mutations', () => {
  it('shows an uploading card immediately and reports real transfer progress', async () => {
    let finishUpload: (value: unknown) => void = () => {};
    mocks.upload.mockImplementation(
      (input: { onProgress?: (progress: number) => void }) =>
        new Promise((resolve) => {
          input.onProgress?.(0.42);
          finishUpload = resolve;
        }),
    );

    const pending = addGalleryPhoto(UPLOAD);
    const optimistic = getGalleryState().photos[0]!;
    expect(optimistic.uploadStatus).toBe('uploading');
    expect(optimistic.previewUri).toBe(UPLOAD.sourceUri);
    expect(optimistic.uploadProgress).toBe(0.42);

    finishUpload(photo('new'));
    await expect(pending).resolves.toBe(true);
  });

  it('removes a failed optimistic upload and cleans its preview', async () => {
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultUploadFailed'));
    expect(await addGalleryPhoto(UPLOAD)).toBe(false);
    expect(getGalleryState().photos).toEqual([]);
    expect(mocks.discard).toHaveBeenCalledWith(UPLOAD.sourceUri);
  });

  it('does not paint a late successful upload after the vault locks', async () => {
    let finishUpload: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    const pending = addGalleryPhoto(UPLOAD);
    emitLock('locked');
    finishUpload(photo('new'));

    await expect(pending).resolves.toBe(true);
    expect(getGalleryState().photos.some((entry) => entry.photoId === 'new')).toBe(false);
    expect(mocks.downloadThumbnail).not.toHaveBeenCalled();
  });

  it('hides delete immediately and restores it on a remote failure', async () => {
    let rejectDelete: (reason: unknown) => void = () => {};
    mocks.remove.mockReturnValue(new Promise((_resolve, reject) => { rejectDelete = reject; }));
    await loadGallery();

    const pending = removeGalleryPhoto('a');
    expect(getGalleryState().photos.some((entry) => entry.photoId === 'a')).toBe(false);
    rejectDelete(new PhotoVaultError('vaultDeleteFailed'));
    await expect(pending).resolves.toBe(false);
    expect(getGalleryState().photos.some((entry) => entry.photoId === 'a')).toBe(true);
  });

  it('keeps a successfully deleted card absent', async () => {
    await loadGallery();
    expect(await removeGalleryPhoto('a')).toBe(true);
    expect(getGalleryState().photos.some((entry) => entry.photoId === 'a')).toBe(false);
  });

  it('refetches after a partial delete', async () => {
    mocks.remove.mockRejectedValue(new PhotoVaultError('vaultPartialDelete'));
    await loadGallery();
    mocks.list.mockClear();

    expect(await removeGalleryPhoto('a')).toBe(false);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});

describe('lock and structural security', () => {
  it('clears thumbnails, full images and optimistic previews on lock', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    claimGalleryPhotoForViewer('a');
    await vi.waitFor(() => expect(getGalleryState().photos[0]?.fullUri).not.toBeNull());

    discardDecryptedPhotos();
    const entry = getGalleryState().photos[0]!;
    expect(entry.thumbnailUri).toBeNull();
    expect(entry.fullUri).toBeNull();
    expect(entry.previewUri).toBeNull();
    expect(mocks.discard).toHaveBeenCalled();
  });

  it('drops the in-memory thumbnail on lock without asking to delete a file', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    expect(getGalleryState().photos[0]?.thumbnailUri).toMatch(/^data:image\/jpeg;base64,/);

    discardDecryptedPhotos();

    // Dropping the reference IS the cleanup for a data URI; there is no file
    // behind it, so nothing under the vault's plaintext directory is targeted.
    expect(getGalleryState().photos[0]?.thumbnailUri).toBeNull();
    for (const [uri] of mocks.discard.mock.calls) {
      expect(String(uri)).not.toMatch(/^data:/);
    }
  });

  it('re-requests a thumbnail after unlock so the encrypted cache can serve it', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    expect(mocks.downloadThumbnail).toHaveBeenCalledTimes(1);

    discardDecryptedPhotos();
    await mountGalleryPhoto('a');

    // The controller asks again because RAM was cleared; whether that reaches
    // the network is the cache layer's decision, not the controller's.
    expect(mocks.downloadThumbnail).toHaveBeenCalledTimes(2);
  });

  it('reconciles the encrypted cache after a listing, not during it', async () => {
    await loadGallery();
    expect(mocks.reconcile).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ photoId: 'a' })]),
    );
  });

  it('notifies subscribers and preserves service layering', async () => {
    const seen: string[] = [];
    subscribeToGallery((next) => seen.push(next.status));
    await loadGallery();
    expect(seen).toContain('ready');

    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/photoVaultGallery.ts', 'utf8');
    expect(source).not.toContain('firebase/firestore');
    expect(source).not.toContain('firebase/storage');
    expect(source).not.toContain('getDownloadURL');
    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('SecureStore');
  });
});
