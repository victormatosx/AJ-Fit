import { describe,expect,it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { validateExerciseSeed } from '../../validators/exerciseValidation';

describe('exercisesSeedData', () => {
  it('has exactly 130 exercises (116 pre-existing + 7 Fase 2 + 2 spine Home + 5 full-coverage additions)', () => {
    expect(EXERCISES_SEED).toHaveLength(130);
  });

  it('passes full dataset validation', () => {
    const result = validateExerciseSeed(EXERCISES_SEED);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('has no self-references in similarExerciseIds', () => {
    for (const ex of EXERCISES_SEED) {
      expect(ex.substitution.similarExerciseIds).not.toContain(ex.id);
    }
  });

  it('only references similarExerciseIds that exist in the dataset', () => {
    const ids = new Set(EXERCISES_SEED.map((e) => e.id));
    for (const ex of EXERCISES_SEED) {
      for (const simId of ex.substitution.similarExerciseIds) {
        expect(ids.has(simId)).toBe(true);
      }
    }
  });

  it('never invents execution URLs', () => {
    for (const ex of EXERCISES_SEED) {
      expect(ex.execution.videos).toBeUndefined();
      expect(ex.execution.thumbnailUrl).toBeUndefined();
    }
  });

  it('marks every exercise active and fully available, per the seed task defaults', () => {
    for (const ex of EXERCISES_SEED) {
      expect(ex.status).toBe('active');
      expect(ex.availability).toEqual({
        workoutGeneration: true,
        manualSelection: true,
        substitution: true,
      });
    }
  });

  it('provides pt-BR, English, and Spanish instructions for the T001-T090 additions', () => {
    for (const ex of EXERCISES_SEED.slice(79)) {
      expect(ex.instructions?.ptBR.length).toBeGreaterThan(0);
      expect(ex.instructions?.en?.length).toBeGreaterThan(0);
      expect(ex.instructions?.es?.length).toBeGreaterThan(0);
    }
  });

  // One Fase 2 addition remains deliberately ungrouped. The other six
  // strength movements joined their normal groups only in the explicit
  // full-coverage closure so controlled second candidates can be reached.
  it('keeps the still-ungrouped Fase 2 addition out of every substitution pool', () => {
    const newIds = new Set([
      'resistance-band-pullover',
    ]);
    expect(newIds.size).toBe(1);
    for (const exercise of EXERCISES_SEED) {
      if (newIds.has(exercise.id)) continue;
      for (const similarId of exercise.substitution.similarExerciseIds) {
        expect(newIds.has(similarId)).toBe(false);
      }
    }
  });

  it('the remaining ungrouped Fase 2 addition has no substitution peers of its own', () => {
    const newIds = new Set([
      'resistance-band-pullover',
    ]);
    for (const exercise of EXERCISES_SEED) {
      if (newIds.has(exercise.id)) expect(exercise.substitution.similarExerciseIds).toEqual([]);
    }
  });
});
