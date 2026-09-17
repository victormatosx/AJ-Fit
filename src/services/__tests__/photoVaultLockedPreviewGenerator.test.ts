import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resize: vi.fn(),
  renderAsync: vi.fn(),
  saveAsync: vi.fn(),
  manipulate: vi.fn(),
  files: new Map<string, Uint8Array>(),
  deleted: new Set<string>(),
}));

vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: mocks.manipulate },
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    delete() {
      mocks.deleted.add(this.uri);
      mocks.files.delete(this.uri);
    }
    async bytes() {
      const bytes = mocks.files.get(this.uri);
      if (!bytes) throw new Error('ENOENT');
      return bytes;
    }
  },
}));

import {
  LOCKED_PREVIEW_DISPLAY_PX,
  LOCKED_PREVIEW_DOWNSAMPLE_PX,
  generateLockedPreviewDerivative,
} from '../photoVaultLockedPreviewGenerator';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.deleted.clear();

  const context = { resize: mocks.resize, renderAsync: mocks.renderAsync };
  mocks.resize.mockReturnValue(context);
  mocks.manipulate.mockReturnValue(context);

  let call = 0;
  mocks.renderAsync.mockImplementation(async () => ({ saveAsync: mocks.saveAsync }));
  mocks.saveAsync.mockImplementation(async () => {
    call += 1;
    const uri = `file:///tmp/derivative-${call}.jpg`;
    mocks.files.set(uri, new Uint8Array([call]));
    return { uri };
  });
});

describe('generateLockedPreviewDerivative', () => {
  it('downsamples to the destructive size, then scales back up for display', async () => {
    await generateLockedPreviewDerivative('file:///plaintext/thumb.jpg');

    expect(mocks.manipulate).toHaveBeenNthCalledWith(1, 'file:///plaintext/thumb.jpg');
    expect(mocks.resize).toHaveBeenNthCalledWith(1, { width: LOCKED_PREVIEW_DOWNSAMPLE_PX });
    // The second manipulate call re-opens the DOWNSAMPLED output, not the
    // original — the blur is destructive at that step, not at the re-scale.
    expect(mocks.manipulate).toHaveBeenNthCalledWith(2, 'file:///tmp/derivative-1.jpg');
    expect(mocks.resize).toHaveBeenNthCalledWith(2, { width: LOCKED_PREVIEW_DISPLAY_PX });
  });

  it('returns the final JPEG bytes', async () => {
    const bytes = await generateLockedPreviewDerivative('file:///plaintext/thumb.jpg');
    expect(bytes).toEqual(new Uint8Array([2]));
  });

  it('cleans up both intermediate files, keeping neither on disk', async () => {
    await generateLockedPreviewDerivative('file:///plaintext/thumb.jpg');
    expect(mocks.deleted.has('file:///tmp/derivative-1.jpg')).toBe(true);
    expect(mocks.deleted.has('file:///tmp/derivative-2.jpg')).toBe(true);
    expect(mocks.files.size).toBe(0);
  });

  it('returns null instead of throwing when the manipulator fails', async () => {
    mocks.renderAsync.mockRejectedValueOnce(new Error('native failure'));
    await expect(generateLockedPreviewDerivative('file:///plaintext/thumb.jpg')).resolves.toBeNull();
  });

  it('never reaches for the vault key, crypto, or network', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/photoVaultLockedPreviewGenerator.ts', 'utf8');
    expect(source).not.toContain('vaultKey');
    expect(source).not.toContain('photoVaultCrypto');
    expect(source).not.toContain('firebase');
    expect(source).not.toContain('decrypt');
  });
});
