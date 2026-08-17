import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  files: new Map<string, { size: number; type: string; exists: boolean }>(),
  deleteFile: vi.fn(),
  manipulate: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  storageRef: vi.fn(),
  upload: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
  openBlob: vi.fn(),
  closeBlob: vi.fn(),
}));

vi.mock('expo-file-system', () => ({
  File: class FakeFile {
    readonly uri: string;
    constructor(uri: string) { this.uri = uri; }
    get size() { return mocks.files.get(this.uri)?.size ?? 0; }
    get type() { return mocks.files.get(this.uri)?.type ?? ''; }
    get exists() { return mocks.files.get(this.uri)?.exists ?? false; }
    delete() {
      mocks.deleteFile(this.uri);
      const entry = mocks.files.get(this.uri);
      if (entry) entry.exists = false;
    }
  },
}));

vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: { manipulate: (...args: unknown[]) => mocks.manipulate(...args) },
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => {
    mocks.storageRef(path);
    return { path };
  },
  uploadBytesResumable: (...args: unknown[]) => mocks.upload(...args),
  getDownloadURL: (...args: unknown[]) => mocks.getDownloadURL(...args),
  deleteObject: (...args: unknown[]) => mocks.deleteObject(...args),
}));

vi.mock('../../lib/firebase', () => ({ storage: {} }));

vi.mock('../profilePhotoUploadBlob', () => ({
  openProfilePhotoUploadBlob: (...args: unknown[]) => mocks.openBlob(...args),
  closeProfilePhotoUploadBlob: (...args: unknown[]) => mocks.closeBlob(...args),
}));

import {
  PROFILE_PHOTO_MAX_BYTES,
  compressProfilePhoto,
  discardProfilePhotoTemporary,
  uploadProfilePhoto,
  type LocalProfilePhoto,
} from '../profilePhoto';

const nativeBlob = { size: 1_024, type: 'image/jpeg', close: vi.fn() } as unknown as Blob;

function localPhoto(uri = 'file:///cache/picker/original.jpg'): LocalProfilePhoto {
  return {
    uri,
    mimeType: 'image/jpeg',
    fileSize: 1_024,
    width: 2_000,
    height: 2_000,
  };
}

function successfulTask() {
  return {
    snapshot: { metadata: { generation: '42' } },
    on: vi.fn((
      _event: string,
      progress: (snapshot: { totalBytes: number; bytesTransferred: number }) => void,
      _error: (error: unknown) => void,
      complete: () => void,
    ) => {
      progress({ totalBytes: 1_024, bytesTransferred: 1_024 });
      complete();
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.files.set('file:///cache/picker/original.jpg', {
    size: 1_024,
    type: 'image/jpeg',
    exists: true,
  });
  mocks.openBlob.mockResolvedValue(nativeBlob);
  mocks.upload.mockReturnValue(successfulTask());
  mocks.getDownloadURL.mockResolvedValue('https://storage.test/avatar.jpg');
  mocks.resize.mockReturnValue(undefined);
  mocks.render.mockResolvedValue({ saveAsync: (...args: unknown[]) => mocks.save(...args) });
  mocks.manipulate.mockReturnValue({
    resize: (...args: unknown[]) => mocks.resize(...args),
    renderAsync: (...args: unknown[]) => mocks.render(...args),
  });
});

describe('profile-photo upload contract', () => {
  it.each([
    ['picker output without editing', 'file:///cache/picker/original.jpg'],
    ['picker output after zoom', 'file:///cache/picker/zoomed.jpg'],
    ['picker output after crop', 'file:///cache/picker/cropped.jpg'],
    ['picker output after zoom plus crop', 'file:///cache/picker/zoom-cropped.jpg'],
  ])('uploads the URI-backed native Blob for %s', async (_label, uri) => {
    mocks.files.set(uri, { size: 1_024, type: 'image/jpeg', exists: true });
    const progress = vi.fn();

    const result = await uploadProfilePhoto('alice', localPhoto(uri), progress);

    expect(mocks.openBlob).toHaveBeenCalledWith(uri);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/alice/profile/avatar' }),
      nativeBlob,
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(ArrayBuffer.isView(mocks.upload.mock.calls[0]?.[1])).toBe(false);
    expect(result).toBe('https://storage.test/avatar.jpg?g=42');
    expect(progress).toHaveBeenCalledWith(1);
    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
  });

  it('normalizes a manipulated crop URI and uploads it through the same Blob path', async () => {
    const editedUri = 'file:///cache/manipulator/zoom-crop.jpg';
    mocks.files.set(editedUri, { size: 900, type: 'image/jpeg', exists: true });
    mocks.save.mockResolvedValue({ uri: editedUri, width: 1_600, height: 1_600 });

    const compressed = await compressProfilePhoto(localPhoto());
    await uploadProfilePhoto('alice', compressed);

    expect(compressed.uri).toBe(editedUri);
    expect(mocks.openBlob).toHaveBeenCalledWith(editedUri);
    expect(mocks.upload.mock.calls[0]?.[1]).toBe(nativeBlob);
  });

  it('deletes rejected compression attempts before trying the next one', async () => {
    const tooLarge = 'file:///cache/manipulator/large.jpg';
    const accepted = 'file:///cache/manipulator/accepted.jpg';
    mocks.files.set(tooLarge, {
      size: PROFILE_PHOTO_MAX_BYTES + 1,
      type: 'image/jpeg',
      exists: true,
    });
    mocks.files.set(accepted, { size: 1_024, type: 'image/jpeg', exists: true });
    mocks.save
      .mockResolvedValueOnce({ uri: tooLarge, width: 1_600, height: 1_600 })
      .mockResolvedValueOnce({ uri: accepted, width: 1_400, height: 1_400 });

    const compressed = await compressProfilePhoto(localPhoto());

    expect(compressed.uri).toBe(accepted);
    expect(mocks.deleteFile).toHaveBeenCalledWith(tooLarge);
    expect(mocks.deleteFile).not.toHaveBeenCalledWith(accepted);
  });

  it('maps upload failure and releases the Blob without deleting retry input', async () => {
    const uploadError = new Error('private firebase detail');
    const task = successfulTask();
    task.on.mockImplementationOnce((
      _event: string,
      _progress: (snapshot: { totalBytes: number; bytesTransferred: number }) => void,
      reject: (error: unknown) => void,
    ) => reject(uploadError));
    mocks.upload.mockReturnValueOnce(task);

    await expect(uploadProfilePhoto('alice', localPhoto())).rejects.toThrow(
      'profile-photo-upload-failed',
    );

    expect(mocks.closeBlob).toHaveBeenCalledWith(nativeBlob);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('offers idempotent ownership cleanup for an abandoned manipulated file', () => {
    const photo = localPhoto();
    discardProfilePhotoTemporary(photo);
    discardProfilePhotoTemporary(photo);

    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('contains no ArrayBuffer/base64 upload path', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/profilePhoto.ts', 'utf8');
    expect(source).not.toContain('.bytes()');
    expect(source).not.toContain('Uint8Array');
    expect(source).not.toContain('base64');
  });
});
