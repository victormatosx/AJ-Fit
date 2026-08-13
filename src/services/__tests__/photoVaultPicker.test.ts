import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  libraryPermission: vi.fn(),
  cameraPermission: vi.fn(),
  launchLibrary: vi.fn(),
  launchCamera: vi.fn(),
  manipulate: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  resize: vi.fn(),
  fileSize: 500_000,
  stage: vi.fn(),
  discardPickerOutput: vi.fn(),
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: mocks.libraryPermission,
  requestCameraPermissionsAsync: mocks.cameraPermission,
  launchImageLibraryAsync: mocks.launchLibrary,
  launchCameraAsync: mocks.launchCamera,
}));

vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: (...args: unknown[]) => {
      mocks.manipulate(...args);
      return {
        resize: mocks.resize,
        renderAsync: async () => ({ saveAsync: mocks.save }),
      };
    },
  },
}));

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}
    get size() {
      return mocks.fileSize;
    }
  },
}));

vi.mock('../photoVaultFileCrypto', () => ({
  stagePhotoVaultPlaintext: mocks.stage,
  discardPhotoVaultPickerOutput: mocks.discardPickerOutput,
}));

import {
  PHOTO_VAULT_THUMBNAIL_JPEG_QUALITY,
  PHOTO_VAULT_THUMBNAIL_MAX_DIMENSION,
  createPhotoVaultThumbnail,
  pickPhotoFromLibrary,
  takePhotoWithCamera,
} from '../photoVaultPicker';

const GRANTED = { granted: true, status: 'granted' };
const DENIED = { granted: false, status: 'denied' };

function asset(overrides: Record<string, unknown> = {}) {
  return {
    canceled: false,
    assets: [{ uri: 'file:///picked/photo.heic', width: 2000, height: 1200, ...overrides }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fileSize = 500_000;
  mocks.libraryPermission.mockResolvedValue(GRANTED);
  mocks.cameraPermission.mockResolvedValue(GRANTED);
  mocks.launchLibrary.mockResolvedValue(asset());
  mocks.launchCamera.mockResolvedValue(asset());
  mocks.save.mockResolvedValue({
    uri: 'file:///cache/normalized.jpg',
    width: 1600,
    height: 960,
  });
  mocks.stage.mockResolvedValue({
    uri: 'file:///cache/photo-vault/tmp/normalized.jpg',
    size: 500_000,
  });
});

// ── Library ────────────────────────────────────────────────────────────────

describe('pickPhotoFromLibrary', () => {
  it('returns a normalized jpeg', async () => {
    const outcome = await pickPhotoFromLibrary();

    expect(outcome).toMatchObject({
      status: 'picked',
      sourceUri: 'file:///cache/photo-vault/tmp/normalized.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('asks for the library permission only when used', async () => {
    await pickPhotoFromLibrary();

    expect(mocks.libraryPermission).toHaveBeenCalledTimes(1);
    // Never asks for the camera the user did not choose.
    expect(mocks.cameraPermission).not.toHaveBeenCalled();
  });

  it('reports a denied permission without launching the picker', async () => {
    mocks.libraryPermission.mockResolvedValue(DENIED);

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'permissionDenied' });
    expect(mocks.launchLibrary).not.toHaveBeenCalled();
  });

  it('accepts a limited (iOS) selection', async () => {
    mocks.libraryPermission.mockResolvedValue({ granted: false, status: 'undetermined' });

    // The user still picks from what they chose to share.
    expect((await pickPhotoFromLibrary()).status).toBe('picked');
  });

  it('reports cancellation', async () => {
    mocks.launchLibrary.mockResolvedValue({ canceled: true });

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'cancelled' });
  });

  it('re-encodes rather than trusting the extension', async () => {
    // The asset was .heic; the pipeline always outputs jpeg.
    const outcome = await pickPhotoFromLibrary();

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jpeg' }),
    );
    expect(outcome).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('normalizes the long edge before encryption', async () => {
    await pickPhotoFromLibrary();

    expect(mocks.resize).toHaveBeenCalledWith({ width: 1600 });
  });

  it('normalizes a portrait by height instead of upscaling its width', async () => {
    mocks.launchLibrary.mockResolvedValue(asset({ width: 1200, height: 2000 }));
    await pickPhotoFromLibrary();
    expect(mocks.resize).toHaveBeenCalledWith({ height: 1600 });
  });

  it('rejects a file that is still too large after normalization', async () => {
    mocks.fileSize = 11 * 1024 * 1024;

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'unsupported' });
    expect(mocks.discardPickerOutput).toHaveBeenCalledWith(
      'file:///cache/normalized.jpg',
    );
  });

  it('rejects an empty result', async () => {
    mocks.fileSize = 0;

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'unsupported' });
  });

  it('rejects an image the manipulator cannot process', async () => {
    mocks.save.mockRejectedValue(new Error('unsupported codec'));

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'unsupported' });
  });

  it('reports a missing uri as a failure', async () => {
    mocks.launchLibrary.mockResolvedValue({ canceled: false, assets: [{}] });

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'failed' });
  });

  it('never throws out of the picker', async () => {
    mocks.launchLibrary.mockRejectedValue(new Error('boom'));

    expect(await pickPhotoFromLibrary()).toEqual({ status: 'failed' });
  });
});

describe('encrypted-thumbnail source', () => {
  it('creates a 480px long-edge JPEG at quality 0.75 in vault temp', async () => {
    mocks.save.mockResolvedValue({
      uri: 'file:///cache/thumb.jpg',
      width: 300,
      height: 400,
    });

    const result = await createPhotoVaultThumbnail({
      sourceUri: 'file:///cache/photo-vault/tmp/full.jpg',
      width: 1200,
      height: 1600,
    });

    expect(mocks.resize).toHaveBeenCalledWith({
      height: PHOTO_VAULT_THUMBNAIL_MAX_DIMENSION,
    });
    expect(mocks.save).toHaveBeenCalledWith({
      format: 'jpeg',
      compress: PHOTO_VAULT_THUMBNAIL_JPEG_QUALITY,
    });
    expect(mocks.stage).toHaveBeenCalledWith('file:///cache/thumb.jpg');
    expect(result).toMatchObject({ width: 300, height: 400 });
  });
});

// ── Camera ─────────────────────────────────────────────────────────────────

describe('takePhotoWithCamera', () => {
  it('returns a normalized jpeg', async () => {
    expect((await takePhotoWithCamera()).status).toBe('picked');
  });

  it('asks for the camera permission only when used', async () => {
    await takePhotoWithCamera();

    expect(mocks.cameraPermission).toHaveBeenCalledTimes(1);
    expect(mocks.libraryPermission).not.toHaveBeenCalled();
  });

  it('reports a denied permission without opening the camera', async () => {
    mocks.cameraPermission.mockResolvedValue(DENIED);

    expect(await takePhotoWithCamera()).toEqual({ status: 'permissionDenied' });
    expect(mocks.launchCamera).not.toHaveBeenCalled();
  });

  it('reports cancellation', async () => {
    mocks.launchCamera.mockResolvedValue({ canceled: true });

    expect(await takePhotoWithCamera()).toEqual({ status: 'cancelled' });
  });

  it('never asks the OS to save the capture to the photo library', async () => {
    await takePhotoWithCamera();

    // The vault copy is the only one AJ Fit creates.
    const options = mocks.launchCamera.mock.calls[0]?.[0] ?? {};
    expect(options).not.toHaveProperty('saveToPhotos');
    expect(options).not.toHaveProperty('saveToLibrary');
  });

  it('survives a camera failure', async () => {
    mocks.launchCamera.mockRejectedValue(new Error('hardware'));

    expect(await takePhotoWithCamera()).toEqual({ status: 'failed' });
  });
});

// ── Capture time ───────────────────────────────────────────────────────────

describe('takenAt', () => {
  it('uses the EXIF capture time when it parses', async () => {
    mocks.launchLibrary.mockResolvedValue(
      asset({ exif: { DateTimeOriginal: '2026:07:15 08:30:00' } }),
    );

    const outcome = await pickPhotoFromLibrary();

    expect(outcome.status).toBe('picked');
    if (outcome.status === 'picked') {
      expect(outcome.takenAt.getFullYear()).toBe(2026);
      expect(outcome.takenAt.getMonth()).toBe(6);
    }
  });

  it.each([undefined, 'garbage', '9999:99:99 99:99:99'])(
    'falls back to now for EXIF %s',
    async (value) => {
      mocks.launchLibrary.mockResolvedValue(
        asset({ exif: value ? { DateTimeOriginal: value } : undefined }),
      );

      const outcome = await pickPhotoFromLibrary();

      expect(outcome.status).toBe('picked');
      if (outcome.status === 'picked') {
        expect(outcome.takenAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
    },
  );

  it('never accepts a capture time in the future', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const stamp = `${future.getFullYear()}:12:31 23:59:59`;
    mocks.launchLibrary.mockResolvedValue(asset({ exif: { DateTimeOriginal: stamp } }));

    const outcome = await pickPhotoFromLibrary();

    if (outcome.status === 'picked') {
      expect(outcome.takenAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });
});

// ── Privacy ────────────────────────────────────────────────────────────────

describe('privacy of the original', () => {
  it('never deletes or rewrites the picked file', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultPicker.ts', 'utf8');

    expect(source).not.toContain('deleteAsync');
    expect(source).not.toMatch(/\.delete\(\)/);
    // `expo-media-library` is the module that could write to the device
    // gallery; requesting the picker's read permission is not the same thing.
    expect(source).not.toContain('expo-media-library');
    expect(source).not.toContain('createAssetAsync');
  });

  it('stages the normalized copy in the vault-controlled temp directory', async () => {
    await pickPhotoFromLibrary();

    expect(mocks.stage).toHaveBeenCalledWith('file:///cache/normalized.jpg');
  });
});
