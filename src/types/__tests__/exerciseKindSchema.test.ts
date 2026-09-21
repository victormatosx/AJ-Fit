import { describe, expect, it } from 'vitest';
import { catalogTargetErrors } from '../exercise';
import { CANONICAL_ACTIVITIES } from '../../workoutPrescription/canonicalActivities';
import { EXERCISES_SEED } from '../../data/exercisesSeedData';

describe('ExerciseKind discriminated schema — resistance requires primaryMuscle, cardio/mobility do not', () => {
  it('a resistance item without primaryMuscle fails', () => {
    expect(catalogTargetErrors('resistance', {})).toEqual(['PRIMARY_MUSCLE_REQUIRED_FOR_RESISTANCE']);
    expect(catalogTargetErrors('resistance', { primaryMuscle: '' })).toEqual(['PRIMARY_MUSCLE_REQUIRED_FOR_RESISTANCE']);
  });

  it('a resistance item with primaryMuscle passes', () => {
    expect(catalogTargetErrors('resistance', { primaryMuscle: 'chest' })).toEqual([]);
  });

  it('a cardio item without primaryMuscle passes', () => {
    expect(catalogTargetErrors('cardio', {})).toEqual([]);
  });

  it('a mobility item without primaryMuscle passes', () => {
    expect(catalogTargetErrors('mobility', {})).toEqual([]);
  });

  it('every real resistance exercise in EXERCISES_SEED satisfies the resistance rule', () => {
    for (const exercise of EXERCISES_SEED) {
      expect(catalogTargetErrors('resistance', exercise.target)).toEqual([]);
    }
  });

  it('every real cardio/mobility activity in CANONICAL_ACTIVITIES satisfies its own rule, and structurally has no primaryMuscle field', () => {
    for (const activity of CANONICAL_ACTIVITIES) {
      expect(catalogTargetErrors(activity.kind, {})).toEqual([]);
      expect('primaryMuscle' in activity).toBe(false);
    }
  });

  // Compile-time proof, not just runtime: `Exercise.target` (resistance)
  // structurally requires `primaryMuscle`, and `CanonicalActivity` (cardio/
  // mobility) structurally has no such field at all — not an optional one
  // relaxed for everyone, per the Fase 2 closure requirement to not just
  // make `primaryMuscle?` optional globally.
  it('type-level: Exercise.target.primaryMuscle is required (compile-time)', () => {
    const sample = EXERCISES_SEED[0];
    // @ts-expect-error primaryMuscle is required on ExerciseTarget
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof
    const _missing: typeof sample.target = { secondaryMuscles: [] };
    expect(sample.target.primaryMuscle).toBeDefined();
  });

  it('type-level: CanonicalActivity has no primaryMuscle field to assign (compile-time)', () => {
    const sample = CANONICAL_ACTIVITIES[0];
    // @ts-expect-error CanonicalActivity has no target/primaryMuscle field
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof
    const _extra = sample.primaryMuscle;
    expect(sample.kind === 'cardio' || sample.kind === 'mobility').toBe(true);
  });
});
