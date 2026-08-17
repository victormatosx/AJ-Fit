import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureRef: vi.fn(),
  releaseCapture: vi.fn(),
  copy: vi.fn(),
  files: new Map<string, { exists: boolean; size: number }>(),
  createShare: vi.fn(),
  discardShare: vi.fn(),
  fullState: {
    status: 'ready',
    beforeFullUri: 'file:///cache/photo-vault/tmp/before.jpg',
    afterFullUri: 'file:///cache/photo-vault/tmp/after.jpg',
    failedSide: null,
    issue: null,
  },
  vaultStatus: 'unlocked',
  sessionGeneration: 11,
  lockListeners: [] as ((status: string) => void)[],
  logError: vi.fn(),
  perfEvent: vi.fn(),
  perfFinish: vi.fn(),
}));

vi.mock('react-native', () => ({
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'android' },
}));

vi.mock('react-native-view-shot', () => ({
  captureRef: mocks.captureRef,
  releaseCapture: mocks.releaseCapture,
}));

vi.mock('expo-file-system', () => ({
  File: class MockFile {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return mocks.files.get(this.uri)?.exists ?? false;
    }

    get size(): number | null {
      return mocks.files.get(this.uri)?.size ?? null;
    }

    async copy(target: { uri: string }): Promise<void> {
      await mocks.copy(this.uri, target.uri);
      const source = mocks.files.get(this.uri);
      if (!source?.exists || source.size <= 0) throw new Error('copy failed');
      mocks.files.set(target.uri, { ...source });
    }
  },
}));

vi.mock('../../services/photoVaultFileCrypto', () => ({
  createPhotoVaultShareFilePath: mocks.createShare,
  discardPhotoVaultShareFile: (uri: string) => {
    mocks.discardShare(uri);
    mocks.files.delete(uri);
  },
}));

vi.mock('../photoVaultCompareController', () => ({
  getPhotoVaultCompareState: () => mocks.fullState,
}));

vi.mock('../photoVaultLock', () => ({
  getPhotoVaultStatus: () => mocks.vaultStatus,
  subscribeToPhotoVaultStatus: (listener: (status: string) => void) => {
    mocks.lockListeners.push(listener);
    return () => undefined;
  },
}));

vi.mock('../photoVaultSession', () => ({
  photoVaultSessionGeneration: () => mocks.sessionGeneration,
}));

vi.mock('../photoVaultPerformance', () => ({
  startPhotoVaultPerf: vi.fn(() => mocks.perfFinish),
  recordPhotoVaultPerfEvent: mocks.perfEvent,
}));

vi.mock('../logger', () => ({ logError: mocks.logError }));

import {
  PHOTO_VAULT_COMPARE_EXPORT_HEIGHT,
  PHOTO_VAULT_COMPARE_EXPORT_QUALITY,
  PHOTO_VAULT_COMPARE_EXPORT_WIDTH,
  capturePhotoVaultComparison,
  claimPhotoVaultComparisonExportForShare,
  discardPhotoVaultComparisonExport,
  getPhotoVaultCompareExportState,
  photoVaultComparisonCaptureSize,
  resetPhotoVaultCompareExportForTesting,
  settlePhotoVaultComparisonExportShare,
  subscribeToPhotoVaultCompareExport,
  type CapturePhotoVaultComparisonInput,
} from '../photoVaultCompareExport';

const VIEW_SHOT_URI = 'file:///cache/ReactNative-snapshot-image-123.jpg';
const SHARE_ONE =
  'file:///cache/photo-vault/share/11111111-1111-4111-8111-111111111111.jpg';
const SHARE_TWO =
  'file:///cache/photo-vault/share/22222222-2222-4222-8222-222222222222.jpg';

function input(
  overrides: Partial<CapturePhotoVaultComparisonInput> = {},
): CapturePhotoVaultComparisonInput {
  return {
    posterRef: { current: {} as never },
    posterReady: true,
    logoReady: true,
    beforeFullUri: mocks.fullState.beforeFullUri,
    afterFullUri: mocks.fullState.afterFullUri,
    ...overrides,
  };
}

function emitLock(): void {
  mocks.vaultStatus = 'locked';
  for (const listener of mocks.lockListeners) listener('locked');
}

beforeEach(() => {
  resetPhotoVaultCompareExportForTesting();
  vi.clearAllMocks();
  mocks.files.clear();
  mocks.vaultStatus = 'unlocked';
  mocks.sessionGeneration = 11;
  Object.assign(mocks.fullState, {
    status: 'ready',
    beforeFullUri: 'file:///cache/photo-vault/tmp/before.jpg',
    afterFullUri: 'file:///cache/photo-vault/tmp/after.jpg',
    failedSide: null,
    issue: null,
  });
  mocks.createShare.mockReturnValue({ uri: SHARE_ONE });
  mocks.captureRef.mockImplementation(async () => {
    mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 456_789 });
    return VIEW_SHOT_URI;
  });
});

describe('capture contract', () => {
  it('captures only the supplied poster ref once as JPEG tmpfile', async () => {
    const request = input();

    await capturePhotoVaultComparison(request);

    expect(mocks.captureRef).toHaveBeenCalledTimes(1);
    expect(mocks.captureRef).toHaveBeenCalledWith(request.posterRef, {
      width: 1080,
      height: 1920,
      format: 'jpg',
      quality: 0.88,
      result: 'tmpfile',
    });
  });

  it('keeps the public constants fixed at 1080x1920 and quality 0.88', () => {
    expect(PHOTO_VAULT_COMPARE_EXPORT_WIDTH).toBe(1080);
    expect(PHOTO_VAULT_COMPARE_EXPORT_HEIGHT).toBe(1920);
    expect(PHOTO_VAULT_COMPARE_EXPORT_QUALITY).toBe(0.88);
    expect(
      PHOTO_VAULT_COMPARE_EXPORT_WIDTH / PHOTO_VAULT_COMPARE_EXPORT_HEIGHT,
    ).toBe(9 / 16);
  });

  it('accounts for one approximately 7.91 MiB raw capture bitmap', () => {
    const rawBitmapMiB =
      (PHOTO_VAULT_COMPARE_EXPORT_WIDTH *
        PHOTO_VAULT_COMPARE_EXPORT_HEIGHT *
        4) /
      (1024 * 1024);
    expect(rawBitmapMiB).toBeCloseTo(7.91, 2);
  });

  it('uses exact target pixels on Android', () => {
    expect(photoVaultComparisonCaptureSize('android', 3)).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it('normalizes iOS points by the 3x PixelRatio', () => {
    const size = photoVaultComparisonCaptureSize('ios', 3);
    expect(size).toEqual({
      width: 360,
      height: 640,
    });
    expect({ width: size.width * 3, height: size.height * 3 }).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it('normalizes iOS points by the 2x PixelRatio', () => {
    const size = photoVaultComparisonCaptureSize('ios', 2);
    expect(size).toEqual({
      width: 540,
      height: 960,
    });
    expect({ width: size.width * 2, height: size.height * 2 }).toEqual({
      width: 1080,
      height: 1920,
    });
  });

  it('never requests a base64 result', async () => {
    await capturePhotoVaultComparison(input());

    expect(mocks.captureRef.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({ result: 'base64' }),
    );
  });
});

describe('closed preconditions', () => {
  const cases: Array<[
    string,
    () => void,
    Partial<CapturePhotoVaultComparisonInput>?,
  ]> = [
    ['full controller not ready', () => { mocks.fullState.status = 'loading'; }],
    ['before URI missing', () => undefined, { beforeFullUri: null }],
    ['after URI missing', () => undefined, { afterFullUri: null }],
    ['poster ref missing', () => undefined, { posterRef: { current: null } }],
    ['poster not ready', () => undefined, { posterReady: false }],
    ['logo not ready', () => undefined, { logoReady: false }],
  ];

  it.each(cases)('does not capture when %s', async (_label, prepare, overrides = {}) => {
    prepare();

    const result = await capturePhotoVaultComparison(input(overrides));

    expect(mocks.captureRef).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error', issue: 'compareCaptureFailed' });
  });

  it('does not capture while the Vault is locked', async () => {
    mocks.vaultStatus = 'locked';

    await capturePhotoVaultComparison(input());

    expect(mocks.captureRef).not.toHaveBeenCalled();
  });

  it('rejects URIs that are not the ready full controller pair', async () => {
    await capturePhotoVaultComparison(
      input({ beforeFullUri: 'file:///cache/photo-vault/tmp/stale.jpg' }),
    );

    expect(mocks.captureRef).not.toHaveBeenCalled();
  });
});

describe('share materialization and ownership', () => {
  it('copies the view-shot tmpfile into the neutral share path', async () => {
    const result = await capturePhotoVaultComparison(input());

    expect(mocks.createShare).toHaveBeenCalledWith('.jpg');
    expect(mocks.copy).toHaveBeenCalledWith(VIEW_SHOT_URI, SHARE_ONE);
    expect(result).toEqual({
      status: 'ready',
      exportUri: SHARE_ONE,
      fileSize: 456_789,
      issue: null,
    });
  });

  it('releases the view-shot intermediate after success', async () => {
    await capturePhotoVaultComparison(input());

    expect(mocks.releaseCapture).toHaveBeenCalledTimes(1);
    expect(mocks.releaseCapture).toHaveBeenCalledWith(VIEW_SHOT_URI);
    expect(mocks.discardShare).not.toHaveBeenCalledWith(VIEW_SHOT_URI);
  });

  it('normalizes the absolute iOS tmp path only for Expo FileSystem', async () => {
    const iosPath = '/private/tmp/ReactNative/snapshot.jpg';
    const iosFileUri = `file://${iosPath}`;
    mocks.files.set(iosFileUri, { exists: true, size: 1200 });
    mocks.captureRef.mockResolvedValueOnce(iosPath);

    await capturePhotoVaultComparison(input());

    expect(mocks.copy).toHaveBeenCalledWith(iosFileUri, SHARE_ONE);
    expect(mocks.releaseCapture).toHaveBeenCalledWith(iosPath);
  });

  it('keeps the share filename neutral and UUID-shaped', async () => {
    const result = await capturePhotoVaultComparison(input());
    const name = result.exportUri?.split('/').at(-1) ?? '';

    expect(result.exportUri).toContain('/photo-vault/share/');
    expect(name).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i,
    );
    for (const privatePart of ['uid', 'asset', 'photo', 'front', 'back', 'side', '2026']) {
      expect(name).not.toContain(privatePart);
    }
  });

  it('discards its active share export on close', async () => {
    await capturePhotoVaultComparison(input());

    discardPhotoVaultComparisonExport();

    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(getPhotoVaultCompareExportState()).toEqual({
      status: 'idle',
      exportUri: null,
      fileSize: null,
      issue: null,
    });
  });

  it('publishes capturing and ready states', async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToPhotoVaultCompareExport((next) => {
      seen.push(next.status);
    });

    await capturePhotoVaultComparison(input());
    unsubscribe();

    expect(seen).toEqual(['capturing', 'ready']);
  });

  it('records lifecycle, duration and file size without identifiers', async () => {
    await capturePhotoVaultComparison(input());

    expect(mocks.perfEvent).toHaveBeenCalledWith('compare.capture.start');
    expect(mocks.perfEvent).toHaveBeenCalledWith('compare.capture.complete', {
      bytes: 456_789,
    });
    expect(mocks.perfFinish).toHaveBeenCalledTimes(1);
  });

  it('leases only the active branded export to one share handoff', async () => {
    await capturePhotoVaultComparison(input());

    expect(claimPhotoVaultComparisonExportForShare()).toBe(SHARE_ONE);
    expect(claimPhotoVaultComparisonExportForShare()).toBeNull();
  });

  it('does not delete a leased export when lock clears comparator state', async () => {
    await capturePhotoVaultComparison(input());
    expect(claimPhotoVaultComparisonExportForShare()).toBe(SHARE_ONE);

    emitLock();

    expect(getPhotoVaultCompareExportState().status).toBe('idle');
    expect(mocks.discardShare).not.toHaveBeenCalledWith(SHARE_ONE);
    settlePhotoVaultComparisonExportShare(SHARE_ONE, 'completed');
    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
  });

  it('consumes a completed export and clears the comparator owner', async () => {
    await capturePhotoVaultComparison(input());
    claimPhotoVaultComparisonExportForShare();

    settlePhotoVaultComparisonExportShare(SHARE_ONE, 'completed');

    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(getPhotoVaultCompareExportState().status).toBe('idle');
  });

  it('keeps a failed handoff export for retry while the comparator owns it', async () => {
    await capturePhotoVaultComparison(input());
    claimPhotoVaultComparisonExportForShare();

    settlePhotoVaultComparisonExportShare(SHARE_ONE, 'failed');

    expect(mocks.discardShare).not.toHaveBeenCalledWith(SHARE_ONE);
    expect(getPhotoVaultCompareExportState()).toMatchObject({
      status: 'ready',
      exportUri: SHARE_ONE,
    });
  });

  it('cleans a failed handoff after close removed the comparator owner', async () => {
    await capturePhotoVaultComparison(input());
    claimPhotoVaultComparisonExportForShare();
    discardPhotoVaultComparisonExport();
    expect(mocks.discardShare).not.toHaveBeenCalledWith(SHARE_ONE);

    settlePhotoVaultComparisonExportShare(SHARE_ONE, 'failed');

    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
  });
});

describe('concurrency, recapture and failure', () => {
  it('coalesces repeated taps while capture is active', async () => {
    let resolveCapture: (uri: string) => void = () => {};
    mocks.captureRef.mockReturnValueOnce(
      new Promise<string>((resolve) => { resolveCapture = resolve; }),
    );

    const first = capturePhotoVaultComparison(input());
    const second = capturePhotoVaultComparison(input());
    expect(mocks.captureRef).toHaveBeenCalledTimes(1);

    mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 123 });
    resolveCapture(VIEW_SHOT_URI);
    await Promise.all([first, second]);

    expect(mocks.captureRef).toHaveBeenCalledTimes(1);
  });

  it('replaces the previous export only after recapture succeeds', async () => {
    mocks.createShare
      .mockReturnValueOnce({ uri: SHARE_ONE })
      .mockReturnValueOnce({ uri: SHARE_TWO });
    await capturePhotoVaultComparison(input());
    expect(mocks.discardShare).not.toHaveBeenCalledWith(SHARE_ONE);

    await capturePhotoVaultComparison(input());

    expect(getPhotoVaultCompareExportState().exportUri).toBe(SHARE_TWO);
    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
  });

  it('keeps the previous valid export when recapture fails', async () => {
    await capturePhotoVaultComparison(input());
    mocks.captureRef.mockRejectedValueOnce(new Error('native private detail'));

    const result = await capturePhotoVaultComparison(input());

    expect(result).toMatchObject({
      status: 'error',
      exportUri: SHARE_ONE,
      issue: 'compareCaptureFailed',
    });
    expect(mocks.discardShare).not.toHaveBeenCalledWith(SHARE_ONE);
  });

  it('maps capture failure and allows retry without touching fulls', async () => {
    mocks.captureRef
      .mockRejectedValueOnce(new Error('native private detail'))
      .mockImplementationOnce(async () => {
        mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 900 });
        return VIEW_SHOT_URI;
      });

    expect(await capturePhotoVaultComparison(input())).toMatchObject({
      status: 'error',
      issue: 'compareCaptureFailed',
    });
    expect(await capturePhotoVaultComparison(input())).toMatchObject({ status: 'ready' });
    expect(mocks.captureRef).toHaveBeenCalledTimes(2);
  });

  it('cleans a partial share target and never reports ready when copy fails', async () => {
    mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 0 });
    mocks.captureRef.mockResolvedValueOnce(VIEW_SHOT_URI);

    const result = await capturePhotoVaultComparison(input());

    expect(result.status).toBe('error');
    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(mocks.discardShare).not.toHaveBeenCalledWith(VIEW_SHOT_URI);
    expect(mocks.releaseCapture).toHaveBeenCalledWith(VIEW_SHOT_URI);
  });

  it('cleans the reserved share target when native file copy throws', async () => {
    mocks.copy.mockRejectedValueOnce(new Error('disk full'));

    const result = await capturePhotoVaultComparison(input());

    expect(result.status).toBe('error');
    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(mocks.releaseCapture).toHaveBeenCalledWith(VIEW_SHOT_URI);
  });
});

describe('lock and late results', () => {
  it('discards this session active export on lock without a global sweep', async () => {
    await capturePhotoVaultComparison(input());

    emitLock();

    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(getPhotoVaultCompareExportState().status).toBe('idle');
  });

  it('does not materialize a capture result that arrives after lock', async () => {
    let resolveCapture: (uri: string) => void = () => {};
    mocks.captureRef.mockReturnValueOnce(
      new Promise<string>((resolve) => { resolveCapture = resolve; }),
    );
    const pending = capturePhotoVaultComparison(input());

    emitLock();
    mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 456 });
    resolveCapture(VIEW_SHOT_URI);
    await pending;

    expect(mocks.createShare).not.toHaveBeenCalled();
    expect(mocks.releaseCapture).toHaveBeenCalledWith(VIEW_SHOT_URI);
    expect(getPhotoVaultCompareExportState().status).toBe('idle');
  });

  it('discards a copied result invalidated by a session change', async () => {
    mocks.copy.mockImplementationOnce(() => {
      mocks.sessionGeneration += 1;
    });

    await capturePhotoVaultComparison(input());

    expect(mocks.discardShare).toHaveBeenCalledWith(SHARE_ONE);
    expect(getPhotoVaultCompareExportState().status).not.toBe('ready');
  });

  it('does not repopulate after the comparator closes mid-capture', async () => {
    let resolveCapture: (uri: string) => void = () => {};
    mocks.captureRef.mockReturnValueOnce(
      new Promise<string>((resolve) => { resolveCapture = resolve; }),
    );
    const pending = capturePhotoVaultComparison(input());

    discardPhotoVaultComparisonExport();
    mocks.files.set(VIEW_SHOT_URI, { exists: true, size: 456 });
    resolveCapture(VIEW_SHOT_URI);
    await pending;

    expect(mocks.createShare).not.toHaveBeenCalled();
    expect(getPhotoVaultCompareExportState().status).toBe('idle');
  });
});

describe('structural privacy boundaries', () => {
  const source = readFileSync('src/lib/photoVaultCompareExport.ts', 'utf8');
  const sourceCode = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('never imports sharing, viewer ownership, Firebase or crypto', () => {
    for (const prohibited of [
      'expo-sharing',
      'shareAsync',
      'viewerOwnerId',
      'fullLru',
      'ensureFullPhotoLoaded',
      'claimGalleryPhotoForViewer',
      'downloadProgressPhoto',
      'getDownloadURL',
      'firebase/firestore',
      'firebase/storage',
      'photoVaultCrypto',
      'photoVaultKey',
    ]) {
      expect(sourceCode).not.toContain(prohibited);
    }
  });

  it('does not expose generic deletion or relax share cleanup', () => {
    expect(sourceCode).toContain('releaseCapture(uri)');
    expect(sourceCode).toContain('discardPhotoVaultShareFile');
    expect(sourceCode).not.toContain('cleanupPhotoVaultShareFiles');
    expect(sourceCode).not.toContain('.delete()');
  });

  it('does not contain a base64 pipeline', () => {
    expect(sourceCode).not.toContain("result: 'base64'");
    expect(sourceCode).not.toContain('.base64(');
    expect(sourceCode).not.toContain('.bytes(');
  });

  it('leaves crash recovery wired to startup', () => {
    const app = readFileSync('App.tsx', 'utf8');
    expect(app).toMatch(/useEffect\(\(\) => \{[\s\S]*cleanupPhotoVaultShareFiles\(\)/);
  });

  it('relies on fresh native JPEG encoders rather than source metadata', () => {
    const ios = readFileSync(
      'node_modules/react-native-view-shot/ios/RNViewShot.mm',
      'utf8',
    );
    const android = readFileSync(
      'node_modules/react-native-view-shot/android/src/main/java/fr/greweb/reactnativeviewshot/ViewShot.java',
      'utf8',
    );
    expect(ios).toContain('UIImageJPEGRepresentation(image, quality)');
    expect(android).toContain('bitmap.compress(cf, (int) (100.0 * quality), os)');
    for (const metadata of ['GPS', 'DateTimeOriginal', 'ExifInterface']) {
      expect(ios).not.toContain(metadata);
      expect(android).not.toContain(metadata);
    }
  });
});
