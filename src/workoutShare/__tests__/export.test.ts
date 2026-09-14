import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'ios' },
}));
vi.mock('react-native-view-shot', () => ({ captureRef: vi.fn(), releaseCapture: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test' }));

import {
  WORKOUT_SHARE_EXPORT_HEIGHT,
  WORKOUT_SHARE_EXPORT_WIDTH,
  workoutShareCaptureSize,
} from '../export';

describe('workout share export dimensions', () => {
  it('exports 1080x1920 on Android', () => {
    expect(workoutShareCaptureSize('android', 3)).toEqual({ width: 1080, height: 1920 });
  });

  it('converts target pixels to iOS renderer points', () => {
    expect(workoutShareCaptureSize('ios', 3)).toEqual({ width: 360, height: 640 });
    expect(WORKOUT_SHARE_EXPORT_WIDTH / WORKOUT_SHARE_EXPORT_HEIGHT).toBe(9 / 16);
  });
});
