import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The durable upload queue, driven the way real life drives it: interrupted,
 * offline, relocked, signed out, and restarted.
 *
 * The invariant every case here defends is the same one the local-first split
 * exists for — once a photo has been sealed, NOTHING may lose it, and nothing
 * may deliver it twice.
 */

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  currentUser: { uid: 'alice' } as { uid: string } | null,
  uuid: 0,
  // Durable blob store
  intact: vi.fn(),
  discardAsset: vi.fn(),
  discardUser: vi.fn(),
  listUids: vi.fn(),
  reconcileAssets: vi.fn(),
  // Remote primitives
  uploadAsset: vi.fn(),
  assetExists: vi.fn(),
  commitMetadata: vi.fn(),
  metadataState: vi.fn(),
  discardRemote: vi.fn(),
  contentPresence: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () =>
    `123e4567-e89b-42d3-a456-4266141740${String((mocks.uuid += 1)).padStart(2, '0')}`,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mocks.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mocks.storage.set(key, value);
    },
    removeItem: async (key: string) => {
      mocks.storage.delete(key);
    },
  },
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
  storage: {},
  auth: {
    get currentUser() {
      return mocks.currentUser;
    },
  },
}));

vi.mock('../photoVaultDurableStore', () => ({
  durableAssetIsIntact: (...args: unknown[]) => mocks.intact(...args),
  discardDurableAsset: (...args: unknown[]) => mocks.discardAsset(...args),
  discardDurableAssetsForUser: (...args: unknown[]) => mocks.discardUser(...args),
  listDurableUids: (...args: unknown[]) => mocks.listUids(...args),
  reconcileDurableAssets: (...args: unknown[]) => mocks.reconcileAssets(...args),
}));

vi.mock('../progressPhotos', () => ({
  uploadPreparedAsset: (...args: unknown[]) => mocks.uploadAsset(...args),
  preparedAssetExistsRemotely: (...args: unknown[]) => mocks.assetExists(...args),
  commitPreparedMetadata: (...args: unknown[]) => mocks.commitMetadata(...args),
  preparedMetadataState: (...args: unknown[]) => mocks.metadataState(...args),
  discardPreparedRemoteState: (...args: unknown[]) => mocks.discardRemote(...args),
  progressPhotoFromJob: (job: { documentId: string; assetId: string }) => ({
    photoId: job.documentId,
    assetId: job.assetId,
  }),
}));

vi.mock('../photoVaultContentPresence', () => ({
  setPhotoVaultContentPresence: (...args: unknown[]) => mocks.contentPresence(...args),
}));

import { PhotoVaultError } from '../../lib/photoVaultErrors';
import {
  JOB_MAX_AGE_MS,
  type PhotoVaultUploadJob,
} from '../../lib/photoVaultUploadJob';
import {
  cancelPhotoVaultUploadJob,
  enqueuePreparedPhoto,
  kickPhotoVaultUploadQueue,
  listPendingPhotoVaultJobs,
  purgePhotoVaultUploadsForUser,
  reconcilePhotoVaultUploadQueue,
  resetPhotoVaultUploadQueueForTesting,
  retryPhotoVaultUploadJob,
  subscribeToPhotoVaultUploadDropped,
  subscribeToPhotoVaultUploadSynced,
} from '../photoVaultUploadQueue';
import {
  readPhotoVaultUploadQueue,
  resetPhotoVaultUploadQueueCacheForTesting,
} from '../photoVaultUploadQueueStore';

const STORAGE_KEY = 'ajfit-photo-vault-upload-queue-v1';
const ASSET = '123e4567-e89b-42d3-a456-426614174001';

function encryption(iv: string) {
  return { version: 1, algorithm: 'AES-256-GCM', iv, vaultKeyVersion: 1 };
}

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'alice',
    assetId: ASSET,
    documentId: '2026-08-15_front',
    pose: 'front' as const,
    dateKey: '2026-08-15',
    takenAt: new Date('2026-08-15T12:00:00Z'),
    originalMimeType: 'image/jpeg' as const,
    encryptedSize: 2048,
    thumbnailEncryptedSize: 256,
    encryption: encryption('YWJjZGVmZ2hpamts'),
    thumbnailEncryption: encryption('bW5vcHFyc3R1dnd4'),
    ...overrides,
  };
}

/** Waits for the worker, which is kicked without being awaited. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

async function storedJobs(): Promise<PhotoVaultUploadJob[]> {
  return readPhotoVaultUploadQueue();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.clear();
  mocks.currentUser = { uid: 'alice' };
  mocks.uuid = 0;
  resetPhotoVaultUploadQueueForTesting();
  resetPhotoVaultUploadQueueCacheForTesting();

  mocks.intact.mockReturnValue(true);
  mocks.uploadAsset.mockResolvedValue(undefined);
  mocks.assetExists.mockResolvedValue(false);
  mocks.commitMetadata.mockResolvedValue(undefined);
  mocks.metadataState.mockResolvedValue('absent');
  mocks.discardRemote.mockResolvedValue(undefined);
  mocks.contentPresence.mockResolvedValue(undefined);
  mocks.listUids.mockReturnValue(['alice']);
  mocks.reconcileAssets.mockReturnValue(0);
});

describe('the happy path', () => {
  it('uploads both objects, writes the metadata and retires the job', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    const kinds = mocks.uploadAsset.mock.calls.map(([args]) => args.kind);
    expect(kinds.sort()).toEqual(['full', 'thumbnail']);
    expect(mocks.commitMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.contentPresence).toHaveBeenCalledWith('alice', true);
    // A synced job owns nothing any more.
    expect(await storedJobs()).toEqual([]);
    expect(mocks.discardAsset).toHaveBeenCalledWith('alice', ASSET);
  });

  it('announces the finished photo so the gallery can swap its card', async () => {
    const synced = vi.fn();
    subscribeToPhotoVaultUploadSynced(synced);

    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(synced).toHaveBeenCalledTimes(1);
    expect(synced.mock.calls[0]![0]).toMatchObject({ photoId: '2026-08-15_front' });
  });

  it('keeps what it uploaded when it succeeds', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    // Deleting the objects it just published would be catastrophic; only a
    // CANCELLED job clears the remote side.
    expect(mocks.discardRemote).not.toHaveBeenCalled();
  });
});

describe('surviving an interruption', () => {
  it('persists a checkpoint after each object, not just at the end', async () => {
    // The full upload lands; the thumbnail never does.
    mocks.uploadAsset.mockImplementation(async ({ kind }: { kind: string }) => {
      if (kind === 'thumbnail') throw new PhotoVaultError('vaultUploadFailed');
    });

    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    const [job] = await storedJobs();
    // Without this the retry would re-send the full image — and the Storage
    // rules would refuse it, stranding the job forever.
    expect(job!.uploadedFull).toBe(true);
    expect(job!.uploadedThumbnail).toBe(false);
    expect(job!.stage).toBe('pending-upload');
    expect(job!.state).toBe('failed');
  });

  it('only re-sends the object it still owes', async () => {
    mocks.uploadAsset.mockImplementationOnce(async () => undefined);
    mocks.uploadAsset.mockImplementationOnce(async () => {
      throw new PhotoVaultError('vaultUploadFailed');
    });
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();
    mocks.uploadAsset.mockClear();
    mocks.uploadAsset.mockResolvedValue(undefined);

    await retryPhotoVaultUploadJob((await storedJobs())[0]!.jobId);
    await settle();

    expect(mocks.uploadAsset).toHaveBeenCalledTimes(1);
    expect(mocks.uploadAsset.mock.calls[0]![0].kind).toBe('thumbnail');
  });

  it('recovers a successful upload whose checkpoint was lost to a kill', async () => {
    // Simulates the worst interleaving: the object reached Storage, then the
    // process died before the checkpoint could be written.
    mocks.uploadAsset.mockRejectedValueOnce(new PhotoVaultError('vaultUploadFailed'));
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    mocks.uploadAsset.mockClear();
    mocks.uploadAsset.mockResolvedValue(undefined);
    mocks.assetExists.mockResolvedValue(true); // both are actually there

    await retryPhotoVaultUploadJob((await storedJobs())[0]!.jobId);
    await settle();

    // It asked before writing, found both objects, and went straight to the
    // metadata instead of sending uploads the rules would deny.
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    expect(mocks.commitMetadata).toHaveBeenCalledTimes(1);
    expect(await storedJobs()).toEqual([]);
  });

  it('does not probe on the first attempt', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    // The case the user is watching pays nothing for crash recovery.
    expect(mocks.assetExists).not.toHaveBeenCalled();
  });

  it('treats its own already-written document as done rather than writing twice', async () => {
    mocks.commitMetadata.mockRejectedValueOnce(new PhotoVaultError('vaultMetadataCreateFailed'));
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    mocks.commitMetadata.mockClear();
    mocks.assetExists.mockResolvedValue(true);
    mocks.metadataState.mockResolvedValue('ours');

    await retryPhotoVaultUploadJob((await storedJobs())[0]!.jobId);
    await settle();

    // The rules forbid `update`, so a second `setDoc` would be refused —
    // and there is nothing to write anyway.
    expect(mocks.commitMetadata).not.toHaveBeenCalled();
    expect(await storedJobs()).toEqual([]);
  });

  it('gives up when the slot belongs to another device', async () => {
    const dropped = vi.fn();
    subscribeToPhotoVaultUploadDropped(dropped);
    mocks.commitMetadata.mockRejectedValueOnce(new PhotoVaultError('vaultMetadataCreateFailed'));
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    mocks.assetExists.mockResolvedValue(true);
    mocks.metadataState.mockResolvedValue('foreign');
    await retryPhotoVaultUploadJob((await storedJobs())[0]!.jobId);
    await settle();

    // No retry can ever resolve this, so the job is retired rather than left
    // failing forever — and what it uploaded is cleaned up.
    expect(await storedJobs()).toEqual([]);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(mocks.discardRemote).toHaveBeenCalled();
  });
});

describe('a photo is never lost', () => {
  it('keeps the job when the network is unavailable', async () => {
    mocks.uploadAsset.mockRejectedValue(new PhotoVaultError('vaultUploadFailed'));

    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    const [job] = await storedJobs();
    expect(job).toBeDefined();
    expect(job!.state).toBe('failed');
    // The ciphertext stays exactly where it is.
    expect(mocks.discardAsset).not.toHaveBeenCalled();
  });

  it('survives a process restart with its progress intact', async () => {
    mocks.uploadAsset.mockImplementation(async ({ kind }: { kind: string }) => {
      if (kind === 'thumbnail') throw new PhotoVaultError('vaultUploadFailed');
    });
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    // A cold start forgets everything in memory but not on disk.
    resetPhotoVaultUploadQueueCacheForTesting();
    resetPhotoVaultUploadQueueForTesting();
    const recovered = await reconcilePhotoVaultUploadQueue();

    expect(recovered.jobs).toBe(1);
    expect(recovered.droppedJobs).toBe(0);
    const [job] = await storedJobs();
    expect(job!.uploadedFull).toBe(true);
  });

  it('re-arms a job the last process was mid-upload on', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    // Exactly what a kill during a transfer leaves behind.
    mocks.storage.set(
      STORAGE_KEY,
      JSON.stringify((await storedJobs()).map((job) => ({ ...job, state: 'uploading' }))),
    );
    resetPhotoVaultUploadQueueCacheForTesting();

    await reconcilePhotoVaultUploadQueue();

    // Left as `uploading` it would never be picked up again by any worker.
    expect((await storedJobs())[0]!.state).toBe('pending');
  });
});

describe('cold-start reconciliation', () => {
  it('drops a job whose ciphertext is gone', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    resetPhotoVaultUploadQueueCacheForTesting();
    mocks.intact.mockReturnValue(false);

    const result = await reconcilePhotoVaultUploadQueue();

    // There is nothing left to upload; retrying forever against a missing
    // file would just keep a dead record alive.
    expect(result.droppedJobs).toBe(1);
    expect(await storedJobs()).toEqual([]);
  });

  it('drops a job nobody could send for a month', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    const aged = (await storedJobs()).map((job) => ({
      ...job,
      createdAt: Date.now() - JOB_MAX_AGE_MS - 1,
    }));
    mocks.storage.set(STORAGE_KEY, JSON.stringify(aged));
    resetPhotoVaultUploadQueueCacheForTesting();

    expect((await reconcilePhotoVaultUploadQueue()).droppedJobs).toBe(1);
  });

  it('keeps a job that is merely waiting', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    resetPhotoVaultUploadQueueCacheForTesting();

    const result = await reconcilePhotoVaultUploadQueue();

    // Ambiguity is resolved in favour of the photo, every time.
    expect(result.jobs).toBe(1);
    expect(result.droppedJobs).toBe(0);
    expect(mocks.discardAsset).not.toHaveBeenCalled();
  });

  it('reclaims blobs no surviving job claims', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    resetPhotoVaultUploadQueueCacheForTesting();

    await reconcilePhotoVaultUploadQueue();

    // Only the ids that are still claimed are handed to the sweep; anything
    // else on disk is unreachable by construction.
    expect(mocks.reconcileAssets).toHaveBeenCalledWith('alice', [ASSET]);
  });

  it('discards a record this build cannot parse', async () => {
    mocks.storage.set(STORAGE_KEY, JSON.stringify([{ version: 99, jobId: 'x' }]));
    resetPhotoVaultUploadQueueCacheForTesting();

    const result = await reconcilePhotoVaultUploadQueue();

    expect(result.jobs).toBe(0);
    // Its blob is now unclaimed, so the sweep is what reclaims it.
    expect(mocks.reconcileAssets).toHaveBeenCalledWith('alice', []);
  });
});

describe('identity isolation', () => {
  it('refuses to run anything while signed out', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    mocks.currentUser = null;

    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    // Suspended, not discarded: this is the user's only copy.
    expect(await storedJobs()).toHaveLength(1);
  });

  it('never runs one account’s job for another', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    mocks.currentUser = { uid: 'mallory' };

    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    expect(await storedJobs()).toHaveLength(1);
  });

  it('resumes the parked job when that account signs back in', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    mocks.currentUser = null;
    kickPhotoVaultUploadQueue('test');
    await settle();

    mocks.currentUser = { uid: 'alice' };
    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(mocks.commitMetadata).toHaveBeenCalledTimes(1);
  });

  it('shows a signed-out user no pending work at all', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    mocks.currentUser = null;

    expect(await listPendingPhotoVaultJobs()).toEqual([]);
  });

  it('shows another account no pending work at all', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    mocks.currentUser = { uid: 'mallory' };

    expect(await listPendingPhotoVaultJobs()).toEqual([]);
  });

  it('purges only the deleted account, and its blobs with it', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    await enqueuePreparedPhoto('mallory', prepared({ uid: 'mallory', assetId: ASSET }));

    await purgePhotoVaultUploadsForUser('alice');

    const remaining = await storedJobs();
    expect(remaining.map((job) => job.uid)).toEqual(['mallory']);
    expect(mocks.discardUser).toHaveBeenCalledWith('alice');
  });
});

describe('cancelling', () => {
  it('removes the record, the ciphertext and anything already published', async () => {
    await enqueuePreparedPhoto('alice', prepared());
    const [job] = await storedJobs();

    expect(await cancelPhotoVaultUploadJob(job!.jobId)).toBe(true);

    expect(await storedJobs()).toEqual([]);
    expect(mocks.discardAsset).toHaveBeenCalledWith('alice', ASSET);
    // Unlike a success, a cancellation must leave nothing behind remotely.
    expect(mocks.discardRemote).toHaveBeenCalled();
  });

  it('reports an unknown job rather than pretending', async () => {
    expect(await cancelPhotoVaultUploadJob('job-that-never-was')).toBe(false);
  });
});

describe('concurrency', () => {
  it('delivers three poses together rather than one after another', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.uploadAsset.mockImplementation(async ({ job }: { job: PhotoVaultUploadJob }) => {
      started.push(job.pose!);
      await gate;
    });

    for (const pose of ['front', 'side', 'back'] as const) {
      await enqueuePreparedPhoto(
        'alice',
        prepared({
          pose,
          documentId: `2026-08-15_${pose}`,
          assetId: `123e4567-e89b-42d3-a456-42661417400${pose === 'front' ? 1 : pose === 'side' ? 2 : 3}`,
        }),
      );
    }
    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(new Set(started)).toEqual(new Set(['front', 'side', 'back']));
    release();
  });

  it('never starts a second worker while one is running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.uploadAsset.mockImplementation(async () => { await gate; });

    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('a');
    kickPhotoVaultUploadQueue('b');
    kickPhotoVaultUploadQueue('c');
    await settle();

    // Three kicks, one upload in flight — otherwise the same object would be
    // sent several times over.
    expect(mocks.uploadAsset).toHaveBeenCalledTimes(1);
    release();
  });

  it('keeps three concurrent enqueues instead of losing two to a race', async () => {
    await Promise.all([
      enqueuePreparedPhoto('alice', prepared({ assetId: '123e4567-e89b-42d3-a456-426614174001', pose: 'front', documentId: '2026-08-15_front' })),
      enqueuePreparedPhoto('alice', prepared({ assetId: '123e4567-e89b-42d3-a456-426614174002', pose: 'side', documentId: '2026-08-15_side' })),
      enqueuePreparedPhoto('alice', prepared({ assetId: '123e4567-e89b-42d3-a456-426614174003', pose: 'back', documentId: '2026-08-15_back' })),
    ]);

    // A naive read-modify-write on one storage key would have kept only the
    // last of the three.
    expect(await storedJobs()).toHaveLength(3);
  });
});

describe('the worker needs no vault session', () => {
  it('never reaches for the key, the plaintext or the session', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/services/photoVaultUploadQueue.ts', 'utf8'),
    );

    // A relock hides the gallery; it must not strand a sealed photo. The only
    // way to guarantee that is for this module to have no way to ask.
    expect(source).not.toContain('requirePhotoVaultUnlocked');
    expect(source).not.toContain('requireSamePhotoVaultSession');
    expect(source).not.toContain('currentUnlockedUid');
    expect(source).not.toContain('ensurePhotoVaultKey');
    expect(source).not.toContain('photoVaultSession');
    // It moves envelopes; it never opens one. (The word appears in prose above
    // explaining exactly that, so match the calls rather than the letters.)
    expect(source).not.toMatch(/decryptBytes|decryptPhotoFile|decryptBytesToBase64/);
  });

  it('delivers a photo while the vault is locked', async () => {
    // No session is ever opened in this suite — every case above already runs
    // with the vault closed, which is the point.
    await enqueuePreparedPhoto('alice', prepared());
    kickPhotoVaultUploadQueue('test');
    await settle();

    expect(await storedJobs()).toEqual([]);
  });
});
