import { beforeEach, describe, expect, it, vi } from 'vitest';

const { FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(private readonly date: Date) {}
    static fromDate(date: Date) { return new FakeTimestamp(date); }
    toDate() { return this.date; }
  }
  return { FakeTimestamp };
});

const mocks = vi.hoisted(() => ({
  setDoc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), deleteDoc: vi.fn(),
  upload: vi.fn(), getBytes: vi.fn(), deleteObject: vi.fn(), storageRef: vi.fn(),
  ensureKey: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(),
  writeEncrypted: vi.fn(), discardEncrypted: vi.fn(), discardPlaintext: vi.fn(),
  describeEnvelope: vi.fn(), createThumbnail: vi.fn(),
  openUploadBlob: vi.fn(), closeUploadBlob: vi.fn(),
  readCache: vi.fn(), writeCache: vi.fn(), removeCache: vi.fn(),
  reconcileCache: vi.fn(), cacheEpoch: 7, decryptToBase64: vi.fn(),
  runTransaction: vi.fn(), txGet: vi.fn(), txDelete: vi.fn(),
  contentPresence: vi.fn(),
  currentUser: { uid: 'alice' } as { uid: string } | null,
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({
  // Shaped like a real v4 UUID: the identity layer validates this format,
  // and a placeholder id would not exercise the production path.
  randomUUID: () =>
    `123e4567-e89b-42d3-a456-4266141740${String((mocks.uuid += 1)).padStart(2, '0')}`,
}));
vi.mock('firebase/firestore', () => ({
  Timestamp: FakeTimestamp,
  collection: (...path: unknown[]) => ({ path: path.slice(1).join('/') }),
  doc: (...path: unknown[]) => ({ path: path.slice(1).join('/') }),
  setDoc: (...args: unknown[]) => mocks.setDoc(...args),
  getDoc: (...args: unknown[]) => mocks.getDoc(...args),
  getDocs: (...args: unknown[]) => mocks.getDocs(...args),
  deleteDoc: (...args: unknown[]) => mocks.deleteDoc(...args),
  orderBy: (field: string, dir: string) => ({ field, dir }),
  query: (base: unknown, ...clauses: unknown[]) => ({ base, clauses }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  runTransaction: (_db: unknown, work: (tx: unknown) => Promise<unknown>) =>
    mocks.runTransaction(work),
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => { mocks.storageRef(path); return { path }; },
  uploadBytesResumable: (...args: unknown[]) => mocks.upload(...args),
  getBytes: (...args: unknown[]) => mocks.getBytes(...args),
  deleteObject: (...args: unknown[]) => mocks.deleteObject(...args),
}));
vi.mock('../../lib/firebase', () => ({
  db: {}, storage: {},
  auth: { get currentUser() { return mocks.currentUser; } },
}));
vi.mock('../../lib/photoVaultCrypto', () => ({
  ENCRYPTION_VERSION: 1,
  ENCRYPTION_ALGORITHM: 'AES-256-GCM',
  describeEnvelope: (...args: unknown[]) => mocks.describeEnvelope(...args),
  decryptBytesToBase64: (...args: unknown[]) => mocks.decryptToBase64(...args),
}));
vi.mock('../photoVault', () => ({ ensurePhotoVaultKey: mocks.ensureKey }));
vi.mock('../photoVaultPicker', () => ({
  createPhotoVaultThumbnail: (...args: unknown[]) => mocks.createThumbnail(...args),
}));
vi.mock('../photoVaultFileCrypto', () => ({
  encryptPhotoFile: (...args: unknown[]) => mocks.encrypt(...args),
  decryptPhotoFile: (...args: unknown[]) => mocks.decrypt(...args),
  writeEncryptedFile: (...args: unknown[]) => mocks.writeEncrypted(...args),
  discardEncryptedPhoto: (...args: unknown[]) => mocks.discardEncrypted(...args),
  discardDecryptedPhoto: (...args: unknown[]) => mocks.discardPlaintext(...args),
}));
vi.mock('../photoVaultUploadBlob', () => ({
  openEncryptedUploadBlob: (...args: unknown[]) => mocks.openUploadBlob(...args),
  closeEncryptedUploadBlob: (...args: unknown[]) => mocks.closeUploadBlob(...args),
}));
// The cache's own filesystem behaviour is covered by its dedicated suite; here
// it is a seam so these cases can assert cache hit/miss against Storage calls.
vi.mock('../photoVaultEncryptedCache', () => ({
  currentPhotoVaultCacheEpoch: () => mocks.cacheEpoch,
  readCachedThumbnail: (...args: unknown[]) => mocks.readCache(...args),
  writeCachedThumbnail: (...args: unknown[]) => mocks.writeCache(...args),
  removeCachedThumbnail: (...args: unknown[]) => mocks.removeCache(...args),
  reconcileCachedThumbnails: (...args: unknown[]) => mocks.reconcileCache(...args),
}));
vi.mock('../photoVaultContentPresence', () => ({
  reconcilePhotoVaultContentPresence: (...args: unknown[]) =>
    mocks.contentPresence(...args),
  setPhotoVaultContentPresence: (...args: unknown[]) =>
    mocks.contentPresence(...args),
}));

import { PhotoVaultError } from '../../lib/photoVaultErrors';
import { closePhotoVaultSession, openPhotoVaultSession } from '../../lib/photoVaultSession';
import {
  MAX_ENCRYPTED_BYTES,
  MAX_THUMBNAIL_ENCRYPTED_BYTES,
  deleteProgressPhoto,
  downloadProgressPhoto,
  downloadProgressPhotoThumbnail,
  listProgressPhotos,
  reconcileProgressPhotoCache,
  replaceProgressPhoto,
  uploadProgressPhoto,
} from '../progressPhotos';

const UID = 'alice';
const OTHER_UID = 'mallory';
const KEY = 'A'.repeat(43) + '=';
const FULL_IV = 'YWJjZGVmZ2hpamts';
const THUMB_IV = 'bW5vcHFyc3R1dnd4';
const FULL_SIZE = 2048;
const THUMB_SIZE = 256;
const TAKEN_AT = new Date('2026-08-01T10:00:00Z');
/** Matches the first id the mocked randomUUID hands out. */
const ASSET_1 = '123e4567-e89b-42d3-a456-426614174001';
const ASSET_2 = '123e4567-e89b-42d3-a456-426614174002';
/** A pre-Phase-13 photo: no thumbnail metadata at all. */
const LEGACY_ASSET = '123e4567-e89b-42d3-a456-426614174011';

function fakeNativeBlob(size: number): Blob {
  return {
    size,
    type: 'application/octet-stream',
    slice: vi.fn(),
    arrayBuffer: vi.fn(),
    bytes: vi.fn(),
    stream: vi.fn(),
    text: vi.fn(),
  } as unknown as Blob;
}

function encryption(iv: string) {
  return { version: 1, algorithm: 'AES-256-GCM', iv, vaultKeyVersion: 1 };
}

function metadata(id = ASSET_1, withThumbnail = true, overrides: Record<string, unknown> = {}) {
  const base = {
    photoId: id,
    // Pre-pose photos are named after their asset, so the two coincide.
    assetId: id,
    storagePath: `users/${UID}/progressPhotos/${id}.enc`,
    createdAt: null,
    takenAt: TAKEN_AT,
    originalMimeType: 'image/jpeg',
    encryptedSize: FULL_SIZE,
    encryption: encryption(FULL_IV),
  };
  return withThumbnail
    ? {
        ...base,
        thumbnailStoragePath: `users/${UID}/progressPhotos/${id}.thumb.enc`,
        thumbnailEncryptedSize: THUMB_SIZE,
        thumbnailEncryption: encryption(THUMB_IV),
        ...overrides,
      }
    : { ...base, ...overrides };
}

function storedDoc(id = ASSET_1, withThumbnail = true, overrides: Record<string, unknown> = {}) {
  // A stored pre-pose document has neither photoId nor assetId in its body.
  const { photoId: _photoId, assetId: _assetId, ...data } = metadata(id, withThumbnail, overrides);
  return {
    ...data,
    createdAt: new FakeTimestamp(new Date('2026-08-02T00:00:00Z')),
    takenAt: new FakeTimestamp(TAKEN_AT),
  };
}

function issueOf(error: unknown): string {
  return (error as { issue?: string }).issue ?? 'none';
}

const uploadInput = {
  sourceUri: 'file:///cache/photo-vault/tmp/full.jpg',
  takenAt: TAKEN_AT,
  originalMimeType: 'image/jpeg' as const,
  width: 1200,
  height: 1600,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uuid = 0;
  mocks.currentUser = { uid: UID };
  openPhotoVaultSession(UID);
  mocks.ensureKey.mockResolvedValue({
    status: 'local-key-available', vaultKey: KEY, vaultKeyVersion: 1,
  });
  mocks.createThumbnail.mockResolvedValue({
    uri: 'file:///cache/photo-vault/tmp/thumb.jpg', size: 220, width: 300, height: 400,
  });
  mocks.encrypt.mockImplementation(async ({ sourceUri }: { sourceUri: string }) => {
    const thumbnail = sourceUri.endsWith('/thumb.jpg');
    return {
      encryptedUri: thumbnail ? 'file:///cache/photo-vault/enc/thumb.enc' : 'file:///cache/photo-vault/enc/full.enc',
      encryptedSize: thumbnail ? THUMB_SIZE : FULL_SIZE,
      encryption: encryption(thumbnail ? THUMB_IV : FULL_IV),
    };
  });
  mocks.openUploadBlob.mockImplementation(async (uri: string) =>
    fakeNativeBlob(uri.endsWith('/thumb.enc') ? THUMB_SIZE : FULL_SIZE),
  );
  mocks.upload.mockImplementation((_objectRef: unknown, blob: Blob) => ({
    on: (
      _event: string,
      progress: (snapshot: { bytesTransferred: number; totalBytes: number }) => void,
      _error: (error: unknown) => void,
      complete: () => void,
    ) => {
      progress({ bytesTransferred: blob.size, totalBytes: blob.size });
      complete();
    },
  }));
  mocks.setDoc.mockResolvedValue(undefined);
  mocks.deleteObject.mockResolvedValue(undefined);
  mocks.deleteDoc.mockResolvedValue(undefined);
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => storedDoc() });
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.getBytes.mockImplementation(async (objectRef: { path: string }) =>
    new Uint8Array(objectRef.path.includes('.thumb.') ? THUMB_SIZE : FULL_SIZE).buffer,
  );
  mocks.describeEnvelope.mockImplementation((bytes: Uint8Array) => ({
    version: 1,
    iv: bytes.length === THUMB_SIZE ? THUMB_IV : FULL_IV,
  }));
  mocks.writeEncrypted.mockReturnValue({ uri: 'file:///cache/photo-vault/enc/download.enc' });
  mocks.decrypt.mockResolvedValue({ uri: 'file:///cache/photo-vault/tmp/output.jpg', size: 100 });
  // Default: nothing cached, so each case opts in to a hit explicitly.
  mocks.readCache.mockResolvedValue(null);
  mocks.writeCache.mockReturnValue(true);
  mocks.decryptToBase64.mockResolvedValue('QkFTRTY0');
  // The compare-and-swap runs the caller's callback against a fake transaction.
  mocks.runTransaction.mockImplementation(
    async (work: (tx: unknown) => Promise<unknown>) =>
      work({ get: mocks.txGet, delete: mocks.txDelete }),
  );
});

describe('dual encrypted upload', () => {
  it('marks content present only after the first photo is durably committed', async () => {
    await uploadProgressPhoto(uploadInput);

    expect(mocks.contentPresence).toHaveBeenCalledWith(UID, true);
    expect(mocks.contentPresence.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.setDoc.mock.invocationCallOrder[0]!,
    );
  });

  it('does not mark content present when the upload fails', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore'));

    await uploadProgressPhoto(uploadInput).catch(() => undefined);

    expect(mocks.contentPresence).not.toHaveBeenCalled();
  });

  it('generates a grid thumbnail and encrypts full/thumb independently', async () => {
    await uploadProgressPhoto(uploadInput);

    expect(mocks.createThumbnail).toHaveBeenCalledWith({
      sourceUri: uploadInput.sourceUri, width: 1200, height: 1600,
    });
    expect(mocks.encrypt).toHaveBeenCalledTimes(2);
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.objectContaining({ sourceUri: uploadInput.sourceUri }));
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.objectContaining({ sourceUri: expect.stringContaining('thumb.jpg') }));
  });

  it('uploads only ciphertext to exact full and thumbnail paths', async () => {
    await uploadProgressPhoto(uploadInput);

    expect(mocks.storageRef).toHaveBeenCalledWith(`users/${UID}/progressPhotos/${ASSET_1}.enc`);
    expect(mocks.storageRef).toHaveBeenCalledWith(`users/${UID}/progressPhotos/${ASSET_1}.thumb.enc`);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.openUploadBlob).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls.every((call) => !ArrayBuffer.isView(call[1]))).toBe(true);
    expect(mocks.upload.mock.calls.map((call) => (call[1] as Blob).size)).toEqual(
      expect.arrayContaining([FULL_SIZE, THUMB_SIZE]),
    );
    expect(mocks.upload.mock.calls.map((call) => call[2])).toEqual(expect.arrayContaining([
      {
        contentType: 'application/octet-stream',
        customMetadata: { ownerId: UID, photoId: ASSET_1, assetKind: 'full' },
      },
      {
        contentType: 'application/octet-stream',
        customMetadata: { ownerId: UID, photoId: ASSET_1, assetKind: 'thumbnail' },
      },
    ]));
    expect(JSON.stringify(mocks.upload.mock.calls)).not.toContain(uploadInput.sourceUri);
  });

  it('writes closed thumbnail metadata after both uploads', async () => {
    await uploadProgressPhoto(uploadInput);
    const written = mocks.setDoc.mock.calls[0]![1] as Record<string, unknown>;

    expect(Object.keys(written).sort()).toEqual([
      'createdAt', 'encryptedSize', 'encryption', 'originalMimeType', 'storagePath',
      'takenAt', 'thumbnailEncryptedSize', 'thumbnailEncryption', 'thumbnailStoragePath',
    ]);
    expect(written.thumbnailStoragePath).toBe(`users/${UID}/progressPhotos/${ASSET_1}.thumb.enc`);
    expect((written.encryption as { iv: string }).iv).not.toBe(
      (written.thumbnailEncryption as { iv: string }).iv,
    );
    expect(JSON.stringify(written)).not.toMatch(/downloadURL|signedUrl|wrappedVaultKey/);
  });

  it('reports weighted real upload progress and removes all local temporaries', async () => {
    const seen: number[] = [];
    await uploadProgressPhoto({ ...uploadInput, onProgress: (value) => seen.push(value) });

    expect(seen.at(-1)).toBe(1);
    expect(mocks.discardEncrypted).toHaveBeenCalledWith(expect.stringContaining('full.enc'));
    expect(mocks.discardEncrypted).toHaveBeenCalledWith(expect.stringContaining('thumb.enc'));
    expect(mocks.discardPlaintext).toHaveBeenCalledWith(expect.stringContaining('thumb.jpg'));
    expect(mocks.closeUploadBlob).toHaveBeenCalledTimes(2);
  });

  it('rejects nonce reuse before touching Storage', async () => {
    mocks.encrypt.mockResolvedValue({
      encryptedUri: 'file:///cache/photo-vault/enc/same.enc',
      encryptedSize: THUMB_SIZE,
      encryption: encryption(FULL_IV),
    });
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultCryptoEncryptFailed');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('enforces the independent thumbnail size ceiling', async () => {
    mocks.encrypt.mockImplementation(async ({ sourceUri }: { sourceUri: string }) => ({
      encryptedUri: sourceUri.endsWith('/thumb.jpg') ? 'file:///thumb.enc' : 'file:///full.enc',
      encryptedSize: sourceUri.endsWith('/thumb.jpg')
        ? MAX_THUMBNAIL_ENCRYPTED_BYTES + 1
        : FULL_SIZE,
      encryption: encryption(sourceUri.endsWith('/thumb.jpg') ? THUMB_IV : FULL_IV),
    }));
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultPhotoTooLarge');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rolls both paths back when either upload fails', async () => {
    let call = 0;
    mocks.upload.mockImplementation(() => ({
      on: (_event: string, _progress: unknown, reject: (error: unknown) => void, resolve: () => void) => {
        call += 1;
        if (call === 2) reject(new Error('thumb upload failed'));
        else resolve();
      },
    }));
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultUploadFailed');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('also rolls back the thumbnail path when the full upload fails first', async () => {
    let call = 0;
    mocks.upload.mockImplementation(() => ({
      on: (_event: string, _progress: unknown, reject: (error: unknown) => void, resolve: () => void) => {
        call += 1;
        if (call === 1) reject(new Error('full upload failed'));
        else resolve();
      },
    }));
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultUploadFailed');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('reports clean metadata failure only after both rollback deletes succeed', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore'));
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultMetadataCreateFailed');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('rolls both objects back when Firestore fails, and reports rollback failure', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore'));
    mocks.deleteObject.mockRejectedValueOnce(new Error('offline'));
    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultUploadRollbackFailed');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  /**
   * A denied delete and a transient one both surface as
   * `vaultUploadRollbackFailed`. Only the provider code separates "this
   * account may not touch the vault at all" from "the network dropped", so
   * losing it makes the failure undiagnosable in the field.
   */
  it('logs the provider code of the failed rollback delete, not just the issue', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.setDoc.mockRejectedValue(new Error('firestore'));
      mocks.deleteObject.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { code: 'storage/unauthorized' }),
      );

      const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);

      expect(issueOf(error)).toBe('vaultUploadRollbackFailed');
      expect(logged).toHaveBeenCalledWith(
        '[photoVault:progressPhotos]',
        expect.objectContaining({
          issue: 'vaultUploadRollbackFailed',
          providerCode: 'storage/unauthorized',
        }),
      );
    } finally {
      logged.mockRestore();
    }
  });

  /** The rollback outranks it as the thrown issue, but must not erase it. */
  it('still logs why the upload failed when the rollback also fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.upload.mockImplementation(() => ({
        on: (
          _event: string,
          _progress: unknown,
          reject: (error: unknown) => void,
        ) => reject(Object.assign(new Error('denied'), { code: 'storage/unauthorized' })),
      }));
      mocks.deleteObject.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'storage/unauthorized' }),
      );

      const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);

      expect(issueOf(error)).toBe('vaultUploadRollbackFailed');
      expect(logged).toHaveBeenCalledWith(
        '[photoVault:progressPhotos]',
        expect.objectContaining({
          issue: 'vaultUploadFailed',
          providerCode: 'storage/unauthorized',
        }),
      );
    } finally {
      logged.mockRestore();
    }
  });
});

describe('listing compatibility', () => {
  function snapshotOf(entries: { id: string; data: Record<string, unknown> }[]) {
    return { docs: entries.map((entry) => ({ id: entry.id, data: () => entry.data })) };
  }

  it('reconciles false from an authenticated empty listing', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([]));

    await listProgressPhotos();

    expect(mocks.contentPresence).toHaveBeenCalledWith(UID, false);
  });

  it('reconciles true from an authenticated non-empty listing', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([
      { id: ASSET_1, data: storedDoc(ASSET_1, true) },
    ]));

    await listProgressPhotos();

    expect(mocks.contentPresence).toHaveBeenCalledWith(UID, true);
  });

  it('accepts both legacy and complete thumbnail schemas', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([
      { id: '123e4567-e89b-42d3-a456-426614174011', data: storedDoc('123e4567-e89b-42d3-a456-426614174011', false) },
      { id: '123e4567-e89b-42d3-a456-426614174012', data: storedDoc('123e4567-e89b-42d3-a456-426614174012', true) },
    ]));
    const photos = await listProgressPhotos();
    expect(photos).toHaveLength(2);
    expect(photos[0]?.thumbnailStoragePath).toBeUndefined();
    expect(photos[1]?.thumbnailStoragePath).toContain('.thumb.enc');
  });

  it('rejects partial thumbnail metadata and reused IVs', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([
      { id: '123e4567-e89b-42d3-a456-426614174013', data: storedDoc('123e4567-e89b-42d3-a456-426614174013', false, { thumbnailStoragePath: `users/${UID}/progressPhotos/123e4567-e89b-42d3-a456-426614174013.thumb.enc` }) },
      { id: '123e4567-e89b-42d3-a456-426614174014', data: storedDoc('123e4567-e89b-42d3-a456-426614174014', true, { thumbnailEncryption: encryption(FULL_IV) }) },
    ]));
    expect(await listProgressPhotos()).toEqual([]);
  });

  it('queries only the current user ordered newest-first', async () => {
    await listProgressPhotos();
    const [{ base, clauses }] = mocks.getDocs.mock.calls[0] as [{ base: { path: string }; clauses: unknown[] }];
    expect(base.path).toBe(`users/${UID}/progressPhotos`);
    expect(clauses).toContainEqual({ field: 'takenAt', dir: 'desc' });
  });
});

describe('asset downloads', () => {
  it('downloads only the thumbnail for a modern grid card without rereading Firestore', async () => {
    const result = await downloadProgressPhotoThumbnail(metadata());
    expect(result.isFullImage).toBe(false);
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringContaining('.thumb.enc'));
    expect(mocks.getBytes.mock.calls[0]?.[1]).toBe(MAX_THUMBNAIL_ENCRYPTED_BYTES);
  });

  it('falls back to full for a legacy grid card', async () => {
    const result = await downloadProgressPhotoThumbnail(metadata('123e4567-e89b-42d3-a456-426614174011', false));
    expect(result.isFullImage).toBe(true);
    expect(mocks.storageRef).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`${LEGACY_ASSET}\\.enc$`)),
    );
  });

  it('falls back to full only when declared thumbnail is actually missing', async () => {
    mocks.getBytes
      .mockRejectedValueOnce(
        Object.assign(new Error('gone'), { code: 'storage/object-not-found' }),
      )
      .mockResolvedValueOnce(new Uint8Array(FULL_SIZE).buffer);
    const result = await downloadProgressPhotoThumbnail(metadata());
    expect(result.isFullImage).toBe(true);
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringContaining('.thumb.enc'));
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${ASSET_1}\\.enc$`)));
  });

  it('viewer downloads the full asset and validates size/nonce before decrypt', async () => {
    await downloadProgressPhoto(metadata());
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${ASSET_1}\\.enc$`)));
    expect(mocks.getBytes.mock.calls[0]?.[1]).toBe(MAX_ENCRYPTED_BYTES);
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered envelope and always removes downloaded ciphertext', async () => {
    mocks.describeEnvelope.mockReturnValue({ version: 1, iv: 'wrong' });
    const error = await downloadProgressPhoto(metadata()).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultDownloadIntegrityFailed');
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('cannot be redirected to another user path', async () => {
    const forged = metadata(ASSET_1, true, {
      storagePath: `users/${OTHER_UID}/progressPhotos/${ASSET_1}.enc`,
    });
    const error = await downloadProgressPhoto(forged).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultMetadataInvalid');
    expect(mocks.getBytes).not.toHaveBeenCalled();
  });
});

describe('delete and gates', () => {
  it('deletes full and thumbnail without key access or decryption, then metadata', async () => {
    await deleteProgressPhoto(metadata());
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringContaining('.thumb.enc'));
    expect(mocks.ensureKey).not.toHaveBeenCalled();
    expect(mocks.getBytes).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.deleteDoc.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...mocks.deleteObject.mock.invocationCallOrder),
    );
    // This layer cannot know whether another gallery item remains. The caller
    // updates false only after the confirmed delete leaves its authority empty.
    expect(mocks.contentPresence).not.toHaveBeenCalled();
  });

  it('keeps metadata and reports partial delete if thumbnail went but full remains', async () => {
    mocks.deleteObject.mockRejectedValueOnce(Object.assign(new Error('retry'), { code: 'storage/retry' }));
    const error = await deleteProgressPhoto(metadata()).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultPartialDelete');
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('reports a plain delete failure when neither object changed', async () => {
    mocks.deleteObject.mockRejectedValue(Object.assign(new Error('retry'), { code: 'storage/retry' }));
    const error = await deleteProgressPhoto(metadata()).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultDeleteFailed');
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('removes metadata if full is gone even when thumbnail becomes an orphan', async () => {
    mocks.deleteObject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('retry'), { code: 'storage/retry' }));
    await expect(deleteProgressPhoto(metadata())).resolves.toBeUndefined();
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('treats missing objects as idempotent and reports Firestore partial delete', async () => {
    mocks.deleteObject.mockRejectedValue(
      Object.assign(new Error('gone'), { code: 'storage/object-not-found' }),
    );
    mocks.deleteDoc.mockRejectedValue(new Error('offline'));
    const error = await deleteProgressPhoto(metadata()).catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultPartialDelete');
  });

  it('blocks upload/list/download/delete while locked', async () => {
    closePhotoVaultSession();
    for (const operation of [
      () => uploadProgressPhoto(uploadInput),
      () => listProgressPhotos(),
      () => downloadProgressPhoto(metadata()),
      () => deleteProgressPhoto(metadata()),
    ]) {
      const error = await operation().catch((caught) => caught);
      expect(issueOf(error)).toBe('vaultLocked');
    }
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.getBytes).not.toHaveBeenCalled();
    expect(mocks.contentPresence).not.toHaveBeenCalled();
  });
});

describe('encrypted thumbnail cache', () => {
  function cachedEnvelope(): Uint8Array {
    return new Uint8Array(THUMB_SIZE).fill(3);
  }

  it('serves a cache hit without touching Firebase Storage', async () => {
    mocks.readCache.mockResolvedValue(cachedEnvelope());

    const result = await downloadProgressPhotoThumbnail(metadata());

    expect(result.isFullImage).toBe(false);
    expect(mocks.getBytes).not.toHaveBeenCalled();
    expect(mocks.writeCache).not.toHaveBeenCalled();
    expect(mocks.decryptToBase64).toHaveBeenCalledTimes(1);
  });

  it('returns a memory-only data URI and never a file path', async () => {
    mocks.readCache.mockResolvedValue(cachedEnvelope());
    mocks.decryptToBase64.mockResolvedValue('SU1BR0U=');

    const result = await downloadProgressPhotoThumbnail(metadata());

    expect(result).toEqual(
      expect.objectContaining({ isFullImage: false, dataUri: 'data:image/jpeg;base64,SU1BR0U=' }),
    );
    // The plaintext pipeline that writes a decrypted file is not involved.
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.writeEncrypted).not.toHaveBeenCalled();
  });

  it('downloads once on a miss and stores the ciphertext for next time', async () => {
    const result = await downloadProgressPhotoThumbnail(metadata());

    expect(result.isFullImage).toBe(false);
    expect(mocks.getBytes).toHaveBeenCalledTimes(1);
    expect(mocks.writeCache).toHaveBeenCalledWith(
      expect.objectContaining({ uid: UID, photoId: ASSET_1, epoch: 7 }),
    );
  });

  it('caches the exact bytes it validated', async () => {
    await downloadProgressPhotoThumbnail(metadata());
    const stored = mocks.writeCache.mock.calls[0]![0] as { bytes: Uint8Array };
    expect(stored.bytes.length).toBe(THUMB_SIZE);
  });

  it('does not re-read the file it just wrote', async () => {
    await downloadProgressPhotoThumbnail(metadata());
    // One lookup at the start; the decrypt runs off the downloaded buffer.
    expect(mocks.readCache).toHaveBeenCalledTimes(1);
  });

  it('renders a photo whose cache write failed', async () => {
    mocks.writeCache.mockReturnValue(false);
    const result = await downloadProgressPhotoThumbnail(metadata());
    expect(result.isFullImage).toBe(false);
  });

  it('drops a corrupted entry and redownloads exactly once', async () => {
    mocks.readCache.mockResolvedValue(cachedEnvelope());
    mocks.decryptToBase64
      .mockRejectedValueOnce(new PhotoVaultError('vaultCryptoIntegrityFailed'))
      .mockResolvedValueOnce('UkVDT1ZFUkVE');

    const result = await downloadProgressPhotoThumbnail(metadata());

    expect(mocks.removeCache).toHaveBeenCalledWith(UID, ASSET_1);
    expect(mocks.getBytes).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ dataUri: 'data:image/jpeg;base64,UkVDT1ZFUkVE' }),
    );
  });

  it('rejects a cached envelope whose framing disagrees with the metadata', async () => {
    mocks.readCache.mockResolvedValue(cachedEnvelope());
    mocks.describeEnvelope.mockReturnValueOnce({ version: 1, iv: 'tampered' });

    await downloadProgressPhotoThumbnail(metadata());

    // Never decrypted from the bad local copy; it was dropped and refetched.
    expect(mocks.removeCache).toHaveBeenCalledWith(UID, ASSET_1);
    expect(mocks.getBytes).toHaveBeenCalledTimes(1);
  });

  it('surfaces a real failure when the redownload also fails', async () => {
    mocks.readCache.mockResolvedValue(cachedEnvelope());
    mocks.decryptToBase64.mockRejectedValue(new PhotoVaultError('vaultCryptoIntegrityFailed'));

    const error = await downloadProgressPhotoThumbnail(metadata()).catch((caught) => caught);

    expect(issueOf(error)).toBe('vaultCryptoIntegrityFailed');
    // Exactly one retry, never a loop.
    expect(mocks.getBytes).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached thumbnail when the photo is deleted', async () => {
    await deleteProgressPhoto(metadata());
    expect(mocks.removeCache).toHaveBeenCalledWith(UID, ASSET_1);
  });

  it('does not cache the legacy full fallback', async () => {
    await downloadProgressPhotoThumbnail(metadata('123e4567-e89b-42d3-a456-426614174011', false));
    expect(mocks.readCache).not.toHaveBeenCalled();
    expect(mocks.writeCache).not.toHaveBeenCalled();
  });

  it('leaves the viewer full pipeline on its temporary-file path', async () => {
    await downloadProgressPhoto(metadata());
    expect(mocks.readCache).not.toHaveBeenCalled();
    expect(mocks.writeCache).not.toHaveBeenCalled();
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
    expect(mocks.decryptToBase64).not.toHaveBeenCalled();
  });
});

describe('session races', () => {
  /**
   * Suspends a mock at its call site so the test can act while the operation
   * is genuinely mid-flight, rather than guessing at tick counts.
   */
  function suspend<T>(mock: { mockImplementation: (fn: () => Promise<T>) => unknown }) {
    let release!: (value: T) => void;
    let entered!: () => void;
    const gate = new Promise<T>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    mock.mockImplementation(() => { entered(); return gate; });
    return { reached, release: (value: T) => release(value) };
  }

  it('discards a download that completes after the session closed', async () => {
    const download = suspend<ArrayBuffer>(mocks.getBytes);

    const pending = downloadProgressPhotoThumbnail(metadata());
    await download.reached;
    // The user logs out while the download is still in flight.
    closePhotoVaultSession();
    download.release(new Uint8Array(THUMB_SIZE).buffer);

    const error = await pending.catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultLocked');
  });

  it('discards a download that completes after a switch back to the same account', async () => {
    const download = suspend<ArrayBuffer>(mocks.getBytes);

    const pending = downloadProgressPhotoThumbnail(metadata());
    await download.reached;
    // A logout/login cycle of the SAME account: the uid matches again, so only
    // the session generation can tell these apart.
    closePhotoVaultSession();
    openPhotoVaultSession(UID);
    download.release(new Uint8Array(THUMB_SIZE).buffer);

    const error = await pending.catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultLocked');
  });

  it('discards a cache hit that resolves after the session closed', async () => {
    const read = suspend<Uint8Array>(mocks.readCache);

    const pending = downloadProgressPhotoThumbnail(metadata());
    await read.reached;
    closePhotoVaultSession();
    read.release(new Uint8Array(THUMB_SIZE).fill(3));

    const error = await pending.catch((caught) => caught);
    expect(issueOf(error)).toBe('vaultLocked');
    // A closed session is not corruption: the entry must survive, and no
    // pointless redownload may be attempted for a signed-out user.
    expect(mocks.removeCache).not.toHaveBeenCalled();
    expect(mocks.getBytes).not.toHaveBeenCalled();
  });
});

// ── Posed schema (phase 14B) ───────────────────────────────────────────────
//
// A posed photo is addressed by TWO identifiers: the Firestore document is
// named `{dateKey}_{pose}` so the database enforces one photo per pose per
// day, while the ciphertext keeps an opaque UUID so no object name reveals
// the day or the pose.

const POSED_ASSET = '123e4567-e89b-42d3-a456-426614174021';
const POSED_DATE = '2026-08-01';
const POSED_DOC = `${POSED_DATE}_front`;

/** A stored posed document, as Firestore would return it. */
function posedStoredDoc(overrides: Record<string, unknown> = {}, assetId = POSED_ASSET) {
  return {
    storagePath: `users/${UID}/progressPhotos/${assetId}.enc`,
    thumbnailStoragePath: `users/${UID}/progressPhotos/${assetId}.thumb.enc`,
    assetId,
    dateKey: POSED_DATE,
    pose: 'front',
    createdAt: new FakeTimestamp(new Date('2026-08-02T00:00:00Z')),
    takenAt: new FakeTimestamp(TAKEN_AT),
    originalMimeType: 'image/jpeg',
    encryptedSize: FULL_SIZE,
    thumbnailEncryptedSize: THUMB_SIZE,
    encryption: encryption(FULL_IV),
    thumbnailEncryption: encryption(THUMB_IV),
    ...overrides,
  };
}

async function listOne(id: string, data: unknown) {
  mocks.getDocs.mockResolvedValue({ docs: [{ id, data: () => data }] });
  return listProgressPhotos();
}

describe('posed schema parsing', () => {
  it('reads a posed document and separates the two identifiers', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());

    expect(photo?.photoId).toBe(POSED_DOC);
    expect(photo?.assetId).toBe(POSED_ASSET);
    expect(photo?.pose).toBe('front');
    expect(photo?.dateKey).toBe(POSED_DATE);
    expect(photo?.storagePath).toBe(`users/${UID}/progressPhotos/${POSED_ASSET}.enc`);
  });

  it('leaves pose and dateKey undefined on earlier photos', async () => {
    const [legacy] = await listOne(LEGACY_ASSET, storedDoc(LEGACY_ASSET, false));
    expect(legacy?.pose).toBeUndefined();
    expect(legacy?.dateKey).toBeUndefined();
    // A pre-pose document is named after its own asset.
    expect(legacy?.assetId).toBe(LEGACY_ASSET);
    expect(legacy?.photoId).toBe(LEGACY_ASSET);
  });

  it('still reads a phase-13 document', async () => {
    const [photo] = await listOne(ASSET_1, storedDoc(ASSET_1, true));
    expect(photo?.assetId).toBe(ASSET_1);
    expect(photo?.thumbnailStoragePath).toBe(
      `users/${UID}/progressPhotos/${ASSET_1}.thumb.enc`,
    );
  });

  const rejects = (name: string, id: string, data: unknown) =>
    it(name, async () => {
      expect(await listOne(id, data)).toEqual([]);
    });

  // A half-written shape must never be downgraded to an earlier generation.
  rejects('rejects pose without assetId or dateKey', POSED_DOC, {
    ...storedDoc(ASSET_1, true),
    pose: 'front',
  });
  rejects(
    'rejects assetId and dateKey without pose',
    POSED_DOC,
    (() => {
      const { pose: _omitted, ...rest } = posedStoredDoc();
      return rest;
    })(),
  );
  rejects(
    'rejects assetId and pose without dateKey',
    POSED_DOC,
    (() => {
      const { dateKey: _omitted, ...rest } = posedStoredDoc();
      return rest;
    })(),
  );
  rejects(
    'rejects dateKey and pose without assetId',
    POSED_DOC,
    (() => {
      const { assetId: _omitted, ...rest } = posedStoredDoc();
      return rest;
    })(),
  );

  rejects('rejects a non uuid assetId', POSED_DOC, posedStoredDoc({ assetId: 'nope' }, 'nope'));
  rejects('rejects an unlisted pose', `${POSED_DATE}_profile`, posedStoredDoc({ pose: 'profile' }));
  rejects('rejects a malformed dateKey', '2026-8-1_front', posedStoredDoc({ dateKey: '2026-8-1' }));
  rejects('rejects a document id that disagrees with the fields', '2026-08-09_front', posedStoredDoc());
  rejects('rejects a document id with the wrong pose', `${POSED_DATE}_side`, posedStoredDoc());
  rejects(
    'rejects a storagePath naming the document instead of the asset',
    POSED_DOC,
    posedStoredDoc({ storagePath: `users/${UID}/progressPhotos/${POSED_DOC}.enc` }),
  );
  rejects(
    'rejects a storagePath in another user namespace',
    POSED_DOC,
    posedStoredDoc({ storagePath: `users/${OTHER_UID}/progressPhotos/${POSED_ASSET}.enc` }),
  );
  rejects(
    'rejects a posed document with no thumbnail',
    POSED_DOC,
    (() => {
      const {
        thumbnailStoragePath: _a,
        thumbnailEncryptedSize: _b,
        thumbnailEncryption: _c,
        ...rest
      } = posedStoredDoc();
      return rest;
    })(),
  );
});

describe('posed upload', () => {
  it('keeps the pre-pose shape when no pose is supplied', async () => {
    const result = await uploadProgressPhoto(uploadInput);

    const written = mocks.setDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect(written.pose).toBeUndefined();
    expect(written.dateKey).toBeUndefined();
    expect(written.assetId).toBeUndefined();
    // Document and asset still coincide, exactly as before this phase.
    expect(result.photoId).toBe(result.assetId);
  });

  it('derives every identifier itself when a pose is supplied', async () => {
    const result = await uploadProgressPhoto({ ...uploadInput, pose: 'side' });

    expect(result.pose).toBe('side');
    expect(result.dateKey).toBe('2026-08-01');
    expect(result.photoId).toBe('2026-08-01_side');
    // The asset is a fresh UUID, never the document id.
    expect(result.assetId).not.toBe(result.photoId);
    expect(result.assetId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes the posed metadata under the deterministic document id', async () => {
    await uploadProgressPhoto({ ...uploadInput, pose: 'back' });

    const [ref, written] = mocks.setDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toContain('2026-08-01_back');
    expect(written.pose).toBe('back');
    expect(written.dateKey).toBe('2026-08-01');
    expect(written.assetId).toBe(written.storagePath!.toString().split('/').pop()!.replace('.enc', ''));
  });

  it('names both Storage objects after the asset, never the day or pose', async () => {
    const result = await uploadProgressPhoto({ ...uploadInput, pose: 'front' });

    for (const [path] of mocks.storageRef.mock.calls as [string][]) {
      expect(path).toContain(result.assetId);
      expect(path).not.toContain('front');
      expect(path).not.toContain('2026-08-01');
    }
  });

  it('labels the Storage custom metadata with the asset', async () => {
    const result = await uploadProgressPhoto({ ...uploadInput, pose: 'front' });

    for (const call of mocks.upload.mock.calls) {
      const options = call[2] as { customMetadata: { photoId: string } };
      // The key keeps its historical name so storage.rules stays untouched;
      // its value is and must be the asset id.
      expect(options.customMetadata.photoId).toBe(result.assetId);
    }
  });

  it('computes the day from the photo local capture time', async () => {
    // 23:30 local on the 15th: a UTC-based key would say the 16th.
    const lateEvening = new Date(2026, 7, 15, 23, 30);
    const result = await uploadProgressPhoto({
      ...uploadInput,
      takenAt: lateEvening,
      pose: 'front',
    });

    expect(result.dateKey).toBe('2026-08-15');
    expect(result.photoId).toBe('2026-08-15_front');
  });

  it('rejects an unlisted pose before touching Storage', async () => {
    const error = await uploadProgressPhoto({
      ...uploadInput,
      pose: 'profile' as never,
    }).catch((caught) => caught);

    expect(issueOf(error)).toBe('vaultMetadataInvalid');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('rolls back both objects when the posed metadata write fails', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore down'));
    // The slot is free, so this is a genuine write failure, not a duplicate.
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

    const error = await uploadProgressPhoto({ ...uploadInput, pose: 'front' }).catch(
      (caught) => caught,
    );

    expect(issueOf(error)).toBe('vaultMetadataCreateFailed');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('reports a taken slot when another device filled it first', async () => {
    // The write is refused because the document already exists — the id IS the
    // (day, pose) pair, so this is the database enforcing uniqueness.
    mocks.setDoc.mockRejectedValue(new Error('permission-denied'));
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => storedDoc() });

    const error = await uploadProgressPhoto({ ...uploadInput, pose: 'front' }).catch(
      (caught) => caught,
    );

    expect(issueOf(error)).toBe('vaultPhotoSlotTaken');
    // The freshly uploaded ciphertext still has to go.
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('never reports a taken slot for a photo written without a pose', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore down'));
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => storedDoc() });

    const error = await uploadProgressPhoto(uploadInput).catch((caught) => caught);

    // A pre-pose document is named by a fresh UUID; it cannot collide.
    expect(issueOf(error)).toBe('vaultMetadataCreateFailed');
  });
});

describe('posed identity in cache, download and delete', () => {
  it('reads the cache by asset, never by document id', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());
    await downloadProgressPhotoThumbnail(photo!);

    expect(mocks.readCache).toHaveBeenCalledWith(
      expect.objectContaining({ uid: UID, photoId: POSED_ASSET }),
    );
    expect(mocks.writeCache).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: POSED_ASSET }),
    );
    for (const call of [...mocks.readCache.mock.calls, ...mocks.writeCache.mock.calls]) {
      expect((call[0] as { photoId: string }).photoId).not.toBe(POSED_DOC);
    }
  });

  it('downloads the thumbnail from the asset path', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());
    await downloadProgressPhotoThumbnail(photo!);

    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${POSED_ASSET}.thumb.enc`,
    );
  });

  it('downloads the full image from the asset path', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());
    await downloadProgressPhoto(photo!);

    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${POSED_ASSET}.enc`,
    );
  });

  it('deletes the document by id and the objects and cache by asset', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());
    await deleteProgressPhoto(photo!);

    expect(mocks.removeCache).toHaveBeenCalledWith(UID, POSED_ASSET);
    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${POSED_ASSET}.enc`,
    );
    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${POSED_ASSET}.thumb.enc`,
    );
    const [deletedRef] = mocks.deleteDoc.mock.calls[0] as [{ path: string }];
    expect(deletedRef.path).toContain(POSED_DOC);
  });

  it('reconciles the cache by asset', async () => {
    await listOne(POSED_DOC, posedStoredDoc());
    const photos = await listProgressPhotos();
    reconcileProgressPhotoCache(photos);

    expect(mocks.reconcileCache).toHaveBeenCalledWith(UID, [POSED_ASSET]);
  });

  it('cannot be redirected to another user asset', async () => {
    const [photo] = await listOne(POSED_DOC, posedStoredDoc());
    const forged = { ...photo!, storagePath: `users/${OTHER_UID}/progressPhotos/${POSED_ASSET}.enc` };

    expect(issueOf(await downloadProgressPhoto(forged).catch((e) => e))).toBe(
      'vaultMetadataInvalid',
    );
  });
});

describe('structural security', () => {
  it('contains no durable URL/plaintext cache or manual identity input', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/progressPhotos.ts', 'utf8');
    expect(source).not.toContain('getDownloadURL');
    expect(source).not.toContain('memory-disk');
    expect(source).not.toContain('AsyncStorage');
    expect(source).not.toContain('Paths.document');
    expect(source).not.toMatch(/contentType:\s*'image\//);
    expect(source).not.toContain('console.');
  });

  it('preserves the 10 MiB full ceiling and uses a smaller thumbnail ceiling', () => {
    expect(MAX_ENCRYPTED_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_THUMBNAIL_ENCRYPTED_BYTES).toBe(512 * 1024);
  });
});


// ── Replacing a persisted photo (phase 14F) ────────────────────────────────

describe('replaceProgressPhoto', () => {
  const OLD_ASSET = '123e4567-e89b-42d3-a456-426614174031';
  const DATE = '2026-08-01';
  const DOC = `${DATE}_front`;

  function currentPhoto(overrides: Record<string, unknown> = {}) {
    return {
      photoId: DOC,
      assetId: OLD_ASSET,
      pose: 'front' as const,
      dateKey: DATE,
      storagePath: `users/${UID}/progressPhotos/${OLD_ASSET}.enc`,
      thumbnailStoragePath: `users/${UID}/progressPhotos/${OLD_ASSET}.thumb.enc`,
      takenAt: TAKEN_AT,
      createdAt: null,
      originalMimeType: 'image/jpeg',
      encryptedSize: FULL_SIZE,
      thumbnailEncryptedSize: THUMB_SIZE,
      encryption: encryption(FULL_IV),
      thumbnailEncryption: encryption(THUMB_IV),
      ...overrides,
    };
  }

  /** The stored document the transaction reads back. */
  function slotHolds(assetId: string) {
    mocks.txGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...posedStoredDoc({}, assetId), assetId }),
    });
  }

  const input = {
    sourceUri: 'file:///cache/photo-vault/tmp/new.jpg',
    takenAt: TAKEN_AT,
    originalMimeType: 'image/jpeg' as const,
  };

  beforeEach(() => {
    slotHolds(OLD_ASSET);
  });

  it('uploads the new ciphertext before touching anything old', async () => {
    const order: string[] = [];
    mocks.upload.mockImplementation((_ref: unknown, blob: Blob) => ({
      on: (
        _event: string,
        progress: (s: { bytesTransferred: number; totalBytes: number }) => void,
        _error: (e: unknown) => void,
        complete: () => void,
      ) => {
        order.push('upload');
        progress({ bytesTransferred: blob.size, totalBytes: blob.size });
        complete();
      },
    }));
    mocks.txDelete.mockImplementation(() => order.push('delete-doc'));
    mocks.setDoc.mockImplementation(async () => { order.push('create-doc'); });
    mocks.deleteObject.mockImplementation(async () => { order.push('delete-old-object'); });

    await replaceProgressPhoto({ current: currentPhoto(), ...input });

    // Nothing the user owns is destroyed until its replacement is durable.
    expect(order.indexOf('upload')).toBeLessThan(order.indexOf('delete-doc'));
    expect(order.indexOf('delete-doc')).toBeLessThan(order.indexOf('create-doc'));
    expect(order.indexOf('create-doc')).toBeLessThan(order.indexOf('delete-old-object'));
  });

  it('gives the replacement a brand new asset id and keeps the slot id', async () => {
    const result = await replaceProgressPhoto({ current: currentPhoto(), ...input });

    expect(result.photoId).toBe(DOC);
    expect(result.assetId).not.toBe(OLD_ASSET);
    expect(result.pose).toBe('front');
    expect(result.dateKey).toBe(DATE);
    // The old object is never overwritten.
    expect(result.storagePath).toContain(result.assetId);
    expect(result.storagePath).not.toContain(OLD_ASSET);
    expect(mocks.contentPresence).not.toHaveBeenCalled();
  });

  it('drops the old ciphertext and its cache only after the commit', async () => {
    await replaceProgressPhoto({ current: currentPhoto(), ...input });

    expect(mocks.removeCache).toHaveBeenCalledWith(UID, OLD_ASSET);
    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${OLD_ASSET}.enc`,
    );
    expect(mocks.storageRef).toHaveBeenCalledWith(
      `users/${UID}/progressPhotos/${OLD_ASSET}.thumb.enc`,
    );
  });

  it('refuses a photo that belongs to another day', async () => {
    const error = await replaceProgressPhoto({
      current: currentPhoto(),
      ...input,
      takenAt: new Date(2026, 6, 10, 9, 0),
    }).catch((caught) => caught);

    expect(issueOf(error)).toBe('vaultReplaceDateMismatch');
    // Nothing was uploaded, so nothing has to be undone.
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.txDelete).not.toHaveBeenCalled();
  });

  it('refuses to replace a photo with no pose', async () => {
    const legacy = currentPhoto();
    delete (legacy as Record<string, unknown>).pose;
    delete (legacy as Record<string, unknown>).dateKey;
    legacy.photoId = OLD_ASSET;

    const error = await replaceProgressPhoto({ current: legacy, ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultReplaceSlotMissing');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('keeps the old photo when the new upload fails', async () => {
    mocks.upload.mockImplementation(() => ({
      on: (_e: string, _p: unknown, error: (e: unknown) => void) => error(new Error('offline')),
    }));

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultUploadFailed');
    // The old metadata was never touched.
    expect(mocks.txDelete).not.toHaveBeenCalled();
    expect(mocks.removeCache).not.toHaveBeenCalled();
  });

  it('rolls the new objects back when the old metadata cannot be removed', async () => {
    mocks.runTransaction.mockRejectedValue(new Error('transaction failed'));

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultDeleteFailed');
    // Two new objects removed; the old pair untouched.
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.removeCache).not.toHaveBeenCalled();
  });

  it('restores the original document when the new one cannot be written', async () => {
    mocks.setDoc.mockRejectedValueOnce(new Error('firestore down'));

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultMetadataCreateFailed');
    // The old document was rewritten at the same slot...
    const restore = mocks.setDoc.mock.calls[1]![1] as Record<string, unknown>;
    expect(restore.assetId).toBe(OLD_ASSET);
    expect(restore.createdAt).toBe('SERVER_TIMESTAMP');
    // ...and the replacement's objects were taken back out.
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('preserves both ciphertexts when even the restore fails', async () => {
    mocks.setDoc.mockRejectedValue(new Error('firestore down'));

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultReplaceRestoreFailed');
    // Deliberately keeps BOTH: the old one is the user's photo, and the new
    // one may still be committed by a retry. The orphan sweep reclaims the
    // loser after its grace period.
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.removeCache).not.toHaveBeenCalled();
  });

  it('keeps the new photo when the old ciphertext cannot be deleted', async () => {
    mocks.deleteObject.mockRejectedValue(new Error('storage down'));

    const result = await replaceProgressPhoto({ current: currentPhoto(), ...input });

    // The new photo is already the authority; undoing it would be worse.
    expect(result.assetId).not.toBe(OLD_ASSET);
    expect(result.photoId).toBe(DOC);
  });

  it('never deletes a replacement made on another device', async () => {
    const OTHER = '123e4567-e89b-42d3-a456-426614174099';
    slotHolds(OTHER);

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultReplaceSlotChanged');
    expect(mocks.txDelete).not.toHaveBeenCalled();
    // Only this attempt's own objects are removed.
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(mocks.removeCache).not.toHaveBeenCalled();
  });

  it('reports an empty slot instead of creating one', async () => {
    mocks.txGet.mockResolvedValue({ exists: () => false, data: () => undefined });

    const error = await replaceProgressPhoto({ current: currentPhoto(), ...input }).catch((e) => e);

    expect(issueOf(error)).toBe('vaultReplaceSlotMissing');
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('discards a replacement that completed after the session closed', async () => {
    const done = replaceProgressPhoto({ current: currentPhoto(), ...input });
    closePhotoVaultSession();

    expect(issueOf(await done.catch((e) => e))).toBe('vaultLocked');
  });
});
