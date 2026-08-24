import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { validateExerciseSeed } from '../../validators/exerciseValidation';

describe('exercisesSeedData', () => {
  it('has exactly 116 exercises', () => {
    expect(EXERCISES_SEED).toHaveLength(116);
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
});
