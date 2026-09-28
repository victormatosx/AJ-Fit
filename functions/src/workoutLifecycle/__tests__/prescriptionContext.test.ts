import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { loadExerciseCatalog } from '../prescriptionContext';
import { EXERCISES_SEED } from '../prescriptionEngine/data/exercisesSeedData';

function validExerciseDoc(id: string): Record<string, unknown> {
  return {
    slug: id,
    status: 'active',
    equipment: [],
    target: { primaryMuscle: 'chest' },
    movement: { pattern: 'push' },
    availability: {},
    substitution: { similarExerciseIds: [] },
  };
}

function fakeFirestore(docs: readonly { id: string; data: Record<string, unknown> }[]): Firestore {
  return {
    collection: (name: string) => {
      if (name !== 'exercises') throw new Error(`unexpected collection: ${name}`);
      return {
        get: async () => ({
          docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })),
        }),
      };
    },
  } as unknown as Firestore;
}

describe('loadExerciseCatalog — required-id membership, not exact global count', () => {
  it('accepts a remote catalog containing every id EXERCISES_SEED requires', async () => {
    const docs = EXERCISES_SEED.map((exercise) => ({ id: exercise.id, data: validExerciseDoc(exercise.id) }));
    const catalog = await loadExerciseCatalog(fakeFirestore(docs));
    expect(catalog).toHaveLength(EXERCISES_SEED.length);
    expect(new Set(catalog.map((exercise) => exercise.id))).toEqual(new Set(EXERCISES_SEED.map((exercise) => exercise.id)));
  });

  it('rejects when any id required by EXERCISES_SEED is missing from the remote catalog', async () => {
    const missing = EXERCISES_SEED[EXERCISES_SEED.length - 1].id;
    const docs = EXERCISES_SEED
      .filter((exercise) => exercise.id !== missing)
      .map((exercise) => ({ id: exercise.id, data: validExerciseDoc(exercise.id) }));
    await expect(loadExerciseCatalog(fakeFirestore(docs))).rejects.toMatchObject({
      code: 'failed-precondition',
      message: `authoritative_exercise_catalog_required_exercise_missing:${missing}`,
    });
  });

  it('extra documents in Firestore beyond the local seed never invalidate the catalog', async () => {
    const docs = [
      ...EXERCISES_SEED.map((exercise) => ({ id: exercise.id, data: validExerciseDoc(exercise.id) })),
      { id: 'not-in-local-seed-yet', data: validExerciseDoc('not-in-local-seed-yet') },
    ];
    const catalog = await loadExerciseCatalog(fakeFirestore(docs));
    expect(catalog).toHaveLength(EXERCISES_SEED.length + 1);
    expect(catalog.some((exercise) => exercise.id === 'not-in-local-seed-yet')).toBe(true);
  });
});
