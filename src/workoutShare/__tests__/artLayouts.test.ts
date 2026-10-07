import { describe, expect, it } from 'vitest';

import {
  availableWorkoutShareArtLayouts,
  isWorkoutShareArtLayoutAvailable,
  WORKOUT_SHARE_ART_EXPORT_HEIGHT,
  WORKOUT_SHARE_ART_EXPORT_WIDTH,
  WORKOUT_SHARE_ART_LAYOUTS,
} from '../artLayouts';
import { WORKOUT_SHARE_LAYOUTS } from '../layouts';

const derivedIds = ['photoClassic', 'photoMinimal', 'photoPerformance', 'photoBodymap', 'photoCreative', 'photoSocial'];
const existingIds = ['artMinimal', 'artPerformance', 'artPr', 'artStats'];

describe('workout share art layouts', () => {
  it('places every FOTO-derived art in the FOTO order, followed by all four existing arts', () => {
    expect(WORKOUT_SHARE_ART_LAYOUTS.map((layout) => layout.id)).toEqual([...derivedIds, ...existingIds]);
    expect(WORKOUT_SHARE_ART_LAYOUTS.slice(0, WORKOUT_SHARE_LAYOUTS.length).map((layout) => layout.sourcePhotoLayoutId))
      .toEqual(WORKOUT_SHARE_LAYOUTS.map((layout) => layout.id));
    expect(WORKOUT_SHARE_ART_LAYOUTS.slice(WORKOUT_SHARE_LAYOUTS.length).every((layout) => !layout.sourcePhotoLayoutId)).toBe(true);
  });

  it('shares the FOTO posters\' 9:16 aspect ratio, but exports at 2x the resolution (2160x3840) for Stories-safe enlargement', () => {
    expect(WORKOUT_SHARE_ART_EXPORT_WIDTH).toBe(2160);
    expect(WORKOUT_SHARE_ART_EXPORT_HEIGHT).toBe(3840);
    for (const layout of WORKOUT_SHARE_ART_LAYOUTS) {
      expect(layout.aspectRatio).toBe(9 / 16);
      expect(layout.exportWidth).toBe(2160);
      expect(layout.exportHeight).toBe(3840);
      expect(layout.exportWidth / layout.exportHeight).toBe(9 / 16);
    }
  });

  it('only gates artPr behind having at least one personal record this session', () => {
    expect(isWorkoutShareArtLayoutAvailable('artMinimal', { personalRecords: [] })).toBe(true);
    expect(isWorkoutShareArtLayoutAvailable('artPerformance', { personalRecords: [] })).toBe(true);
    expect(isWorkoutShareArtLayoutAvailable('artStats', { personalRecords: [] })).toBe(true);
    expect(isWorkoutShareArtLayoutAvailable('artPr', { personalRecords: [] })).toBe(false);
    expect(isWorkoutShareArtLayoutAvailable('artPr', { personalRecords: [{}] })).toBe(true);
  });

  it('filters artPr out of the available list when there is no personal record', () => {
    const ids = availableWorkoutShareArtLayouts({ personalRecords: [] }).map((layout) => layout.id);
    expect(ids).toEqual([...derivedIds, 'artMinimal', 'artPerformance', 'artStats']);
  });

  it('keeps artPr in the available list when there is at least one personal record', () => {
    const ids = availableWorkoutShareArtLayouts({ personalRecords: [{}] }).map((layout) => layout.id);
    expect(ids).toEqual([...derivedIds, ...existingIds]);
  });
});
