import { describe, expect, it } from 'vitest';
import type { NutritionMealSlot } from '../../../types/nutrition';
import { distributeMeals } from '../distributeMeals';

const daily = { kcal: 2400, proteinG: 150, fatG: 70, carbsG: 250, fiberG: 33.6 };

describe('distributeMeals', () => {
  it('2 main slots split energy evenly (same category -> equal weight -> equal share)', () => {
    const [breakfast, dinner] = distributeMeals(['breakfast', 'dinner'], daily);
    expect(breakfast.kcal.target).toBeCloseTo(1200, 5);
    expect(dinner.kcal.target).toBeCloseTo(1200, 5);
  });

  it('main slot gets a larger energy share than a snack slot (1.5 vs 1.0 weight)', () => {
    const [breakfast, morningSnack] = distributeMeals(['breakfast', 'morning_snack'], daily);
    // weights 1.5 and 1.0 over sum 2.5 -> 60%/40%
    expect(breakfast.kcal.target).toBeCloseTo(2400 * 0.6, 5);
    expect(morningSnack.kcal.target).toBeCloseTo(2400 * 0.4, 5);
  });

  it('protein is distributed more evenly than energy between main and snack (1.2 vs 1.0, not 1.5 vs 1.0)', () => {
    const [breakfast, morningSnack] = distributeMeals(['breakfast', 'morning_snack'], daily);
    // protein weights 1.2 and 1.0 over sum 2.2
    expect(breakfast.proteinG.target).toBeCloseTo(150 * (1.2 / 2.2), 5);
    expect(morningSnack.proteinG.target).toBeCloseTo(150 * (1.0 / 2.2), 5);
    // energy split (60/40) is more skewed than protein split (~54.5/45.5)
    const energyGap = breakfast.kcal.target / daily.kcal - morningSnack.kcal.target / daily.kcal;
    const proteinGap = breakfast.proteinG.target / daily.proteinG - morningSnack.proteinG.target / daily.proteinG;
    expect(energyGap).toBeGreaterThan(proteinGap);
  });

  it.each([2, 3, 4, 5, 6])('sum of per-meal kcal targets equals the daily kcal target for %i slots', (count) => {
    const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
    const slots = allSlots.slice(0, count);
    const meals = distributeMeals(slots, daily);
    const totalKcal = meals.reduce((sum, meal) => sum + meal.kcal.target, 0);
    expect(totalKcal).toBeCloseTo(daily.kcal, 5);

    const totalProtein = meals.reduce((sum, meal) => sum + meal.proteinG.target, 0);
    expect(totalProtein).toBeCloseTo(daily.proteinG, 5);
  });

  it('each range has min < target < max, consistent with the configured tolerances', () => {
    const meals = distributeMeals(['breakfast', 'lunch', 'dinner'], daily);
    for (const meal of meals) {
      expect(meal.kcal.min).toBeLessThan(meal.kcal.target);
      expect(meal.kcal.target).toBeLessThan(meal.kcal.max);
      expect(meal.proteinG.min).toBeLessThan(meal.proteinG.target);
      expect(meal.fiberG!.min).toBeLessThan(meal.fiberG!.target);
    }
  });

  it('returns one target per selected slot, in the same order', () => {
    const slots: NutritionMealSlot[] = ['dinner', 'breakfast', 'morning_snack'];
    const meals = distributeMeals(slots, daily);
    expect(meals.map((meal) => meal.slot)).toEqual(slots);
  });
});
