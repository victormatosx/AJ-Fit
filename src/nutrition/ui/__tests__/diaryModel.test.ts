import { describe, expect, it } from 'vitest';
import {
  diarySlotSummary, foodPickOriginToDiarySource, isPositiveGrams,
  moveMealItem, removeMealItem, replaceMealItems, sumItemTotals, sumMealTotals, upsertMealItem,
} from '../diaryModel';
import type { NutritionLoggedFoodItem, NutritionLoggedMeal } from '../../../types/nutrition';

function item(id: string, foodId: string, grams: number, kcal = 100): NutritionLoggedFoodItem<null> {
  return { id, foodId, grams, source: 'catalog_food',
    snapshot: { name: foodId, kcal, proteinG: 10, carbsG: 10, fatG: 5, fiberG: 2 }, loggedAt: null };
}

describe('sumItemTotals / sumMealTotals', () => {
  it('sums snapshot nutrients across items, treating missing fiber as 0', () => {
    const items = [item('1', 'a', 100, 100), { ...item('2', 'b', 100, 200), snapshot: { name: 'b', kcal: 200, proteinG: 5, carbsG: 5, fatG: 2 } }];
    expect(sumItemTotals(items)).toEqual({ kcal: 300, proteinG: 15, carbsG: 15, fatG: 7, fiberG: 2 });
  });

  it('sums meal totals across a day', () => {
    const meals = [{ totals: { kcal: 100, proteinG: 1, carbsG: 2, fatG: 3, fiberG: 4 } },
      { totals: { kcal: 50, proteinG: 1, carbsG: 2, fatG: 3, fiberG: 4 } }];
    expect(sumMealTotals(meals)).toEqual({ kcal: 150, proteinG: 2, carbsG: 4, fatG: 6, fiberG: 8 });
  });

  it('returns zero totals for an empty list', () => {
    expect(sumItemTotals([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
  });
});

describe('replaceMealItems', () => {
  it('creates a meal entry when none exists for the slot', () => {
    const meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)]);
    expect(meals).toHaveLength(1);
    expect(meals[0].slot).toBe('lunch');
    expect(meals[0].totals.kcal).toBe(100);
  });

  it('replaces an existing slot and recomputes totals', () => {
    const initial = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100, 100)]);
    const next = replaceMealItems(initial, 'lunch', [item('2', 'b', 100, 300)]);
    expect(next).toHaveLength(1);
    expect(next[0].items.map((i) => i.id)).toEqual(['2']);
    expect(next[0].totals.kcal).toBe(300);
  });

  it('removes the meal entry entirely when items become empty', () => {
    const initial = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)]);
    expect(replaceMealItems(initial, 'lunch', [])).toEqual([]);
  });

  it('sets followedRecommendedOptionId only when explicitly passed', () => {
    const withFollowed = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)], 'opt-1');
    expect(withFollowed[0].followedRecommendedOptionId).toBe('opt-1');
    const withoutFollowed = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)]);
    expect(withoutFollowed[0].followedRecommendedOptionId).toBeNull();
  });

  it('never touches other meal slots', () => {
    const initial = replaceMealItems<null>([], 'breakfast', [item('1', 'a', 100)]);
    const next = replaceMealItems(initial, 'lunch', [item('2', 'b', 100)]);
    expect(next.map((m) => m.slot).sort()).toEqual(['breakfast', 'lunch']);
  });
});

describe('upsertMealItem / removeMealItem', () => {
  it('adds a new item and updates an existing item by id, clearing followed status', () => {
    let meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)], 'opt-1');
    meals = upsertMealItem(meals, 'lunch', item('2', 'b', 50));
    expect(meals[0].items).toHaveLength(2);
    expect(meals[0].followedRecommendedOptionId).toBeNull();

    meals = upsertMealItem(meals, 'lunch', item('1', 'a', 200));
    expect(meals[0].items).toHaveLength(2);
    expect(meals[0].items.find((i) => i.id === '1')?.grams).toBe(200);
  });

  it('removes an item by id and recomputes totals', () => {
    let meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100, 100), item('2', 'b', 100, 50)]);
    meals = removeMealItem(meals, 'lunch', '1');
    expect(meals[0].items.map((i) => i.id)).toEqual(['2']);
    expect(meals[0].totals.kcal).toBe(50);
  });

  it('removing the last item drops the meal entry', () => {
    let meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)]);
    meals = removeMealItem(meals, 'lunch', '1');
    expect(meals).toEqual([]);
  });
});

describe('moveMealItem', () => {
  it('moves an item from one slot to another, clearing followed on both', () => {
    let meals: NutritionLoggedMeal<null>[] = replaceMealItems<null>([], 'breakfast', [item('1', 'a', 100)], 'opt-1');
    meals = upsertMealItem(meals, 'lunch', item('2', 'b', 50));
    meals = moveMealItem(meals, 'breakfast', 'lunch', '1');
    expect(meals.find((m) => m.slot === 'breakfast')).toBeUndefined();
    expect(meals.find((m) => m.slot === 'lunch')?.items.map((i) => i.id).sort()).toEqual(['1', '2']);
  });

  it('is a no-op for an unknown item id or same-slot move', () => {
    const meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100)]);
    expect(moveMealItem(meals, 'lunch', 'dinner', 'missing')).toEqual(meals);
    expect(moveMealItem(meals, 'lunch', 'lunch', '1')).toEqual(meals);
  });
});

describe('diarySlotSummary', () => {
  it('returns null when nothing is logged for the slot, a summary otherwise', () => {
    expect(diarySlotSummary(null, 'lunch')).toBeNull();
    const meals = replaceMealItems<null>([], 'lunch', [item('1', 'a', 100, 250), item('2', 'b', 50, 50)]);
    expect(diarySlotSummary({ meals }, 'lunch')).toEqual({ kcal: 300, itemCount: 2 });
    expect(diarySlotSummary({ meals }, 'breakfast')).toBeNull();
  });
});

describe('isPositiveGrams', () => {
  it('accepts any positive amount up to 10000g — Register Meal never limits grams to preset options', () => {
    expect(isPositiveGrams(1)).toBe(true);
    expect(isPositiveGrams(0.5)).toBe(true);
    expect(isPositiveGrams(37)).toBe(true);
    expect(isPositiveGrams(243.7)).toBe(true);
    expect(isPositiveGrams(10000)).toBe(true);
  });

  it('rejects zero, negative, non-finite and out-of-range amounts', () => {
    expect(isPositiveGrams(0)).toBe(false);
    expect(isPositiveGrams(-5)).toBe(false);
    expect(isPositiveGrams(NaN)).toBe(false);
    expect(isPositiveGrams(Infinity)).toBe(false);
    expect(isPositiveGrams(10001)).toBe(false);
  });
});

describe('foodPickOriginToDiarySource', () => {
  it('maps FoodSearchScreen origins to the diary logged-item source vocabulary', () => {
    expect(foodPickOriginToDiarySource('catalog')).toBe('catalog_food');
    expect(foodPickOriginToDiarySource('custom')).toBe('custom_food');
    expect(foodPickOriginToDiarySource('recipe')).toBe('recipe');
  });
});

