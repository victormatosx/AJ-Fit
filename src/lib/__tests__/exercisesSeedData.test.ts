import { describe, expect, it } from 'vitest';

import { EXERCISES_SEED } from '../../data/exercisesSeedData';
import { validateExerciseSeed } from '../../validators/exerciseValidation';

describe('exercisesSeedData', () => {
  it('has exactly 123 exercises (116 pre-existing + 7 v1.27 Fase 2 closure additions)', () => {
    expect(EXERCISES_SEED).toHaveLength(123);
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

  it('keeps limitation-only variants explicit, non-self-referential, and catalog-backed', () => {
    const ids = new Set(EXERCISES_SEED.map((exercise) => exercise.id));
    const configured = EXERCISES_SEED
      .filter((exercise) => exercise.substitution.limitationVariantIds?.length)
      .map((exercise) => [exercise.id, exercise.substitution.limitationVariantIds]);

    expect(configured).toEqual([
      ['cable-rear-delt-fly', ['resistance-band-row']],
      ['conventional-deadlift', ['hip-hinge-drill', 'dumbbell-stiff-leg-deadlift']],
    ]);
    for (const exercise of EXERCISES_SEED) {
      for (const variantId of exercise.substitution.limitationVariantIds ?? []) {
        expect(variantId).not.toBe(exercise.id);
        expect(ids.has(variantId)).toBe(true);
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

  // v1.27 Fase 2 closure regression guard: the 7 new resistance exercises
  // are deliberately added without a `substitutionGroup` (see
  // exercisesSeedData.ts's comment above them) specifically so
  // `buildSubstitutions` never inserts them into an existing group's
  // auto-derived `similarExerciseIds` — i.e. none of the 116 pre-existing
  // exercises' equipment-substitution pool (read by the ACTIVE v2 runtime's
  // `composition.ts`) changes as a side effect of this catalog growth.
  it('the 7 v1.27 Fase 2 closure resistance additions never appear in any pre-existing exercise\'s similarExerciseIds', () => {
    const newIds = new Set([
      'decline-barbell-bench-press', 'dumbbell-fly', 'dumbbell-rear-delt-fly',
      'resistance-band-pullover', 'decline-push-up', 'incline-push-up',
      'resistance-band-standing-leg-curl',
    ]);
    expect(newIds.size).toBe(7);
    for (const exercise of EXERCISES_SEED) {
      if (newIds.has(exercise.id)) continue;
      for (const similarId of exercise.substitution.similarExerciseIds) {
        expect(newIds.has(similarId)).toBe(false);
      }
    }
  });

  it('the 7 new resistance additions have no substitution peers of their own (deliberately ungrouped)', () => {
    const newIds = new Set([
      'decline-barbell-bench-press', 'dumbbell-fly', 'dumbbell-rear-delt-fly',
      'resistance-band-pullover', 'decline-push-up', 'incline-push-up',
      'resistance-band-standing-leg-curl',
    ]);
    for (const exercise of EXERCISES_SEED) {
      if (newIds.has(exercise.id)) expect(exercise.substitution.similarExerciseIds).toEqual([]);
    }
  });
});
