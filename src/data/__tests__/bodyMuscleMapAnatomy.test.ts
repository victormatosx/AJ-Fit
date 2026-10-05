import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BODY_MUSCLE_MAP_ASSET_VERSION,
  BODY_MUSCLE_MAP_MALE,
  BODY_MUSCLE_MAP_VIEW_BOX,
  getBodyMuscleMapAnatomy,
} from '../bodyMuscleMapAnatomy';
import { getMusclePartIds, muscleForPartId } from '../../lib/muscleMapRegions';
import { resolveMuscleIntensity } from '../../lib/muscleFillIntensity';
import type { MuscleId } from '../../types/exercise';

const ALL_MUSCLE_IDS: MuscleId[] = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back', 'front_deltoid',
  'side_deltoid', 'rear_deltoid', 'biceps', 'triceps', 'forearms', 'quads',
  'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'abs',
];

describe('Body Map sex-specific anatomy', () => {
  it('pins the vendored source to @musclemap/assets v1.0.1', () => {
    expect(BODY_MUSCLE_MAP_ASSET_VERSION).toBe('1.0.1');
    const femaleJson = JSON.stringify(getBodyMuscleMapAnatomy('f'));
    expect(createHash('sha256').update(femaleJson).digest('hex')).toBe(
      '8c3ad3738cbf6562f6c57eb05161d5fc1fece4e4269d2321daead494f4e8c243',
    );
  });

  it('resolves m to the existing male front/back diagrams', () => {
    const anatomy = getBodyMuscleMapAnatomy('m');
    expect(anatomy).toBe(BODY_MUSCLE_MAP_MALE);
    expect(anatomy.front.muscles).toHaveLength(27);
    expect(anatomy.back.muscles).toHaveLength(29);
  });

  it('resolves f to distinct female front/back diagrams', () => {
    const male = getBodyMuscleMapAnatomy('m');
    const female = getBodyMuscleMapAnatomy('f');
    expect(female).not.toBe(male);
    expect(female.front.muscles).toHaveLength(28);
    expect(female.back.muscles).toHaveLength(30);
    expect(female.front.outline[0]?.d).not.toBe(male.front.outline[0]?.d);
    expect(female.back.outline[0]?.d).not.toBe(male.back.outline[0]?.d);
  });

  it('provides front and back with the shared viewBox for both sexes', () => {
    for (const sex of ['m', 'f'] as const) {
      const anatomy = getBodyMuscleMapAnatomy(sex);
      expect(anatomy.front.viewBox).toBe(BODY_MUSCLE_MAP_VIEW_BOX);
      expect(anatomy.back.viewBox).toBe(BODY_MUSCLE_MAP_VIEW_BOX);
      expect(anatomy.front.outline.length).toBeGreaterThan(0);
      expect(anatomy.back.outline.length).toBeGreaterThan(0);
    }
  });

  it('does not silently fall back to male for unresolved or invalid values', () => {
    expect(() => getBodyMuscleMapAnatomy(null as never)).toThrow(/unsupported Body Map sex/);
    expect(() => getBodyMuscleMapAnatomy(undefined as never)).toThrow(/unsupported Body Map sex/);
    expect(() => getBodyMuscleMapAnatomy('female' as never)).toThrow(/unsupported Body Map sex/);
  });

  it('keeps all 18 MuscleIds highlightable in both anatomies', () => {
    for (const sex of ['m', 'f'] as const) {
      const anatomy = getBodyMuscleMapAnatomy(sex);
      const anatomyIds = new Set([
        ...anatomy.front.muscles.map((part) => part.id),
        ...anatomy.back.muscles.map((part) => part.id),
      ]);
      for (const muscleId of ALL_MUSCLE_IDS) {
        expect(
          getMusclePartIds(muscleId).some((partId) => anatomyIds.has(partId)),
          `${sex}:${muscleId}`,
        ).toBe(true);
      }
    }
  });

  it('uses the same MuscleId and primary/secondary rules for matching paths in both sexes', () => {
    const primary = new Set<MuscleId>(['triceps']);
    const secondary = new Set<MuscleId>(['biceps']);

    for (const sex of ['m', 'f'] as const) {
      const anatomy = getBodyMuscleMapAnatomy(sex);
      const ids = new Set([
        ...anatomy.front.muscles.map((part) => part.id),
        ...anatomy.back.muscles.map((part) => part.id),
      ]);
      expect(ids.has('TRICEPS_LEFT')).toBe(true);
      expect(ids.has('BICEPS_LEFT')).toBe(true);
      expect(muscleForPartId('TRICEPS_LEFT')).toBe('triceps');
      expect(muscleForPartId('BICEPS_LEFT')).toBe('biceps');
      expect(resolveMuscleIntensity('triceps', primary, secondary)).toBe('primary');
      expect(resolveMuscleIntensity('biceps', primary, secondary)).toBe('secondary');
    }
  });
});
