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
  currentUser: { uid: 'alice' } as { uid: string } | null,
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `photo-${(mocks.uuid += 1)}` }));
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

import { PhotoVaultError } from '../../lib/photoVaultErrors';
import { closePhotoVaultSession, openPhotoVaultSession } from '../../lib/photoVaultSession';
import {
  MAX_ENCRYPTED_BYTES,
  MAX_THUMBNAIL_ENCRYPTED_BYTES,
  deleteProgressPhoto,
  downloadProgressPhoto,
  downloadProgressPhotoThumbnail,
  listProgressPhotos,
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

function metadata(id = 'photo-1', withThumbnail = true, overrides: Record<string, unknown> = {}) {
  const base = {
    photoId: id,
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

function storedDoc(id = 'photo-1', withThumbnail = true, overrides: Record<string, unknown> = {}) {
  const { photoId: _photoId, ...data } = metadata(id, withThumbnail, overrides);
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
});

describe('dual encrypted upload', () => {
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

    expect(mocks.storageRef).toHaveBeenCalledWith(`users/${UID}/progressPhotos/photo-1.enc`);
    expect(mocks.storageRef).toHaveBeenCalledWith(`users/${UID}/progressPhotos/photo-1.thumb.enc`);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.openUploadBlob).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls.every((call) => !ArrayBuffer.isView(call[1]))).toBe(true);
    expect(mocks.upload.mock.calls.map((call) => (call[1] as Blob).size)).toEqual(
      expect.arrayContaining([FULL_SIZE, THUMB_SIZE]),
    );
    expect(mocks.upload.mock.calls.map((call) => call[2])).toEqual(expect.arrayContaining([
      {
        contentType: 'application/octet-stream',
        customMetadata: { ownerId: UID, photoId: 'photo-1', assetKind: 'full' },
      },
      {
        contentType: 'application/octet-stream',
        customMetadata: { ownerId: UID, photoId: 'photo-1', assetKind: 'thumbnail' },
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
    expect(written.thumbnailStoragePath).toBe(`users/${UID}/progressPhotos/photo-1.thumb.enc`);
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
});

describe('listing compatibility', () => {
  function snapshotOf(entries: { id: string; data: Record<string, unknown> }[]) {
    return { docs: entries.map((entry) => ({ id: entry.id, data: () => entry.data })) };
  }

  it('accepts both legacy and complete thumbnail schemas', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([
      { id: 'legacy', data: storedDoc('legacy', false) },
      { id: 'modern', data: storedDoc('modern', true) },
    ]));
    const photos = await listProgressPhotos();
    expect(photos).toHaveLength(2);
    expect(photos[0]?.thumbnailStoragePath).toBeUndefined();
    expect(photos[1]?.thumbnailStoragePath).toContain('.thumb.enc');
  });

  it('rejects partial thumbnail metadata and reused IVs', async () => {
    mocks.getDocs.mockResolvedValue(snapshotOf([
      { id: 'partial', data: storedDoc('partial', false, { thumbnailStoragePath: `users/${UID}/progressPhotos/partial.thumb.enc` }) },
      { id: 'same-iv', data: storedDoc('same-iv', true, { thumbnailEncryption: encryption(FULL_IV) }) },
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
    const result = await downloadProgressPhotoThumbnail(metadata('legacy', false));
    expect(result.isFullImage).toBe(true);
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringMatching(/legacy\.enc$/));
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
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringMatching(/photo-1\.enc$/));
  });

  it('viewer downloads the full asset and validates size/nonce before decrypt', async () => {
    await downloadProgressPhoto(metadata());
    expect(mocks.storageRef).toHaveBeenCalledWith(expect.stringMatching(/photo-1\.enc$/));
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
    const forged = metadata('photo-1', true, {
      storagePath: `users/${OTHER_UID}/progressPhotos/photo-1.enc`,
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
      expect.objectContaining({ uid: UID, photoId: 'photo-1', epoch: 7 }),
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

    expect(mocks.removeCache).toHaveBeenCalledWith(UID, 'photo-1');
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
    expect(mocks.removeCache).toHaveBeenCalledWith(UID, 'photo-1');
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
    expect(mocks.removeCache).toHaveBeenCalledWith(UID, 'photo-1');
  });

  it('does not cache the legacy full fallback', async () => {
    await downloadProgressPhotoThumbnail(metadata('legacy', false));
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
