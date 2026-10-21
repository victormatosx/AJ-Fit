import { describe,expect,it } from 'vitest';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { exerciseCatalogErrors } from '../exerciseCatalogValidity';

const baseline = EXERCISES_SEED.map((data) => ({ id: data.id, data }));

describe('operational exercise catalog', () => {
  it('accepts the complete ordinary catalog without clinical profiles', () => {
    expect(exerciseCatalogErrors(baseline)).toEqual([]);
  });
  it('rejects a missing required exercise', () => {
    expect(exerciseCatalogErrors(baseline.slice(1))).toEqual(expect.arrayContaining([expect.stringContaining('REQUIRED_EXERCISE_MISSING')]));
  });
});
