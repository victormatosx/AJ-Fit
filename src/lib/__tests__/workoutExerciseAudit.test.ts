import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditWorkoutExercises } from '../../../scripts/auditWorkoutExercises';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';

const workouts = JSON.parse(readFileSync(resolve('docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json'), 'utf8'));

describe('T001-T090 exercise references', () => {
  it('resolve to the canonical exercise catalog without invalid placeholders or duplicates', () => {
    const result = auditWorkoutExercises(workouts, EXERCISES_SEED);
    expect(result).toEqual({
      totalWorkouts: 90,
      totalExerciseReferences: 2116,
      uniqueExercises: 71,
      missingExercises: [],
      invalidReferences: [],
      duplicateCanonicalExercises: [],
      schemaErrors: [],
    });
  });
});
