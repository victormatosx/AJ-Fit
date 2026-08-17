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
  resetGallery,
  replaceGalleryPhoto,
  discardGalleryPreview,
  isSlotTaken,
  unmountGalleryPhoto,
} from '../photoVaultGallery';
import { groupProgressPhotosByDay } from '../photoVaultDayGrouping';

const IV = 'YWJjZGVmZ2hpamts';
const THUMB_IV = 'bW5vcHFyc3R1dnd4';

function photo(id: string, daysAgo = 0, withThumbnail = true) {
  const base = {
    photoId: id,
    assetId: `asset-${id}`,
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

function posedPhoto(dateKey: string, pose: 'front' | 'side' | 'back') {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return {
    ...photo(`${dateKey}_${pose}`),
    takenAt: new Date(y, m - 1, d, 12, 0),
    pose,
    dateKey,
  };
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


// ── Day projection (phase 14C) ─────────────────────────────────────────────
//
// The projection is derived by the screen from `state.photos`, so these cases
// assert the composition: what the controller leaves in state is what the
// grouping can see.

describe('day projection over controller state', () => {
  it('drops a deleted pose and keeps the rest of the day', async () => {
    mocks.list.mockResolvedValue([
      posedPhoto('2026-08-15', 'front'),
      posedPhoto('2026-08-15', 'side'),
      posedPhoto('2026-08-15', 'back'),
    ]);
    await loadGallery();

    expect(await removeGalleryPhoto('2026-08-15_side')).toBe(true);

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    expect(day?.front).toBeDefined();
    expect(day?.back).toBeDefined();
    expect(day?.side).toBeUndefined();
  });

  it('removes the day once its last photo is gone', async () => {
    mocks.list.mockResolvedValue([posedPhoto('2026-08-15', 'front')]);
    await loadGallery();

    expect(await removeGalleryPhoto('2026-08-15_front')).toBe(true);

    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
  });

  it('keeps a legacy photo of the same day visible after a posed delete', async () => {
    mocks.list.mockResolvedValue([
      posedPhoto('2026-08-15', 'front'),
      { ...photo('legacy-a'), takenAt: new Date(2026, 7, 15, 9, 0) },
    ]);
    await loadGallery();

    await removeGalleryPhoto('2026-08-15_front');

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    expect(day?.dateKey).toBe('2026-08-15');
    expect(day?.unclassified.map((entry) => entry.photoId)).toEqual(['legacy-a']);
  });

  it('leaves no projection behind when the vault locks', async () => {
    mocks.list.mockResolvedValue([posedPhoto('2026-08-15', 'front')]);
    await loadGallery();
    await mountGalleryPhoto('2026-08-15_front');
    expect(groupProgressPhotosByDay(getGalleryState().photos)).toHaveLength(1);

    emitLock('locked');

    // The day survives as a shell only while metadata is still in state; the
    // decrypted representation is what must be gone.
    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    expect(day?.front?.thumbnailUri).toBeNull();
    expect(day?.front?.previewUri).toBeNull();
  });

  it('carries no projection across a reset to another user', async () => {
    mocks.list.mockResolvedValue([posedPhoto('2026-08-15', 'front')]);
    await loadGallery();
    expect(groupProgressPhotosByDay(getGalleryState().photos)).toHaveLength(1);

    resetGallery();

    expect(getGalleryState().photos).toEqual([]);
    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
  });
});


// ── Posed uploads from the UI (phase 14D) ──────────────────────────────────

describe('posed optimistic upload', () => {
  const AUG_15 = new Date(2026, 7, 15, 12, 0);

  function uploadedPosed(pose: 'front' | 'side' | 'back') {
    return posedPhoto('2026-08-15', pose);
  }

  it('places the optimistic card straight into its slot', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'side' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    // It must never appear as unclassified first and jump to a slot later.
    expect(day?.dateKey).toBe('2026-08-15');
    expect(day?.side?.uploadStatus).toBe('uploading');
    expect(day?.unclassified).toEqual([]);
  });

  it('derives the optimistic day from the photo, not from today', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    // A library photo from July, added today.
    void addGalleryPhoto({ ...UPLOAD, takenAt: new Date(2026, 6, 2, 9, 0), pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    expect(groupProgressPhotosByDay(getGalleryState().photos)[0]?.dateKey).toBe('2026-07-02');
  });

  it('keeps a late evening photo on its local day', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: new Date(2026, 7, 15, 23, 30), pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    expect(groupProgressPhotosByDay(getGalleryState().photos)[0]?.dateKey).toBe('2026-08-15');
  });

  it('carries no asset id while the upload is in flight', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    // A placeholder id could collide with a real UUID in the cache.
    expect(getGalleryState().photos[0]!.assetId).toBeNull();
  });

  it('passes the pose to the service and nothing else', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockResolvedValue(uploadedPosed('back'));

    await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'back' });

    const [params] = mocks.upload.mock.calls[0] as [Record<string, unknown>];
    expect(params.pose).toBe('back');
    for (const derived of ['assetId', 'documentId', 'dateKey', 'storagePath']) {
      expect(params[derived]).toBeUndefined();
    }
  });

  it('reconciles into the same slot on success', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockResolvedValue(uploadedPosed('front'));

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toBe(true);

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    expect(day?.front?.photoId).toBe('2026-08-15_front');
    expect(day?.front?.uploadStatus).toBeNull();
    expect(day?.unclassified).toEqual([]);
    // Exactly one card: the optimistic one was replaced, not duplicated.
    expect(getGalleryState().photos).toHaveLength(1);
  });

  it('leaves the slot empty when the upload fails', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultUploadFailed'));

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toBe(false);

    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
    expect(getGalleryState().issue).toBe('vaultUploadFailed');
  });

  it('surfaces a taken slot as its own issue', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultPhotoSlotTaken'));

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toBe(false);
    expect(getGalleryState().issue).toBe('vaultPhotoSlotTaken');
  });

  it('discards a late upload that resolved after the vault locked', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    let release: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const pending = addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    emitLock('locked');
    release(uploadedPosed('front'));
    await pending;

    // The late result must not repopulate the gallery behind the lock.
    expect(getGalleryState().photos.filter((p) => p.uploadStatus)).toEqual([]);
    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
  });

  it('still supports an upload with no pose for the compatibility path', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15 });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    expect(day?.unclassified).toHaveLength(1);
    expect(day?.front).toBeUndefined();
  });
});

describe('slot occupancy known to the client', () => {
  it('reports a filled slot and leaves the others free', async () => {
    mocks.list.mockResolvedValue([posedPhoto('2026-08-15', 'front')]);
    await loadGallery();

    expect(isSlotTaken('2026-08-15', 'front')).toBe(true);
    expect(isSlotTaken('2026-08-15', 'side')).toBe(false);
    expect(isSlotTaken('2026-08-15', 'back')).toBe(false);
    expect(isSlotTaken('2026-08-14', 'front')).toBe(false);
  });

  it('does not treat a legacy photo as occupying any slot', async () => {
    mocks.list.mockResolvedValue([
      { ...photo('legacy-a'), takenAt: new Date(2026, 7, 15, 9, 0) },
    ]);
    await loadGallery();

    expect(isSlotTaken('2026-08-15', 'front')).toBe(false);
  });

  it('counts an in-flight optimistic card as occupying its slot', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: new Date(2026, 7, 15, 12, 0), pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    // Prevents a second upload racing into the same slot from this device.
    expect(isSlotTaken('2026-08-15', 'front')).toBe(true);
  });
});

describe('abandoned preview', () => {
  it('releases a picked file the user did not save', () => {
    discardGalleryPreview('file:///cache/photo-vault/tmp/picked.jpg');
    expect(mocks.discard).toHaveBeenCalledWith('file:///cache/photo-vault/tmp/picked.jpg');
  });

  it('ignores an absent selection', () => {
    discardGalleryPreview(null);
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});


describe('replacing a slot held by an upload still in flight', () => {
  it('reports a typed issue instead of an untyped failure', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));

    void addGalleryPhoto({ ...UPLOAD, takenAt: new Date(2026, 7, 15, 12, 0), pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));
    const optimistic = getGalleryState().photos[0]!;
    expect(optimistic.metadata).toBeNull();

    const ok = await replaceGalleryPhoto(optimistic.photoId, {
      ...UPLOAD,
      takenAt: new Date(2026, 7, 15, 12, 0),
      pose: 'front',
    });

    expect(ok).toBe(false);
    // Without this the screen falls back to "your current photo was kept",
    // which is false: nothing was kept because nothing is persisted yet.
    expect(getGalleryState().issue).toBe('vaultReplaceSlotMissing');
  });

  it('leaves the in-flight upload untouched', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockReturnValue(new Promise(() => {}));
    void addGalleryPhoto({ ...UPLOAD, takenAt: new Date(2026, 7, 15, 12, 0), pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    await replaceGalleryPhoto(getGalleryState().photos[0]!.photoId, {
      ...UPLOAD,
      takenAt: new Date(2026, 7, 15, 12, 0),
      pose: 'front',
    });

    expect(getGalleryState().photos[0]!.uploadStatus).toBe('uploading');
  });
});
