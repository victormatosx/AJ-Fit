import { describe, expect, it } from 'vitest';

import {
  MUSCLE_GROUP_PART_IDS,
  MUSCLE_ID_TO_GROUP,
  getMusclePartIds,
  muscleForPartId,
} from '../muscleMapRegions';
import { getBodyMuscleMapAnatomy } from '../../data/bodyMuscleMapAnatomy';
import type { MuscleId } from '../../types/exercise';
import type { Sex } from '../../state/AppState';

const ALL_MUSCLE_IDS: MuscleId[] = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back', 'front_deltoid',
  'side_deltoid', 'rear_deltoid', 'biceps', 'triceps', 'forearms', 'quads',
  'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'abs',
];
const BODY_MAP_SEXES: Sex[] = ['m', 'f'];

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

  it('every part id referenced by the mapping exists in at least one supported anatomy', () => {
    const realIds = new Set(BODY_MAP_SEXES.flatMap((sex) => {
      const anatomy = getBodyMuscleMapAnatomy(sex);
      return [
        ...anatomy.front.muscles.map((m) => m.id).filter(Boolean),
        ...anatomy.back.muscles.map((m) => m.id).filter(Boolean),
      ];
    }));
    for (const partIds of Object.values(MUSCLE_GROUP_PART_IDS)) {
      for (const partId of partIds) {
        expect(realIds.has(partId)).toBe(true);
      }
    }
  });

  it('every MuscleId appears in front or back for both male and female anatomies', () => {
    for (const sex of BODY_MAP_SEXES) {
      const anatomy = getBodyMuscleMapAnatomy(sex);
      const realIds = new Set([
        ...anatomy.front.muscles.map((m) => m.id).filter(Boolean),
        ...anatomy.back.muscles.map((m) => m.id).filter(Boolean),
      ]);
      for (const muscle of ALL_MUSCLE_IDS) {
        const visible = getMusclePartIds(muscle).some((id) => realIds.has(id));
        expect(visible, `${sex}:${muscle}`).toBe(true);
      }
    }
  });

  it('keeps trapezius selection compatible with center and left/right surface ids', () => {
    expect(muscleForPartId('TRAPEZIUS')).toBe('traps');
    expect(muscleForPartId('TRAPEZIUS_LEFT')).toBe('traps');
    expect(muscleForPartId('TRAPEZIUS_RIGHT')).toBe('traps');
  });
});
