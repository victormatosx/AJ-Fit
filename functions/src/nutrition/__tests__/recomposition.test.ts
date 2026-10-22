import { describe, expect, it } from 'vitest';
import type { MealNutritionTarget } from '../shared/types/nutrition';
import { buildMealOptions, PlanValidationError, type RawAiFoodItem, type RawMealOptions } from '../generation/domain';
import { validationRetryFeedback } from '../generation/diagnostics';

function food(name: string, per: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number }): RawAiFoodItem {
  return { name, quantity: 100, unit: 'g', preparationNote: '', allergens: [],
    ingredients: [{ name, origin: 'plant' }], estimatedNutrition: { ...per } };
}
const range = (min: number, target: number, max: number) => ({ min, target, max });

// Replays the investigated production incident (generation 6428a2d1...):
// a single-item meal where fat needs to go DOWN and fiber needs to go UP —
// no positive uniform scaling factor can do both at once, since both
// nutrients come from the same fixed-ratio ingredient.
function conflictingSingleItemMeal(): RawMealOptions {
  return { recommendedOptionIndex: 0, options: [{ foods: [food('Barra proteica', { kcal: 200, proteinG: 20, carbsG: 20, fatG: 10, fiberG: 2 })] }] };
}
function conflictingTarget(): MealNutritionTarget {
  return { slot: 'afternoon_snack', kcal: range(100, 200, 400), proteinG: range(0, 20, 40),
    carbsG: range(0, 20, 40), fatG: range(4, 5, 6), fiberG: range(6, 7, 8) };
}

describe('single-item meals with mathematically conflicting deviations', () => {
  it('reports empty_intersection rather than silently accepting or looping forever', () => {
    let caught: PlanValidationError | undefined;
    try { buildMealOptions('afternoon_snack', conflictingSingleItemMeal(), conflictingTarget(), [], true); }
    catch (error) { caught = error as PlanValidationError; }
    expect(caught?.code).toBe('AI_MACRO_VALIDATION_FAILED');
    const meal = caught?.diagnostics?.meals.find((m) => m.slot === 'afternoon_snack');
    expect(meal?.status).toBe('failed');
    expect(meal?.correction.status).toBe('rejected');
    expect(meal?.correction.reason).toBe('empty_intersection');
  });
  it('a two-item version of the exact same conflict is solved by the per-item optimizer instead', () => {
    // One high-fat/low-fiber item and one low-fat/high-fiber item give the
    // optimizer the two independent degrees of freedom a single item never
    // has: scale the first down for fat, the second up for fiber.
    const twoItems: RawMealOptions = { recommendedOptionIndex: 0, options: [{ foods: [
      food('Barra proteica', { kcal: 100, proteinG: 10, carbsG: 10, fatG: 9, fiberG: 1 }),
      food('Farelo de aveia', { kcal: 30, proteinG: 3, carbsG: 5, fatG: 0.2, fiberG: 4 }),
    ] }] };
    const wideTarget: MealNutritionTarget = { slot: 'afternoon_snack', kcal: range(40, 100, 500),
      proteinG: range(0, 10, 50), carbsG: range(0, 10, 50), fatG: range(4, 5, 6), fiberG: range(6, 7, 8) };
    const built = buildMealOptions('afternoon_snack', twoItems, wideTarget, [], true);
    const meal = built.diagnostics.meals.find((m) => m.slot === 'afternoon_snack');
    expect(meal?.status).toBe('passed');
    expect(meal?.correction.method).toBe('per_item');
  });
  it('retry feedback asks for a different/additional food for that slot, not a repeated rescale', () => {
    let caught: PlanValidationError | undefined;
    try { buildMealOptions('afternoon_snack', conflictingSingleItemMeal(), conflictingTarget(), [], true); }
    catch (error) { caught = error as PlanValidationError; }
    const feedback = JSON.parse(validationRetryFeedback(caught!.code, caught!.issue, caught!.diagnostics, { foo: 'bar' }));
    expect(feedback.instruction).toContain('afternoon_snack');
    expect(feedback.instruction).toContain('add an additional food item or substitute a different food');
  });
  it('never asks for recomposition on a meal that only needs a quantity change', () => {
    const scalable: RawMealOptions = { recommendedOptionIndex: 0, options: [{ foods: [
      food('Arroz', { kcal: 100, proteinG: 2, carbsG: 22, fatG: 0.2, fiberG: 1 }),
    ] }] };
    const tightTarget: MealNutritionTarget = { slot: 'lunch', kcal: range(180, 200, 220), proteinG: range(3, 4, 5),
      carbsG: range(39, 44, 48), fatG: range(0.3, 0.4, 0.5), fiberG: range(1.6, 2, 2.4) };
    let caught: PlanValidationError | undefined;
    try { buildMealOptions('lunch', scalable, tightTarget, [], true); }
    catch (error) { caught = error as PlanValidationError; }
    // Uniform scaling (x2) satisfies every nutrient here, so this never even reaches
    // a thrown error — confirming the recomposition instruction is never forced
    // onto a meal that a simple portion change already fixes.
    expect(caught).toBeUndefined();
  });
});
