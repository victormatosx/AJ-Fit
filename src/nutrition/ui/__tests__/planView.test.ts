import { describe, expect, it } from 'vitest';
import { foodNames, macroStatus, nextPlanMeal, planItemKcal, recommendedOption, remainingPlanMeals } from '../planView';
import type { NutritionMeal, NutritionPlanFoodItem } from '../../../types/nutrition';

const totals = { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15, fiberG: 8 };

function meal(slot: NutritionMeal['slot'], recommendedOptionId: string): NutritionMeal {
  return {
    slot,
    recommendedOptionId,
    options: [
      { id: `${slot}-1`, foods: [{ name: 'A', quantity: 100, unit: 'g', preparationNote: '', estimatedNutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 2 }, allergens: [] }], totals },
      { id: `${slot}-2`, foods: [{ name: 'B', quantity: 100, unit: 'g', preparationNote: '', estimatedNutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 2 }, allergens: [] }], totals },
    ],
  };
}

describe('recommendedOption', () => {
  it('returns the option matching recommendedOptionId', () => {
    const m = meal('breakfast', 'breakfast-2');
    expect(recommendedOption(m).id).toBe('breakfast-2');
  });

  it('throws if recommendedOptionId does not reference any option', () => {
    const m = meal('breakfast', 'missing');
    expect(() => recommendedOption(m)).toThrow('NUTRITION_PLAN_RECOMMENDED_OPTION_MISSING');
  });
});

describe('nextPlanMeal / remainingPlanMeals', () => {
  it('surfaces the first mealSlots-ordered meal as next, the rest as the day list', () => {
    const meals = [meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1'), meal('dinner', 'dinner-1')];
    expect(nextPlanMeal({ meals })?.slot).toBe('breakfast');
    expect(remainingPlanMeals({ meals }).map((m) => m.slot)).toEqual(['lunch', 'dinner']);
  });

  it('returns null/empty for a plan with no meals', () => {
    expect(nextPlanMeal({ meals: [] })).toBeNull();
    expect(remainingPlanMeals({ meals: [] })).toEqual([]);
  });
});

describe('foodNames / planItemKcal — diet-quality-v3 free-form items, with pre-v3 legacy compatibility', () => {
  it('has no foodId/sourceId on a freshly generated plan item', () => {
    const item: NutritionPlanFoodItem = {
      name: 'Arroz branco cozido', quantity: 150, unit: 'g', preparationNote: 'cozido',
      estimatedNutrition: { kcal: 190, proteinG: 4, carbsG: 41, fatG: 0.4, fiberG: 1 }, allergens: [],
    };
    expect('foodId' in item).toBe(false);
    expect('sourceId' in item).toBe(false);
    expect(planItemKcal(item)).toBe(190);
  });

  it('returns null, never throws, for a pre-diet-quality-v3 item with no estimatedNutrition at all', () => {
    // The old catalog architecture never stored a per-item nutrition
    // snapshot — it resolved live against `nutritionFoods`, a code path
    // that no longer exists. A plan/favorite persisted back then can still
    // surface here with `estimatedNutrition` simply absent.
    const legacyItem = { name: 'Arroz', quantity: 150, unit: 'g', preparationNote: '' } as NutritionPlanFoodItem;
    expect(() => planItemKcal(legacyItem)).not.toThrow();
    expect(planItemKcal(legacyItem)).toBeNull();
  });

  it('returns null, never throws, when estimatedNutrition is present but incomplete', () => {
    const incompleteItem = {
      name: 'Feijão', quantity: 100, unit: 'g', preparationNote: '',
      estimatedNutrition: {} as NutritionPlanFoodItem['estimatedNutrition'],
    } as NutritionPlanFoodItem;
    expect(() => planItemKcal(incompleteItem)).not.toThrow();
    expect(planItemKcal(incompleteItem)).toBeNull();
  });

  it('joins free-form names as-is even when some items in the meal lack estimatedNutrition', () => {
    const m: NutritionMeal = {
      slot: 'lunch',
      recommendedOptionId: 'lunch-1',
      options: [{
        id: 'lunch-1',
        foods: [
          { name: 'Arroz branco cozido', quantity: 150, unit: 'g', preparationNote: '', estimatedNutrition: { kcal: 190, proteinG: 4, carbsG: 41, fatG: 0.4, fiberG: 1 }, allergens: [] },
          { name: 'Feijão (histórico)', quantity: 100, unit: 'g', preparationNote: '' } as NutritionPlanFoodItem,
        ],
        totals,
      }],
    };
    expect(() => foodNames(m)).not.toThrow();
    expect(foodNames(m)).toBe('Arroz branco cozido, Feijão (histórico)');
  });
});

describe('macroStatus', () => {
  it('is "near" within a generous band around the goal, never punitive for normal variance', () => {
    expect(macroStatus(100, 100)).toBe('near');
    expect(macroStatus(95, 100)).toBe('near');
    expect(macroStatus(108, 100)).toBe('near');
  });

  it('is "below"/"above" only outside the near band', () => {
    expect(macroStatus(80, 100)).toBe('below');
    expect(macroStatus(130, 100)).toBe('above');
  });

  it('treats a non-positive goal as "near" rather than dividing by zero', () => {
    expect(macroStatus(50, 0)).toBe('near');
  });
});
