import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKOUT_SHARE_LAYOUT_ID,
  getWorkoutShareLayoutMeta,
  WORKOUT_SHARE_ASPECT_RATIO,
  WORKOUT_SHARE_EXPORT_HEIGHT,
  WORKOUT_SHARE_EXPORT_WIDTH,
  WORKOUT_SHARE_LAYOUTS,
  workoutShareLayoutIndex,
  type WorkoutShareLayoutId,
} from '../layouts';

describe('workout share layout registry', () => {
  it('contains exactly 6 layouts', () => {
    expect(WORKOUT_SHARE_LAYOUTS).toHaveLength(6);
  });

  it('keeps the pre-existing single-poster design first and default', () => {
    expect(WORKOUT_SHARE_LAYOUTS[0]?.id).toBe('classic');
    expect(DEFAULT_WORKOUT_SHARE_LAYOUT_ID).toBe('classic');
    expect(workoutShareLayoutIndex(DEFAULT_WORKOUT_SHARE_LAYOUT_ID)).toBe(0);
  });

  it('includes the BodyMap layout', () => {
    expect(WORKOUT_SHARE_LAYOUTS.some((layout) => layout.id === 'bodymap')).toBe(true);
  });

  it('includes the Social Feed layout', () => {
    expect(WORKOUT_SHARE_LAYOUTS.some((layout) => layout.id === 'social')).toBe(true);
  });

  it('is the exact 6 designs: classic, minimal, performance, bodymap, creative, social', () => {
    expect(WORKOUT_SHARE_LAYOUTS.map((layout) => layout.id)).toEqual([
      'classic',
      'minimal',
      'performance',
      'bodymap',
      'creative',
      'social',
    ]);
  });

  it('gives every layout a unique id and a valid labelKey', () => {
    const ids = WORKOUT_SHARE_LAYOUTS.map((layout) => layout.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      expect(layout.labelKey.startsWith('done.shareComposer.layouts.')).toBe(true);
    }
  });

  it('locks every layout to the exact same 9:16 Stories canvas — no 1:1, no 4:5, no alternate formats', () => {
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      expect(layout.aspectRatio).toBeCloseTo(9 / 16, 5);
      expect(layout.aspectRatio).not.toBeCloseTo(1, 2);
      expect(layout.aspectRatio).not.toBeCloseTo(4 / 5, 2);
    }
    expect(WORKOUT_SHARE_ASPECT_RATIO).toBeCloseTo(9 / 16, 5);
  });

  it('exports every layout at exactly 1080x1920', () => {
    for (const layout of WORKOUT_SHARE_LAYOUTS) {
      expect(layout.exportWidth).toBe(1080);
      expect(layout.exportHeight).toBe(1920);
    }
    expect(WORKOUT_SHARE_EXPORT_WIDTH).toBe(1080);
    expect(WORKOUT_SHARE_EXPORT_HEIGHT).toBe(1920);
  });

  it('resolves layout metadata by id and rejects unknown ids', () => {
    const classic = getWorkoutShareLayoutMeta('classic');
    expect(classic.exportWidth).toBe(1080);
    expect(classic.exportHeight).toBe(1920);
    expect(() => getWorkoutShareLayoutMeta('nonexistent' as WorkoutShareLayoutId)).toThrow();
  });
});
