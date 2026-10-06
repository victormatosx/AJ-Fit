import type { RefObject } from 'react';
import type { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'ios' },
}));
vi.mock('react-native-view-shot', () => ({ captureRef: vi.fn(), releaseCapture: vi.fn() }));

const { FakeFile } = vi.hoisted(() => {
  class FakeFile {
    uri: string;
    exists = true;
    size = 1024;
    constructor(uri: string) {
      this.uri = uri;
    }
    async copy(target: FakeFile) {
      target.exists = true;
      target.size = this.size;
    }
  }
  return { FakeFile };
});
vi.mock('expo-file-system', () => ({ File: FakeFile }));
vi.mock('../files', () => ({
  createWorkoutShareExportUri: vi.fn((extension: string) => `/cache/workout-share/export/test.${extension}`),
  discardWorkoutShareFile: vi.fn(),
}));

import { captureRef } from 'react-native-view-shot';
import { captureWorkoutShareArt, workoutShareArtRenderSize } from '../exportArt';
import { WORKOUT_SHARE_ART_LAYOUTS } from '../artLayouts';

function refTo(node: unknown): RefObject<View | null> {
  return { current: node as View | null };
}

describe('captureWorkoutShareArt', () => {
  it('requests a lossless PNG capture, never jpg/quality', async () => {
    const mockedCaptureRef = vi.mocked(captureRef);
    mockedCaptureRef.mockResolvedValueOnce('/tmp/shot.png');
    const minimal = WORKOUT_SHARE_ART_LAYOUTS.find((layout) => layout.id === 'artMinimal')!;

    await captureWorkoutShareArt(refTo({}), { width: minimal.exportWidth, height: minimal.exportHeight });

    expect(mockedCaptureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: minimal.exportWidth / 3,
        height: minimal.exportHeight / 3,
        format: 'png',
      }),
    );
    const call = mockedCaptureRef.mock.calls[0][1] as Record<string, unknown>;
    expect(call).not.toHaveProperty('quality');
  });

  it('throws without capturing when the poster ref is not mounted', async () => {
    await expect(captureWorkoutShareArt(refTo(null), { width: 1080, height: 1920 })).rejects.toThrow(
      'workout share art poster is not ready',
    );
  });
});

describe('workoutShareArtRenderSize', () => {
  it('divides the export pixel target by the device pixel ratio, on every platform (never a platform branch)', () => {
    // Unlike `workoutShareCaptureSize`, this never special-cases Android —
    // the off-screen poster's own RN width/height props are always in
    // density-independent units (points on iOS, dp on Android), and both
    // are converted to native pixels by the same device pixel ratio.
    expect(workoutShareArtRenderSize(2160, 3840, 3)).toEqual({ width: 720, height: 1280 });
    expect(workoutShareArtRenderSize(2160, 3840, 2)).toEqual({ width: 1080, height: 1920 });
  });

  it('matches every ARTE layout\'s declared export size exactly (regression guard for the 2160x3840 resolution bump)', () => {
    for (const layout of WORKOUT_SHARE_ART_LAYOUTS) {
      expect(layout.exportWidth).toBe(2160);
      expect(layout.exportHeight).toBe(3840);
      const size = workoutShareArtRenderSize(layout.exportWidth, layout.exportHeight, 3);
      expect(size.width * 3).toBe(layout.exportWidth);
      expect(size.height * 3).toBe(layout.exportHeight);
    }
  });

  it('falls back to a ratio of 1 for a missing/invalid pixel ratio, same as workoutShareCaptureSize', () => {
    expect(workoutShareArtRenderSize(2160, 3840, 0)).toEqual({ width: 2160, height: 3840 });
    expect(workoutShareArtRenderSize(2160, 3840, Number.NaN)).toEqual({ width: 2160, height: 3840 });
  });
});
