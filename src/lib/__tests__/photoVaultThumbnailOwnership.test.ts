import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Thumbnail visibility ownership (phase 15D-0).
 *
 * The controller used to track visible photos in a plain `Set`, which assumed
 * exactly one surface could render a photo. The comparator broke that
 * assumption: it opens as a modal over the still-mounted gallery grid, so both
 * hold the same photo at once, and whichever unmounted first erased the
 * other's claim.
 *
 * These tests pin the counting semantics and, at the bottom, reproduce the
 * concrete regression that motivated them.
 */

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  downloadThumbnail: vi.fn(),
  reconcile: vi.fn(),
  downloadFull: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  discard: vi.fn(),
  logError: vi.fn(),
  lockListeners: [] as ((status: string) => void)[],
  enqueued: [] as { job: Record<string, unknown>; photo: unknown }[],
  syncedListeners: [] as ((photo: unknown, job: unknown) => void)[],
  jobSequence: 0,
}));

vi.mock('../../services/progressPhotos', () => ({
  listProgressPhotos: mocks.list,
  reconcileProgressPhotoCache: mocks.reconcile,
  downloadProgressPhotoThumbnail: mocks.downloadThumbnail,
  downloadProgressPhoto: mocks.downloadFull,
  deleteProgressPhoto: mocks.remove,
  replaceProgressPhoto: vi.fn(),
  prepareProgressPhotoUpload: async (input: unknown) => {
    const photo = await mocks.upload(input);
    return { uid: 'alice', ...(photo as Record<string, unknown>) };
  },
}));

vi.mock('../../services/photoVaultFileCrypto', () => ({
  discardDecryptedPhoto: mocks.discard,
}));

vi.mock('../../services/photoVaultUploadQueue', () => ({
  enqueuePreparedPhoto: async (uid: string, prepared: Record<string, unknown>) => {
    const job = { jobId: `job-${(mocks.jobSequence += 1)}`, uid, assetId: prepared.assetId };
    mocks.enqueued.push({ job, photo: prepared });
    return job;
  },
  kickPhotoVaultUploadQueue: () => undefined,
  cancelPhotoVaultUploadJob: async () => true,
  retryPhotoVaultUploadJob: async () => undefined,
  listPendingPhotoVaultJobs: async () => [],
  subscribeToPhotoVaultUploadSynced: (listener: (photo: unknown, job: unknown) => void) => {
    mocks.syncedListeners.push(listener);
    return () => undefined;
  },
  subscribeToPhotoVaultUploadDropped: () => () => undefined,
  subscribeToPhotoVaultUploadProgress: () => () => undefined,
}));

vi.mock('../../services/photoVaultUploadQueueStore', () => ({
  subscribeToPhotoVaultUploadQueue: () => () => undefined,
}));

vi.mock('../photoVaultLock', () => ({
  subscribeToPhotoVaultStatus: (listener: (status: string) => void) => {
    mocks.lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('../logger', () => ({ logError: mocks.logError }));

import {
  MAX_CONCURRENT_THUMBNAIL_DOWNLOADS,
  addGalleryPhoto,
  claimGalleryThumbnail,
  getGalleryState,
  loadGallery,
  mountGalleryPhoto,
  resetGallery,
  resetGalleryForTesting,
  releaseGalleryThumbnail,
  thumbnailOwnerAliasesForTesting,
  thumbnailOwnershipForTesting,
  unmountGalleryPhoto,
} from '../photoVaultGallery';

const IV = 'YWJjZGVmZ2hpamts';
const THUMB_IV = 'bW5vcHFyc3R1dnd4';

function photo(id: string, daysAgo = 0) {
  return {
    photoId: id,
    assetId: `asset-${id}`,
    takenAt: new Date(Date.now() - daysAgo * 86_400_000),
    storagePath: `users/alice/progressPhotos/${id}.enc`,
    createdAt: null,
    originalMimeType: 'image/jpeg',
    encryptedSize: 2048,
    encryption: { version: 1, algorithm: 'AES-256-GCM', iv: IV, vaultKeyVersion: 1 },
    thumbnailStoragePath: `users/alice/progressPhotos/${id}.thumb.enc`,
    thumbnailEncryptedSize: 256,
    thumbnailEncryption: {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: THUMB_IV,
      vaultKeyVersion: 1,
    },
  };
}

/** Counts, so an assertion reads as "who owns what" rather than map internals. */
function owners(): Record<string, number> {
  return thumbnailOwnershipForTesting();
}

/**
 * Holds every thumbnail download open until explicitly let go.
 *
 * Cancellation is only observable while work is still queued: once a download
 * starts it runs to completion. Occupying every lane is what forces the next
 * photo to sit in the queue where a release can drop it.
 */
function suspendDownloads() {
  const gates: (() => void)[] = [];
  mocks.downloadThumbnail.mockImplementation(
    (metadata: ReturnType<typeof photo>) =>
      new Promise((resolve) => {
        gates.push(() =>
          resolve({
            dataUri: `data:image/jpeg;base64,THUMB-${metadata.photoId}`,
            photo: metadata,
            isFullImage: false,
          }),
        );
      }),
  );
  return {
    /**
     * Keeps opening gates until none are left. Releasing the lanes lets the
     * queue drain, and each drained download registers a gate of its own — so
     * a single pass would leave the very downloads under test still pending.
     */
    releaseAll: async () => {
      for (let pass = 0; pass < 10 && gates.length > 0; pass += 1) {
        const pending = gates.splice(0, gates.length);
        for (const gate of pending) gate();
        for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
      }
    },
  };
}

/** Saturates every download lane so anything mounted afterwards must queue. */
async function saturateLanes(): Promise<string[]> {
  const blockers = Array.from(
    { length: MAX_CONCURRENT_THUMBNAIL_DOWNLOADS },
    (_, index) => `blocker-${index}`,
  );
  for (const id of blockers) void mountGalleryPhoto(id);
  await Promise.resolve();
  return blockers;
}

const QUEUED = 'queued';

async function loadWithQueueableGallery(): Promise<void> {
  const blockers = Array.from(
    { length: MAX_CONCURRENT_THUMBNAIL_DOWNLOADS },
    (_, index) => photo(`blocker-${index}`, index),
  );
  mocks.list.mockResolvedValue([...blockers, photo(QUEUED, 99)]);
  await loadGallery();
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
  mocks.downloadFull.mockResolvedValue({ uri: 'file:///x.jpg', size: 1, photo: photo('a') });
  mocks.upload.mockResolvedValue(photo('uploaded'));
});

const UPLOAD = {
  sourceUri: 'file:///cache/photo-vault/tmp/pic.jpg',
  takenAt: new Date('2026-08-01T10:00:00Z'),
  originalMimeType: 'image/jpeg' as const,
  width: 1200,
  height: 1600,
};

/**
 * Delivers queued jobs, which is when a local upload id becomes a real one.
 * That swap no longer happens when the save resolves — it happens when the
 * durable queue confirms the photo landed.
 */
function settleQueue(): void {
  const queued = mocks.enqueued.splice(0, mocks.enqueued.length);
  for (const { job, photo: settled } of queued) {
    for (const listener of mocks.syncedListeners) listener(settled, job);
  }
}

describe('acquire', () => {
  it('records the first surface (A)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');

    expect(owners()).toEqual({ a: 1 });
  });

  it('counts a second surface separately (B)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a'); // grid
    await mountGalleryPhoto('a'); // comparator

    expect(owners()).toEqual({ a: 2 });
  });

  it('counts a third (F)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');

    expect(owners()).toEqual({ a: 3 });
  });

  it('counts a repeat acquire from one surface (G)', async () => {
    // The API is not owner-aware, so a surface that announces twice counts
    // twice. That is the contract: releases must balance acquires one for one.
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');
    unmountGalleryPhoto('a');

    expect(owners()).toEqual({ a: 1 });
  });

  it('does not re-request a thumbnail already held (4)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    expect(mocks.downloadThumbnail).toHaveBeenCalledTimes(1);

    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');

    expect(mocks.downloadThumbnail).toHaveBeenCalledTimes(1);
  });

  it('still resolves for a late surface that arrives after the download (4)', async () => {
    // The second consumer must not get a promise that resolves before the
    // image exists just because someone else asked first.
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');

    expect(getGalleryState().photos.find((p) => p.photoId === 'a')?.thumbnailUri).toBe(
      'data:image/jpeg;base64,THUMB-a',
    );
  });
});

describe('release', () => {
  it('drops to one owner without clearing the entry (C)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');

    unmountGalleryPhoto('a');

    expect(owners()).toEqual({ a: 1 });
  });

  it('clears the entry when the last owner lets go (D, L)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');

    unmountGalleryPhoto('a');
    unmountGalleryPhoto('a');

    expect(owners()).toEqual({});
  });

  it('does not depend on the order the surfaces close in (E)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a'); // grid
    await mountGalleryPhoto('a'); // comparator

    unmountGalleryPhoto('a'); // grid first this time
    expect(owners()).toEqual({ a: 1 });

    unmountGalleryPhoto('a');
    expect(owners()).toEqual({});
  });

  it('never stores a zero count', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    unmountGalleryPhoto('a');

    // Absent and zero must be the same state, or the map would grow with one
    // dead entry per photo ever scrolled past.
    expect(Object.keys(owners())).toHaveLength(0);
  });
});

describe('underflow (H)', () => {
  it('ignores a release with no acquire', async () => {
    await loadGallery();

    expect(() => unmountGalleryPhoto('a')).not.toThrow();
    expect(owners()).toEqual({});
  });

  it('never goes negative', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    unmountGalleryPhoto('a');
    unmountGalleryPhoto('a');
    unmountGalleryPhoto('a');

    // A later acquire must land on 1, not climb back from below zero — that
    // would leave a genuinely visible photo unowned and blank.
    await mountGalleryPhoto('a');
    expect(owners()).toEqual({ a: 1 });
  });

  it('reports a sanitized issue carrying no photo id (15)', async () => {
    // A distinctive id: asserting the payload omits something like "a" would
    // pass on any string that happens not to contain that letter.
    const secret = 'Zq7-PRIVATE-PHOTO-ID';
    await loadGallery();
    unmountGalleryPhoto(secret);

    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const [scope, error, context] = mocks.logError.mock.calls[0] as [
      string,
      Error,
      Record<string, unknown>,
    ];
    expect(error.message).toBe('vaultThumbnailOwnershipUnderflow');
    expect(JSON.stringify({ scope, message: error.message, context })).not.toContain(secret);
  });

  it('does not disturb a real owner when a stale release arrives', async () => {
    await loadWithQueueableGallery();
    const downloads = suspendDownloads();
    await saturateLanes();

    void mountGalleryPhoto(QUEUED);
    await Promise.resolve();

    unmountGalleryPhoto('never-mounted'); // underflow, unrelated photo

    await downloads.releaseAll();

    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(owners()[QUEUED]).toBe(1);
    expect(mocks.downloadThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: QUEUED }),
    );
  });
});

describe('queued work survives a partial release (K)', () => {
  it('keeps decrypting when one surface closes and another still owns it', async () => {
    await loadWithQueueableGallery();
    const downloads = suspendDownloads();
    await saturateLanes();

    // Both the grid and the comparator claim the same queued photo.
    void mountGalleryPhoto(QUEUED);
    void mountGalleryPhoto(QUEUED);
    await Promise.resolve();
    expect(mocks.downloadThumbnail).not.toHaveBeenCalledWith(
      expect.objectContaining({ photoId: QUEUED }),
    );

    unmountGalleryPhoto(QUEUED); // the comparator closes
    await downloads.releaseAll();

    expect(mocks.downloadThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: QUEUED }),
    );
  });

  it('still cancels once the last surface lets go (L)', async () => {
    // The old behaviour, preserved exactly for a single consumer.
    await loadWithQueueableGallery();
    const downloads = suspendDownloads();
    await saturateLanes();

    void mountGalleryPhoto(QUEUED);
    void mountGalleryPhoto(QUEUED);
    await Promise.resolve();

    unmountGalleryPhoto(QUEUED);
    unmountGalleryPhoto(QUEUED);
    await downloads.releaseAll();

    expect(mocks.downloadThumbnail).not.toHaveBeenCalledWith(
      expect.objectContaining({ photoId: QUEUED }),
    );
  });
});

describe('reset clears every claim (7)', () => {
  it('drops counts held by two surfaces when the vault locks (I)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('a');
    expect(owners()).toEqual({ a: 2 });

    for (const listener of mocks.lockListeners) listener('locked');

    expect(owners()).toEqual({});
  });

  it('drops counts on a user switch (J)', async () => {
    await loadGallery();
    await mountGalleryPhoto('a');
    await mountGalleryPhoto('b');
    await mountGalleryPhoto('b');

    resetGallery();

    expect(owners()).toEqual({});
    expect(thumbnailOwnerAliasesForTesting()).toEqual({});
  });

  it('leaves no alias behind either', async () => {
    // An alias only exists after an optimistic upload swapped ids under a
    // mounted cell, so the upload has to actually happen — asserting on an
    // empty map that was never populated would prove nothing.
    await loadGallery();
    mocks.upload.mockImplementation(async () => {
      const localId = getGalleryState().photos.find((p) => p.uploadStatus === 'preparing')?.photoId;
      if (localId) await mountGalleryPhoto(localId);
      return photo('uploaded');
    });
    await addGalleryPhoto(UPLOAD);
    settleQueue();
    expect(thumbnailOwnerAliasesForTesting()).not.toEqual({});

    for (const listener of mocks.lockListeners) listener('locked');

    expect(thumbnailOwnerAliasesForTesting()).toEqual({});
    expect(owners()).toEqual({});
  });
});

describe('generation-scoped UI owners', () => {
  it('treats cleanup from the tree cleared by lock as stale, not underflow', async () => {
    await loadGallery();
    const oldOwner = claimGalleryThumbnail('a');
    expect(owners()).toEqual({ a: 1 });

    for (const listener of mocks.lockListeners) listener('locked');
    expect(owners()).toEqual({});

    releaseGalleryThumbnail(oldOwner);

    expect(owners()).toEqual({});
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('never lets an old cleanup decrement the same photo in a new generation', async () => {
    await loadGallery();
    const oldOwner = claimGalleryThumbnail('a');
    resetGallery();

    await loadGallery();
    const newOwner = claimGalleryThumbnail('a');
    expect(owners()).toEqual({ a: 1 });

    releaseGalleryThumbnail(oldOwner);
    expect(owners()).toEqual({ a: 1 });

    releaseGalleryThumbnail(newOwner);
    expect(owners()).toEqual({});
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('keeps grid and comparator independently balanced with owner handles', async () => {
    await loadGallery();
    const grid = claimGalleryThumbnail('a');
    const comparator = claimGalleryThumbnail('a');
    expect(owners()).toEqual({ a: 2 });

    releaseGalleryThumbnail(comparator);
    expect(owners()).toEqual({ a: 1 });
    releaseGalleryThumbnail(grid);
    expect(owners()).toEqual({});
  });

  it('still reports a duplicate release in the current generation', async () => {
    await loadGallery();
    const owner = claimGalleryThumbnail('a');
    releaseGalleryThumbnail(owner);
    releaseGalleryThumbnail(owner);

    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect((mocks.logError.mock.calls[0]?.[1] as Error).message).toBe(
      'vaultThumbnailOwnershipUnderflow',
    );
  });

  it('preserves optimistic-id aliasing for token owners', async () => {
    await loadGallery();
    let optimisticOwner: ReturnType<typeof claimGalleryThumbnail> | null = null;
    mocks.upload.mockImplementation(async () => {
      const localId = getGalleryState().photos.find(
        (entry) => entry.uploadStatus === 'preparing',
      )?.photoId;
      if (localId) optimisticOwner = claimGalleryThumbnail(localId);
      return photo('uploaded');
    });

    await addGalleryPhoto(UPLOAD);
    settleQueue();
    const realOwner = claimGalleryThumbnail('uploaded');
    expect(owners()).toEqual({ uploaded: 2 });

    releaseGalleryThumbnail(optimisticOwner!);
    expect(owners()).toEqual({ uploaded: 1 });
    releaseGalleryThumbnail(realOwner);
    expect(owners()).toEqual({});
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

describe('an optimistic upload changing id', () => {
  it('invents no claim when no surface was rendering the optimistic photo', async () => {
    await loadGallery();
    await addGalleryPhoto({
      sourceUri: 'file:///cache/photo-vault/tmp/pic.jpg',
      takenAt: new Date('2026-08-01T10:00:00Z'),
      originalMimeType: 'image/jpeg' as const,
      width: 1200,
      height: 1600,
    });

    // Nothing acquired the local id, so nothing may be carried to the real
    // one — a seeded count here would never be released.
    expect(owners()).toEqual({});
    expect(thumbnailOwnerAliasesForTesting()).toEqual({});
  });

  it('redirects the stale release the holding cell will still send', async () => {
    /**
     * The cell rendering the optimistic photo captured the local id in its
     * effect, so its cleanup releases that id after the swap. Without the
     * redirect the real id would keep a count nobody returns — pinning the
     * thumbnail for the rest of the session.
     */
    await loadGallery();
    await mountGalleryPhoto('a');

    const uploadParams = {
      sourceUri: 'file:///cache/photo-vault/tmp/pic.jpg',
      takenAt: new Date('2026-08-01T10:00:00Z'),
      originalMimeType: 'image/jpeg' as const,
      width: 1200,
      height: 1600,
    };
    let localId: string | null = null;
    mocks.upload.mockImplementation(async () => {
      localId = getGalleryState().photos.find((p) => p.uploadStatus === 'preparing')?.photoId ?? null;
      if (localId) await mountGalleryPhoto(localId); // the cell renders it
      return photo('uploaded');
    });

    await addGalleryPhoto(uploadParams);
    settleQueue();
    expect(localId).toBeTruthy();
    expect(owners().uploaded).toBe(1);

    unmountGalleryPhoto(localId!); // the cell re-renders and cleans up

    expect(owners().uploaded).toBeUndefined();
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

describe('the two cancellation layers', () => {
  /**
   * Releasing the last owner removes the photo from the queue, and the drain
   * also re-checks ownership before starting anything. Either alone would
   * hide a break in the other, so each is pinned by the effect only it has.
   */

  it('settles a pending mount immediately instead of waiting for a lane', async () => {
    // Only the queue removal does this. The drain's own guard cannot run
    // until some other download finishes and frees a lane.
    await loadWithQueueableGallery();
    suspendDownloads();
    await saturateLanes();

    const pending = mountGalleryPhoto(QUEUED);
    await Promise.resolve();

    unmountGalleryPhoto(QUEUED);

    const settled = await Promise.race([
      pending.then(() => 'settled'),
      Promise.resolve().then(() => 'still-pending'),
    ]);
    expect(settled).toBe('settled');
  });

  it('refuses to start a download for a photo no surface is showing', async () => {
    // Only the drain guard does this. The upload path calls `ensurePhotoLoaded`
    // for the new id directly, which enqueues it whether or not anything is
    // rendering it — nothing passed through a release to clean up after.
    await loadGallery();
    await addGalleryPhoto(UPLOAD);

    expect(owners()).toEqual({});
    expect(mocks.downloadThumbnail).not.toHaveBeenCalledWith(
      expect.objectContaining({ photoId: 'uploaded' }),
    );
  });
});

describe('the 15C regression (13)', () => {
  it('leaves the grid showing a photo after the comparator closes over it', async () => {
    await loadWithQueueableGallery();
    const downloads = suspendDownloads();
    await saturateLanes();

    // The grid mounts the photo; its decrypt queues behind the busy lanes.
    void mountGalleryPhoto(QUEUED);
    await Promise.resolve();

    // The comparator opens over the still-mounted grid and shows the same
    // photo, then closes again.
    void mountGalleryPhoto(QUEUED);
    await Promise.resolve();
    unmountGalleryPhoto(QUEUED);

    // The grid never re-announced — its cell never unmounted — so before the
    // refcount this photo stayed blank until it scrolled out and back.
    expect(owners()).toEqual(expect.objectContaining({ [QUEUED]: 1 }));

    await downloads.releaseAll();

    expect(getGalleryState().photos.find((p) => p.photoId === QUEUED)?.thumbnailUri).toBe(
      `data:image/jpeg;base64,THUMB-${QUEUED}`,
    );
  });
});
