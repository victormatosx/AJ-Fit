import { describe, expect, it } from 'vitest';
import { foodNames, macroStatus, nextPlanMeal, planItemKcal, recommendedOption, remainingPlanMeals } from '../planView';
import { replaceMealItems } from '../diaryModel';
import type { NutritionLoggedFoodItem, NutritionMeal, NutritionPlanFoodItem } from '../../../types/nutrition';

function loggedItem(id: string): NutritionLoggedFoodItem<null> {
  return { id, foodId: id, grams: 100, source: 'catalog_food', snapshot: { name: id, kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1 }, loggedAt: null };
}

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
    expect(nextPlanMeal({ meals }, null)?.slot).toBe('breakfast');
    expect(remainingPlanMeals({ meals }).map((m) => m.slot)).toEqual(['lunch', 'dinner']);
  });

  it('returns null/empty for a plan with no meals', () => {
    expect(nextPlanMeal({ meals: [] }, null)).toBeNull();
    expect(remainingPlanMeals({ meals: [] })).toEqual([]);
  });

  it('with no Diary doc yet (day: null), falls back to the first canonical-order meal', () => {
    const meals = [meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1'), meal('dinner', 'dinner-1')];
    expect(nextPlanMeal({ meals }, null)?.slot).toBe('breakfast');
  });

  it('skips a fully-logged breakfast and surfaces lunch as next', () => {
    const meals = [meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1'), meal('dinner', 'dinner-1')];
    const day = { meals: replaceMealItems<null>([], 'breakfast', [loggedItem('a')]) };
    expect(nextPlanMeal({ meals }, day)?.slot).toBe('lunch');
  });

  it('a partially-logged meal (items present but slot touched) still counts as logged — only an empty slot is "next"', () => {
    const meals = [meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1')];
    const day = { meals: replaceMealItems<null>([], 'breakfast', [loggedItem('a')]) };
    // Breakfast has one item logged manually (a partial/manual entry, not necessarily the full plan) — it still counts as "logged" so next moves to lunch.
    expect(nextPlanMeal({ meals }, day)?.slot).toBe('lunch');
  });

  it('returns null once every meal is logged — never falls back to breakfast', () => {
    const meals = [meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1')];
    let loggedMeals = replaceMealItems<null>([], 'breakfast', [loggedItem('a')]);
    loggedMeals = replaceMealItems<null>(loggedMeals, 'lunch', [loggedItem('b')]);
    expect(nextPlanMeal({ meals }, { meals: loggedMeals })).toBeNull();
  });

  it('is correct even when plan.meals is stored out of canonical slot order (mealSlots selection order, not breakfast-first)', () => {
    const meals = [meal('dinner', 'dinner-1'), meal('breakfast', 'breakfast-1'), meal('lunch', 'lunch-1')];
    expect(nextPlanMeal({ meals }, null)?.slot).toBe('breakfast');
    const day = { meals: replaceMealItems<null>([], 'breakfast', [loggedItem('a')]) };
    expect(nextPlanMeal({ meals }, day)?.slot).toBe('lunch');
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
