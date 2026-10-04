import { describe, expect, it } from 'vitest';

import { getBodyMuscleMapAnatomy } from '../../data/bodyMuscleMapAnatomy';
import { muscleForPartId } from '../muscleMapRegions';
import {
  bodyMuscleMapDiagramKey,
  bodyMuscleMapPathKey,
  type BodyMuscleMapPathLayer,
} from '../bodyMuscleMapKeys';
import type { Sex } from '../../state/AppState';

const DIAGRAMS: { sex: Sex; view: 'front' | 'back' }[] = [
  { sex: 'm', view: 'front' },
  { sex: 'm', view: 'back' },
  { sex: 'f', view: 'front' },
  { sex: 'f', view: 'back' },
];

function duplicateAnatomicalIds(ids: (string | undefined)[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}

describe('Body Map React path keys', () => {
  it('documents the valid repeated surface ids in female v1.0.1 anatomy', () => {
    const female = getBodyMuscleMapAnatomy('f');
    expect(duplicateAnatomicalIds(female.front.muscles.map((path) => path.id))).toEqual([
      'QUADRICEPS_LEFT',
      'QUADRICEPS_RIGHT',
    ]);
    expect(duplicateAnatomicalIds(female.back.muscles.map((path) => path.id))).toEqual([
      'TRAPEZIUS_LEFT',
      'TRAPEZIUS_RIGHT',
    ]);
  });

  it('keeps male anatomy free of repeated surface ids', () => {
    const male = getBodyMuscleMapAnatomy('m');
    expect(duplicateAnatomicalIds(male.front.muscles.map((path) => path.id))).toEqual([]);
    expect(duplicateAnatomicalIds(male.back.muscles.map((path) => path.id))).toEqual([]);
  });

  it('generates unique keys for every sibling layer in all four diagrams', () => {
    for (const { sex, view } of DIAGRAMS) {
      const diagram = getBodyMuscleMapAnatomy(sex)[view];
      const diagramKey = bodyMuscleMapDiagramKey(sex, view);
      const layers: { layer: BodyMuscleMapPathLayer; keys: string[] }[] = [
        {
          layer: 'outline',
          keys: diagram.outline.map((path, index) => (
            bodyMuscleMapPathKey(diagramKey, 'outline', path, index)
          )),
        },
        {
          layer: 'hit',
          keys: diagram.muscles.map((path, index) => (
            bodyMuscleMapPathKey(diagramKey, 'hit', path, index)
          )),
        },
        {
          layer: 'visual',
          keys: diagram.muscles.map((path, index) => (
            bodyMuscleMapPathKey(diagramKey, 'visual', path, index)
          )),
        },
      ];

      for (const { layer, keys } of layers) {
        expect(new Set(keys).size, `${diagramKey}:${layer}`).toBe(keys.length);
      }
      const allSiblingKeys = layers.flatMap(({ keys }) => keys);
      expect(new Set(allSiblingKeys).size, `${diagramKey}:all`).toBe(allSiblingKeys.length);
    }
  });

  it('uses different React keys while preserving one semantic MuscleId for repeated paths', () => {
    const female = getBodyMuscleMapAnatomy('f');
    const cases = [
      { view: 'front' as const, id: 'QUADRICEPS_LEFT', muscleId: 'quads' },
      { view: 'front' as const, id: 'QUADRICEPS_RIGHT', muscleId: 'quads' },
      { view: 'back' as const, id: 'TRAPEZIUS_LEFT', muscleId: 'traps' },
      { view: 'back' as const, id: 'TRAPEZIUS_RIGHT', muscleId: 'traps' },
    ];

    for (const { view, id, muscleId } of cases) {
      const repeatedPaths = female[view].muscles
        .map((path, index) => ({ path, index }))
        .filter(({ path }) => path.id === id);
      const keys = repeatedPaths.map(({ path, index }) => (
        bodyMuscleMapPathKey(bodyMuscleMapDiagramKey('f', view), 'visual', path, index)
      ));

      expect(repeatedPaths, id).toHaveLength(2);
      expect(new Set(keys).size, id).toBe(2);
      expect(repeatedPaths.map(({ path }) => muscleForPartId(path.id))).toEqual([muscleId, muscleId]);
    }
  });
});
