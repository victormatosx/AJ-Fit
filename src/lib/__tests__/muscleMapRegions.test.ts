import { describe, expect, it } from 'vitest';

import {
  MUSCLE_GROUP_PART_IDS,
  MUSCLE_ID_TO_GROUP,
  getMusclePartIds,
  muscleForPartId,
} from '../muscleMapRegions';
import { BODY_MUSCLE_MAP_MALE } from '../../data/bodyMuscleMapAnatomy';
import type { MuscleId } from '../../types/exercise';

const ALL_MUSCLE_IDS: MuscleId[] = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back', 'front_deltoid',
  'side_deltoid', 'rear_deltoid', 'biceps', 'triceps', 'forearms', 'quads',
  'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'abs',
];

describe('muscleMapRegions', () => {
  it('maps all 18 official MuscleIds (18/18 coverage)', () => {
    expect(Object.keys(MUSCLE_ID_TO_GROUP).sort()).toEqual([...ALL_MUSCLE_IDS].sort());
  });

  it('gives every MuscleId at least one part id', () => {
    for (const muscle of ALL_MUSCLE_IDS) {
      expect(getMusclePartIds(muscle).length).toBeGreaterThan(0);
    }
  });

  it('maps each MuscleId to a distinct group (no two MuscleIds share a region)', () => {
    const groups = Object.values(MUSCLE_ID_TO_GROUP);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('round-trips: every part id resolves back to the MuscleId that owns it', () => {
    for (const muscle of ALL_MUSCLE_IDS) {
      for (const partId of getMusclePartIds(muscle)) {
        expect(muscleForPartId(partId)).toBe(muscle);
      }
    }
  });

  it('returns undefined for a part id outside the 18-muscle taxonomy', () => {
    expect(muscleForPartId('OBLIQUE_LEFT')).toBeUndefined();
    expect(muscleForPartId(undefined)).toBeUndefined();
  });

  it('every part id referenced by the mapping actually exists in the vendored front or back diagram', () => {
    const realIds = new Set([
      ...BODY_MUSCLE_MAP_MALE.front.muscles.map((m) => m.id).filter(Boolean),
      ...BODY_MUSCLE_MAP_MALE.back.muscles.map((m) => m.id).filter(Boolean),
    ]);
    for (const partIds of Object.values(MUSCLE_GROUP_PART_IDS)) {
      for (const partId of partIds) {
        expect(realIds.has(partId)).toBe(true);
      }
    }
  });

  it('every MuscleId appears in at least one of the front/back diagrams', () => {
    const realIds = new Set([
      ...BODY_MUSCLE_MAP_MALE.front.muscles.map((m) => m.id).filter(Boolean),
      ...BODY_MUSCLE_MAP_MALE.back.muscles.map((m) => m.id).filter(Boolean),
    ]);
    for (const muscle of ALL_MUSCLE_IDS) {
      const visible = getMusclePartIds(muscle).some((id) => realIds.has(id));
      expect(visible).toBe(true);
    }
  });
});
