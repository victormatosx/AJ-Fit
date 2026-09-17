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
  createWorkoutShareExportUri: vi.fn(() => '/cache/workout-share/export/test.jpg'),
  discardWorkoutShareFile: vi.fn(),
}));

import { captureRef } from 'react-native-view-shot';
import { captureWorkoutSharePoster, workoutShareCaptureSize } from '../export';
import { WORKOUT_SHARE_LAYOUTS } from '../layouts';

describe('workout share export dimensions', () => {
  it('exports each layout at its declared pixel size on Android (no scaling)', () => {
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      expect(workoutShareCaptureSize(layout.exportWidth, layout.exportHeight, 'android', 3)).toEqual({
        width: layout.exportWidth,
        height: layout.exportHeight,
      });
    }
  });

  it('converts each layout\'s target pixels to iOS renderer points using the device pixel ratio', () => {
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      expect(workoutShareCaptureSize(layout.exportWidth, layout.exportHeight, 'ios', 3)).toEqual({
        width: layout.exportWidth / 3,
        height: layout.exportHeight / 3,
      });
    }
  });

  it('keeps the Classic layout export at 1080x1920 (9:16), matching the pre-multi-layout behavior', () => {
    const classic = WORKOUT_SHARE_LAYOUTS.find((layout) => layout.id === 'classic')!;
    expect(classic.exportWidth).toBe(1080);
    expect(classic.exportHeight).toBe(1920);
    expect(classic.exportWidth / classic.exportHeight).toBe(9 / 16);
    expect(workoutShareCaptureSize(classic.exportWidth, classic.exportHeight, 'ios', 3)).toEqual({ width: 360, height: 640 });
  });

  it('falls back to a ratio of 1 for a missing/invalid pixel ratio', () => {
    expect(workoutShareCaptureSize(1080, 1920, 'ios', 0)).toEqual({ width: 1080, height: 1920 });
    expect(workoutShareCaptureSize(1080, 1920, 'ios', Number.NaN)).toEqual({ width: 1080, height: 1920 });
  });
});

function refTo(node: unknown): RefObject<View | null> {
  return { current: node as View | null };
}

describe('captureWorkoutSharePoster', () => {
  it('requests the capture at the size derived from the given layout export dimensions', async () => {
    const mockedCaptureRef = vi.mocked(captureRef);
    mockedCaptureRef.mockResolvedValueOnce('/tmp/shot.jpg');
    const performance = WORKOUT_SHARE_LAYOUTS.find((layout) => layout.id === 'performance')!;

    await captureWorkoutSharePoster(refTo({}), { width: performance.exportWidth, height: performance.exportHeight });

    expect(mockedCaptureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: performance.exportWidth / 3,
        height: performance.exportHeight / 3,
        format: 'jpg',
      }),
    );
  });

  it('throws without capturing when the poster ref is not mounted', async () => {
    await expect(captureWorkoutSharePoster(refTo(null), { width: 1080, height: 1080 })).rejects.toThrow(
      'workout share poster is not ready',
    );
  });
});
