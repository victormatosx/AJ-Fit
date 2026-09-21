import { describe, expect, it } from 'vitest';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { exerciseCatalogErrors } from '../exerciseCatalogValidity';

const baseline = EXERCISES_SEED.map((data) => ({ id: data.id, data }));

describe('limitation exercise catalog validity', () => {
  it('accepts the baseline and an additional valid exercise', () => {
    expect(exerciseCatalogErrors(baseline)).toEqual([]);
    const extra = { ...EXERCISES_SEED[0], id: 'future-valid-exercise', slug: 'future-valid-exercise' };
    expect(exerciseCatalogErrors([...baseline, { id: extra.id, data: extra }])).toEqual([]);
  });

  it('rejects a missing baseline exercise, invalid document, and duplicate ID', () => {
    expect(exerciseCatalogErrors(baseline.slice(1))).toContain(`LIMITATION_CATALOG_REQUIRED_EXERCISE_MISSING:${baseline[0].id}`);
    expect(exerciseCatalogErrors([{ id: baseline[0].id, data: {} }, ...baseline.slice(1)]))
      .toContain(`LIMITATION_CATALOG_EXERCISE_INVALID:${baseline[0].id}`);
    expect(exerciseCatalogErrors([...baseline, baseline[0]]))
      .toContain(`LIMITATION_CATALOG_DUPLICATE_ID:${baseline[0].id}`);
  });
});
