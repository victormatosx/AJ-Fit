import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  downloadThumbnail: vi.fn(),
  reconcile: vi.fn(),
  downloadFull: vi.fn(),
  /**
   * Stands in for `prepareProgressPhotoUpload` — the only part of a save the
   * caller now awaits. Resolving it means the photo is sealed and durable, NOT
   * that the backend has it; delivery is the fake queue's job below.
   */
  upload: vi.fn(),
  remove: vi.fn(),
  discard: vi.fn(),
  replace: vi.fn(),
  cancelJob: vi.fn(),
  retryJob: vi.fn(),
  kick: vi.fn(),
  listPending: vi.fn(),
  lockListeners: [] as ((status: string) => void)[],
  /** Jobs the fake queue is holding, with the photo each will settle into. */
  enqueued: [] as { job: Record<string, unknown>; photo: unknown }[],
  syncedListeners: [] as ((photo: unknown, job: unknown) => void)[],
  droppedListeners: [] as ((job: unknown) => void)[],
  progressListeners: [] as ((jobId: string, progress: number) => void)[],
  jobSequence: 0,
}));

vi.mock('../../services/progressPhotos', () => ({
  listProgressPhotos: mocks.list,
  reconcileProgressPhotoCache: mocks.reconcile,
  downloadProgressPhotoThumbnail: mocks.downloadThumbnail,
  downloadProgressPhoto: mocks.downloadFull,
  deleteProgressPhoto: mocks.remove,
  replaceProgressPhoto: mocks.replace,
  prepareProgressPhotoUpload: async (input: unknown) => {
    const photo = await mocks.upload(input);
    // Preparation resolves the uid itself, from the unlocked session.
    return { uid: 'alice', ...(photo as Record<string, unknown>) };
  },
}));

/**
 * A queue the test drives by hand.
 *
 * Enqueuing is where a save now ENDS as far as the caller is concerned, so
 * these tests have to make the later delivery an explicit, separate step —
 * which is exactly the behaviour change being covered.
 */
vi.mock('../../services/photoVaultUploadQueue', () => ({
  enqueuePreparedPhoto: async (uid: string, prepared: Record<string, unknown>) => {
    const job = {
      jobId: `job-${(mocks.jobSequence += 1)}`,
      uid,
      assetId: prepared.assetId,
      pose: prepared.pose,
      dateKey: prepared.dateKey,
      stage: 'pending-upload',
      state: 'pending',
    };
    mocks.enqueued.push({ job, photo: prepared });
    return job;
  },
  kickPhotoVaultUploadQueue: mocks.kick,
  cancelPhotoVaultUploadJob: mocks.cancelJob,
  retryPhotoVaultUploadJob: mocks.retryJob,
  listPendingPhotoVaultJobs: mocks.listPending,
  subscribeToPhotoVaultUploadSynced: (listener: (photo: unknown, job: unknown) => void) => {
    mocks.syncedListeners.push(listener);
    return () => undefined;
  },
  subscribeToPhotoVaultUploadDropped: (listener: (job: unknown) => void) => {
    mocks.droppedListeners.push(listener);
    return () => undefined;
  },
  subscribeToPhotoVaultUploadProgress: (
    listener: (jobId: string, progress: number) => void,
  ) => {
    mocks.progressListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('../../services/photoVaultUploadQueueStore', () => ({
  subscribeToPhotoVaultUploadQueue: () => () => undefined,
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
  MAX_FULL_CACHE_BYTES,
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

/**
 * Delivers every queued job, as the real worker eventually would.
 *
 * Tests call this explicitly because that is now the truth: awaiting a save
 * only gets you as far as durable ciphertext.
 */
function settleQueue(): void {
  const queued = mocks.enqueued.splice(0, mocks.enqueued.length);
  for (const { job, photo } of queued) {
    for (const listener of mocks.syncedListeners) listener(photo, job);
  }
}

/** Reports that a job can never complete, e.g. the slot was claimed elsewhere. */
function dropQueuedJob(lastIssue: string): void {
  const queued = mocks.enqueued.splice(0, mocks.enqueued.length);
  for (const { job } of queued) {
    for (const listener of mocks.droppedListeners) listener({ ...job, lastIssue });
  }
}

function emitJobProgress(progress: number): void {
  for (const { job } of mocks.enqueued) {
    for (const listener of mocks.progressListeners) {
      listener(job.jobId as string, progress);
    }
  }
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
  mocks.listPending.mockResolvedValue([]);
  mocks.cancelJob.mockResolvedValue(true);
  mocks.retryJob.mockResolvedValue(undefined);
  mocks.enqueued.length = 0;
  mocks.jobSequence = 0;
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

/**
 * The plaintext the unlocked session is allowed to keep.
 *
 * Distinct from the ciphertext cache in `photoVaultEncryptedCache`: this one
 * holds DECRYPTED representations and is destroyed by every lock. Its only job
 * is to make reopening a photo the user just looked at free.
 */
describe('session plaintext cache', () => {
  /** Opens a photo through the viewer and waits for its full to land. */
  async function openInViewer(
    photoId: string,
    neighbours?: { previous?: string | null; next?: string | null },
  ): Promise<void> {
    claimGalleryPhotoForViewer(photoId, neighbours);
    await vi.waitFor(() =>
      expect(
        getGalleryState().photos.find((entry) => entry.photoId === photoId)?.fullUri,
      ).not.toBeNull(),
    );
  }

  it('reopens a photo from the session without downloading it again', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');

    await openInViewer('a');
    expect(mocks.downloadFull).toHaveBeenCalledTimes(1);

    releaseGalleryPhotoFromViewer('a');
    await openInViewer('a');

    // Closing the viewer only drops a claim; the decrypted file is still the
    // one this session already produced.
    expect(mocks.downloadFull).toHaveBeenCalledTimes(1);
  });

  it('keeps A warm across A→B→A', async () => {
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1)]);
    await loadGallery();

    await openInViewer('a');
    releaseGalleryPhotoFromViewer('a');
    await openInViewer('b');
    releaseGalleryPhotoFromViewer('b');
    await openInViewer('a');

    expect(mocks.downloadFull).toHaveBeenCalledTimes(2);
    expect(
      mocks.downloadFull.mock.calls.filter(
        ([metadata]) => (metadata as { photoId: string }).photoId === 'a',
      ),
    ).toHaveLength(1);
  });

  it('retains five fulls before evicting the least recently used', async () => {
    expect(MAX_FULL_CACHE_ENTRIES).toBe(5);
    const photos = Array.from({ length: MAX_FULL_CACHE_ENTRIES }, (_, index) =>
      photo(`p${index}`),
    );
    mocks.list.mockResolvedValue(photos);
    await loadGallery();

    for (const entry of photos) {
      await openInViewer(entry.photoId);
      releaseGalleryPhotoFromViewer(entry.photoId);
    }

    // Reopening the FIRST one must still be free: two was too small to survive
    // any real browsing session.
    await openInViewer('p0');
    expect(mocks.downloadFull).toHaveBeenCalledTimes(MAX_FULL_CACHE_ENTRIES);
  });

  it('evicts by bytes even while under the entry ceiling', async () => {
    // Three photos, each a third of the budget plus a slice, so the count
    // ceiling of five can never be what triggers this.
    const huge = Math.floor(MAX_FULL_CACHE_BYTES / 2);
    mocks.downloadFull.mockImplementation(async (metadata: ReturnType<typeof photo>) => ({
      uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
      size: huge,
      photo: metadata,
    }));
    const photos = [photo('p0'), photo('p1'), photo('p2')];
    mocks.list.mockResolvedValue(photos);
    await loadGallery();

    for (const entry of photos) {
      await openInViewer(entry.photoId);
      releaseGalleryPhotoFromViewer(entry.photoId);
    }

    const retained = getGalleryState().photos.filter((entry) => entry.fullUri);
    expect(retained.length).toBeLessThan(3);
    expect(mocks.discard).toHaveBeenCalledWith('file:///cache/photo-vault/tmp/p0.full.jpg');
  });

  it('never evicts the photo the viewer is currently showing', async () => {
    const huge = MAX_FULL_CACHE_BYTES;
    mocks.downloadFull.mockImplementation(async (metadata: ReturnType<typeof photo>) => ({
      uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
      size: huge,
      photo: metadata,
    }));
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1)]);
    await loadGallery();

    await openInViewer('a');
    // `b` alone already fills the whole budget, yet the photo on screen must
    // survive its arrival.
    await openInViewer('b', { previous: 'a' });

    expect(
      getGalleryState().photos.find((entry) => entry.photoId === 'b')?.fullUri,
    ).not.toBeNull();
  });
});

describe('viewer prefetch window', () => {
  it('prepares both neighbours when a photo opens', async () => {
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1), photo('c', 2)]);
    await loadGallery();

    claimGalleryPhotoForViewer('b', { previous: 'a', next: 'c' });

    await vi.waitFor(() => expect(mocks.downloadFull).toHaveBeenCalledTimes(3));
    const requested = mocks.downloadFull.mock.calls.map(
      ([metadata]) => (metadata as { photoId: string }).photoId,
    );
    expect(new Set(requested)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('never reaches past the immediate neighbours', async () => {
    const photos = Array.from({ length: 8 }, (_, index) => photo(`p${index}`, index));
    mocks.list.mockResolvedValue(photos);
    await loadGallery();

    claimGalleryPhotoForViewer('p3', { previous: 'p2', next: 'p4' });
    await vi.waitFor(() => expect(mocks.downloadFull).toHaveBeenCalledTimes(3));

    const requested = new Set(
      mocks.downloadFull.mock.calls.map(
        ([metadata]) => (metadata as { photoId: string }).photoId,
      ),
    );
    expect(requested).toEqual(new Set(['p2', 'p3', 'p4']));
  });

  it('gives the photo on screen a lane before any neighbour', async () => {
    const started: string[] = [];
    mocks.downloadFull.mockImplementation(
      (metadata: ReturnType<typeof photo>) =>
        new Promise((resolve) => {
          started.push(metadata.photoId);
          setTimeout(
            () =>
              resolve({
                uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
                size: 1200,
                photo: metadata,
              }),
            0,
          );
        }),
    );
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1), photo('c', 2)]);
    await loadGallery();

    claimGalleryPhotoForViewer('b', { previous: 'a', next: 'c' });
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));

    // Whatever else gets a lane, the photo the user is looking at took one first.
    expect(started[0]).toBe('b');
  });

  it('reuses an in-flight prefetch when the user navigates onto it', async () => {
    let releaseC: (value: unknown) => void = () => {};
    mocks.downloadFull.mockImplementation((metadata: ReturnType<typeof photo>) => {
      if (metadata.photoId === 'c') {
        return new Promise((resolve) => { releaseC = resolve; });
      }
      return Promise.resolve({
        uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
        size: 1200,
        photo: metadata,
      });
    });
    mocks.list.mockResolvedValue([photo('b'), photo('c', 1)]);
    await loadGallery();

    claimGalleryPhotoForViewer('b', { next: 'c' });
    await vi.waitFor(() =>
      expect(
        mocks.downloadFull.mock.calls.some(
          ([metadata]) => (metadata as { photoId: string }).photoId === 'c',
        ),
      ).toBe(true),
    );

    // The swipe lands on the photo the prefetch is already decrypting.
    releaseGalleryPhotoFromViewer('b');
    claimGalleryPhotoForViewer('c', { previous: 'b' });

    releaseC({
      uri: 'file:///cache/photo-vault/tmp/c.full.jpg',
      size: 1200,
      photo: photo('c'),
    });
    await vi.waitFor(() =>
      expect(
        getGalleryState().photos.find((entry) => entry.photoId === 'c')?.fullUri,
      ).not.toBeNull(),
    );

    const cCalls = mocks.downloadFull.mock.calls.filter(
      ([metadata]) => (metadata as { photoId: string }).photoId === 'c',
    );
    expect(cCalls).toHaveLength(1);
  });

  it('throws away a result for a photo the user has swiped far past', async () => {
    let releaseA: (value: unknown) => void = () => {};
    mocks.downloadFull.mockImplementation((metadata: ReturnType<typeof photo>) => {
      if (metadata.photoId === 'a') {
        return new Promise((resolve) => { releaseA = resolve; });
      }
      return Promise.resolve({
        uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
        size: 1200,
        photo: metadata,
      });
    });
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1), photo('z', 2)]);
    await loadGallery();

    claimGalleryPhotoForViewer('a', { next: 'b' });
    releaseGalleryPhotoFromViewer('a');
    // The window has moved on entirely; `a` is no longer even a neighbour.
    claimGalleryPhotoForViewer('z');

    releaseA({
      uri: 'file:///cache/photo-vault/tmp/a.stale.jpg',
      size: 1200,
      photo: photo('a'),
    });

    await vi.waitFor(() =>
      expect(mocks.discard).toHaveBeenCalledWith('file:///cache/photo-vault/tmp/a.stale.jpg'),
    );
    expect(getGalleryState().photos.find((entry) => entry.photoId === 'a')?.fullUri).toBeNull();
  });

  it('does not let a prefetch land after the vault locks', async () => {
    let releaseNeighbour: (value: unknown) => void = () => {};
    mocks.downloadFull.mockImplementation((metadata: ReturnType<typeof photo>) => {
      if (metadata.photoId === 'b') {
        return new Promise((resolve) => { releaseNeighbour = resolve; });
      }
      return Promise.resolve({
        uri: `file:///cache/photo-vault/tmp/${metadata.photoId}.full.jpg`,
        size: 1200,
        photo: metadata,
      });
    });
    mocks.list.mockResolvedValue([photo('a'), photo('b', 1)]);
    await loadGallery();

    claimGalleryPhotoForViewer('a', { next: 'b' });
    await vi.waitFor(() =>
      expect(
        mocks.downloadFull.mock.calls.some(
          ([metadata]) => (metadata as { photoId: string }).photoId === 'b',
        ),
      ).toBe(true),
    );

    emitLock('locked');
    releaseNeighbour({
      uri: 'file:///cache/photo-vault/tmp/b.prefetched.jpg',
      size: 1200,
      photo: photo('b'),
    });

    await vi.waitFor(() =>
      expect(mocks.discard).toHaveBeenCalledWith(
        'file:///cache/photo-vault/tmp/b.prefetched.jpg',
      ),
    );
    expect(getGalleryState().photos.find((entry) => entry.photoId === 'b')?.fullUri).toBeNull();
  });
});

describe('optimistic mutations', () => {
  it('shows an uploading card immediately and reports real transfer progress', async () => {
    let finishPrepare: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((resolve) => { finishPrepare = resolve; }));

    const pending = addGalleryPhoto(UPLOAD);
    // While the photo is being sealed it is `preparing` — the one stage that
    // can still fail in a way that loses it.
    const optimistic = getGalleryState().photos[0]!;
    expect(optimistic.uploadStatus).toBe('preparing');
    expect(optimistic.previewUri).toBe(UPLOAD.sourceUri);
    expect(optimistic.jobId).toBeNull();

    finishPrepare(photo('new'));
    await expect(pending).resolves.toMatchObject({ ok: true });

    // Sealed and durable: the card now owes only its remote copy, and carries
    // the job that will deliver it.
    const durable = getGalleryState().photos[0]!;
    expect(durable.uploadStatus).toBe('uploading');
    expect(durable.jobId).toBe('job-1');

    // Transfer progress arrives from the queue, not from the awaited save.
    emitJobProgress(0.42);
    expect(getGalleryState().photos[0]!.uploadProgress).toBe(0.42);
  });

  it('releases the caller as soon as the photo is durable, not when it is uploaded', async () => {
    mocks.upload.mockResolvedValue(photo('new'));

    const result = await addGalleryPhoto(UPLOAD);

    // The save is done from the user's point of view while the backend still
    // has nothing — that is the whole point of the split.
    expect(result).toMatchObject({ ok: true });
    expect(mocks.enqueued).toHaveLength(1);
    expect(getGalleryState().photos[0]!.metadata).toBeNull();
    expect(mocks.kick).toHaveBeenCalled();
  });

  it('keeps the card when delivery fails, because the photo is not lost', async () => {
    mocks.upload.mockResolvedValue(photo('new'));
    await addGalleryPhoto(UPLOAD);

    // A failed transfer is a delivery problem; the ciphertext is still on disk
    // and a retry is scheduled, so removing the card would be a lie.
    const card = getGalleryState().photos[0]!;
    expect(card.uploadStatus).toBe('uploading');
    expect(card.jobId).not.toBeNull();
    expect(getGalleryState().photos).toHaveLength(1);
  });

  it('removes a failed optimistic upload and cleans its preview', async () => {
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultUploadFailed'));
    expect(await addGalleryPhoto(UPLOAD)).toMatchObject({ ok: false });
    expect(getGalleryState().photos).toEqual([]);
    expect(mocks.discard).toHaveBeenCalledWith(UPLOAD.sourceUri);
  });

  it('does not paint a late successful upload after the vault locks', async () => {
    let finishUpload: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    const pending = addGalleryPhoto(UPLOAD);
    emitLock('locked');
    finishUpload(photo('new'));

    await expect(pending).resolves.toMatchObject({ ok: true });
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
    expect(day?.side?.uploadStatus).toBe('preparing');
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

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toMatchObject({ ok: true });
    // Reconciliation happens when the queue delivers, not when the save returns.
    settleQueue();

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

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toMatchObject({ ok: false });

    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
    expect(getGalleryState().issue).toBe('vaultUploadFailed');
  });

  it('surfaces a taken slot as its own issue', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultPhotoSlotTaken'));

    expect(await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' })).toMatchObject({ ok: false, issue: 'vaultPhotoSlotTaken' });
    expect(getGalleryState().issue).toBe('vaultPhotoSlotTaken');
  });

  it('paints nothing behind a lock but still queues what it sealed', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    let release: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const pending = addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' });
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(1));

    emitLock('locked');
    release(uploadedPosed('front'));
    await pending;

    // Nothing is repainted behind the lock...
    expect(groupProgressPhotosByDay(getGalleryState().photos)).toEqual([]);
    // ...but the photo was already sealed, so abandoning it would destroy it.
    // It is queued, and the next authenticated load will show it.
    expect(mocks.enqueued).toHaveLength(1);
    expect(mocks.kick).toHaveBeenCalledWith('prepared-while-locked');
  });

  it('never leaves a sealed photo unqueued just because the screen locked', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockResolvedValue(uploadedPosed('front'));

    const pending = addGalleryPhoto({ ...UPLOAD, takenAt: AUG_15, pose: 'front' });
    emitLock('locked');
    const result = await pending;

    // Reported as success: the photo is durable and delivery is under way.
    // Reporting failure would tell the user to take it again.
    expect(result).toMatchObject({ ok: true });
    expect(mocks.enqueued).toHaveLength(1);
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

    expect(ok).toMatchObject({ ok: false, issue: 'vaultReplaceSlotMissing' });
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

    expect(getGalleryState().photos[0]!.uploadStatus).toBe('preparing');
  });
});

// ── Concurrent poses ───────────────────────────────────────────────────────

/**
 * Saving a session commits front, side and back at the same time. These cases
 * drive the controller the way the sheet now does — three overlapping calls —
 * rather than the one-at-a-time sequence it used to see.
 */
describe('three poses committed concurrently', () => {
  const AUG_20 = new Date(2026, 7, 20, 12, 0);
  const POSES = ['front', 'side', 'back'] as const;

  /** Lets a test decide the order the three uploads resolve in. */
  function controllableUploads() {
    const gates = new Map<string, (value: unknown) => void>();
    mocks.upload.mockImplementation(
      (input: { pose: 'front' | 'side' | 'back' }) =>
        new Promise((resolve) => {
          gates.set(input.pose, resolve);
        }),
    );
    return {
      settle(pose: 'front' | 'side' | 'back') {
        gates.get(pose)!({
          ...posedPhoto('2026-08-20', pose),
        });
      },
      get pending() {
        return gates.size;
      },
    };
  }

  function commitAllThree() {
    return Promise.allSettled(
      POSES.map((pose) => addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose })),
    );
  }

  it('runs all three uploads at once rather than one after another', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    const uploads = controllableUploads();

    void commitAllThree();
    await vi.waitFor(() => expect(uploads.pending).toBe(3));

    // The sequential loop this replaced could only ever have one in flight.
    expect(mocks.upload).toHaveBeenCalledTimes(3);
  });

  it('shows three independent optimistic cards, one per pose', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    controllableUploads();

    void commitAllThree();
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(3));

    const cards = getGalleryState().photos;
    expect(new Set(cards.map((card) => card.pose))).toEqual(new Set(POSES));
    // Each card carries its own local id and its own preview.
    expect(new Set(cards.map((card) => card.photoId)).size).toBe(3);
    for (const card of cards) expect(card.uploadStatus).toBe('preparing');
  });

  it('paints front, side, back in that order whatever order they finish in', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    const uploads = controllableUploads();

    const done = commitAllThree();
    await vi.waitFor(() => expect(uploads.pending).toBe(3));
    // Deliberately the reverse of the visual order.
    uploads.settle('back');
    uploads.settle('side');
    uploads.settle('front');
    await done;

    const [day] = groupProgressPhotosByDay(getGalleryState().photos);
    // The grid places photos by their pose field, so completion order cannot
    // reach the user.
    expect(day!.front?.pose).toBe('front');
    expect(day!.side?.pose).toBe('side');
    expect(day!.back?.pose).toBe('back');
    expect(day!.unclassified).toHaveLength(0);
  });

  it('never lets two poses collide on one identity', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    controllableUploads();

    void commitAllThree();
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));

    // Each pose is handed to the service separately; the service derives the
    // asset UUID, both Storage paths and the `{dateKey}_{pose}` document.
    const poses = mocks.upload.mock.calls.map(([input]) => input.pose);
    expect(new Set(poses)).toEqual(new Set(POSES));
  });

  it('keeps a failed pose from taking down the two that succeeded', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockImplementation(async (input: { pose: string }) => {
      if (input.pose === 'side') throw new PhotoVaultError('vaultUploadFailed');
      return posedPhoto('2026-08-20', input.pose as 'front' | 'back');
    });

    const results = await Promise.all(
      POSES.map((pose) => addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose })),
    );

    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, issue: 'vaultUploadFailed' });
    expect(results[2]).toMatchObject({ ok: true });
    // The two that landed are still in the gallery; only the failure was
    // rolled back to nothing.
    const remaining = getGalleryState().photos;
    expect(remaining).toHaveLength(2);
    expect(new Set(remaining.map((card) => card.pose))).toEqual(new Set(['front', 'back']));
  });

  it('gives each pose its own issue instead of a single shared one', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockImplementation(async (input: { pose: string }) => {
      if (input.pose === 'front') throw new PhotoVaultError('vaultPhotoTooLarge');
      throw new PhotoVaultError('vaultUploadFailed');
    });

    const [front, side] = await Promise.all([
      addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose: 'front' }),
      addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose: 'side' }),
    ]);

    // Reading the controller's shared `issue` slot afterwards would have given
    // both poses whichever failed last.
    expect(front).toMatchObject({ issue: 'vaultPhotoTooLarge' });
    expect(side).toMatchObject({ issue: 'vaultUploadFailed' });
  });

  it('reports a total failure without leaving any card behind', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockRejectedValue(new PhotoVaultError('vaultUploadFailed'));

    const results = await Promise.all(
      POSES.map((pose) => addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose })),
    );

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(getGalleryState().photos).toHaveLength(0);
    expect(getGalleryState().uploading).toBe(false);
  });

  it('clears the uploading flag only once every pose has been delivered', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    const uploads = controllableUploads();

    const done = commitAllThree();
    await vi.waitFor(() => expect(uploads.pending).toBe(3));
    uploads.settle('front');
    uploads.settle('side');
    uploads.settle('back');
    await done;

    // All three are sealed, none is delivered: still syncing.
    expect(getGalleryState().uploading).toBe(true);
    expect(mocks.enqueued).toHaveLength(3);

    settleQueue();
    expect(getGalleryState().uploading).toBe(false);
    expect(getGalleryState().photos.every((card) => card.uploadStatus === null)).toBe(true);
  });

  it('queues all three poses even if the vault locks mid-batch', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    const uploads = controllableUploads();

    const done = commitAllThree();
    await vi.waitFor(() => expect(getGalleryState().photos).toHaveLength(3));
    // A lock bumps the generation; every in-flight pose must notice.
    emitLock('locked');
    uploads.settle('front');
    uploads.settle('side');
    uploads.settle('back');
    const results = await done;

    for (const result of results) {
      expect(result.status === 'fulfilled' && result.value).toMatchObject({ ok: true });
    }
    // Nothing is shown behind the lock, and nothing was thrown away either.
    expect(getGalleryState().photos).toHaveLength(0);
    expect(mocks.enqueued).toHaveLength(3);
  });

  it('removes a card whose job can never complete', async () => {
    mocks.list.mockResolvedValue([]);
    await loadGallery();
    mocks.upload.mockResolvedValue(posedPhoto('2026-08-20', 'front'));
    await addGalleryPhoto({ ...UPLOAD, takenAt: AUG_20, pose: 'front' });

    // Another device filled this (day, pose): no retry can ever resolve it.
    dropQueuedJob('vaultPhotoSlotTaken');

    expect(getGalleryState().photos).toHaveLength(0);
    expect(getGalleryState().issue).toBe('vaultPhotoSlotTaken');
    expect(getGalleryState().uploading).toBe(false);
  });
});
