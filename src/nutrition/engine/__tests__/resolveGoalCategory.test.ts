import { describe, expect, it } from 'vitest';
import { NutritionEngineError } from '../errors';
import { resolveGoalCategory } from '../resolveGoalCategory';

describe('resolveGoalCategory', () => {
  it.each([
    ['gain_muscle', 'muscle_gain'],
    ['hyper', 'muscle_gain'],
    ['lose_fat', 'weight_loss'],
    ['cut', 'weight_loss'],
    ['body_composition', 'body_recomposition'],
    ['def', 'body_recomposition'],
    ['health', 'maintenance'],
  ] as const)('%s -> %s via direct mapping, ignoring nutritionGoalCategory', (goal, expected) => {
    expect(resolveGoalCategory(goal, { nutritionGoalCategory: undefined })).toBe(expected);
    // Direct mapping wins even if a (nonsensical) override was supplied.
    expect(resolveGoalCategory(goal, { nutritionGoalCategory: 'maintenance' })).toBe(expected);
  });

  it.each(['strength', 'conditioning', 'perf', 'return_to_training', 'recon'] as const)(
    '%s throws GOAL_UNRESOLVED when nutritionGoalCategory is absent — never a silent default',
    (goal) => {
      expect(() => resolveGoalCategory(goal, { nutritionGoalCategory: undefined }))
        .toThrow(NutritionEngineError);
      try {
        resolveGoalCategory(goal, { nutritionGoalCategory: undefined });
      } catch (error) {
        expect(error).toBeInstanceOf(NutritionEngineError);
        expect((error as NutritionEngineError).code).toBe('GOAL_UNRESOLVED');
      }
    },
  );

  it.each(['strength', 'conditioning', 'perf', 'return_to_training', 'recon'] as const)(
    '%s uses nutritionGoalCategory when provided',
    (goal) => {
      expect(resolveGoalCategory(goal, { nutritionGoalCategory: 'body_recomposition' })).toBe('body_recomposition');
    },
  );
});
