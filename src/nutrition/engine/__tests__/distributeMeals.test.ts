import { describe, expect, it } from 'vitest';
import type { NutritionMealSlot } from '../../../types/nutrition';
import { distributeMeals } from '../distributeMeals';
import { NutritionEngineError } from '../errors';

const daily = { kcal: 2400, proteinG: 150, fatG: 70, carbsG: 250, fiberG: 33.6 };
const PROTEIN_KCAL_PER_GRAM = 4;
const FAT_KCAL_PER_GRAM = 9;
const CARBOHYDRATE_KCAL_PER_GRAM = 4;

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

  describe('per-meal energy coherence (macro-reliability-audit, 2026-10-21)', () => {
    // Root cause of intermittent AI_MACRO_VALIDATION_FAILED on tight-tolerance
    // snacks: protein used a different per-meal weight than kcal/fat/carbs, so a
    // meal's own protein+fat+carbs (at 4/9/4 kcal/g) did not reconstitute that
    // same meal's own kcal target. Carbs must be solved as the residual, exactly
    // like `calculateMacros` does at the daily level, never as an independent share.
    function impliedKcal(meal: ReturnType<typeof distributeMeals>[number]): number {
      return meal.proteinG.target * PROTEIN_KCAL_PER_GRAM
        + meal.fatG.target * FAT_KCAL_PER_GRAM
        + meal.carbsG.target * CARBOHYDRATE_KCAL_PER_GRAM;
    }

    it.each([2, 3, 4, 5, 6])('every meal (of %i selected slots) is internally energy-coherent: protein+fat+carbs reconstitutes its own kcal target', (count) => {
      const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
      const meals = distributeMeals(allSlots.slice(0, count), daily);
      for (const meal of meals) {
        expect(impliedKcal(meal)).toBeCloseTo(meal.kcal.target, 6);
      }
    });

    it('a ~300kcal afternoon snack (tight tolerance window) is energy-coherent, not merely close', () => {
      // Reproduces the exact shape of the reported failure: a 6-slot plan where
      // the afternoon snack lands near 300kcal with a tight +-5% kcal window.
      const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
      const lowDaily = { kcal: 2250, proteinG: 180, fatG: 62.5, carbsG: 242, fiberG: 31.5 };
      const meals = distributeMeals(allSlots, lowDaily);
      const snack = meals.find((meal) => meal.slot === 'afternoon_snack')!;
      expect(snack.kcal.target).toBeGreaterThan(280);
      expect(snack.kcal.target).toBeLessThan(320);
      expect(impliedKcal(snack)).toBeCloseTo(snack.kcal.target, 6);
    });

    it('previously-silent energy-incoherent target is now a loud MACRO_ALLOCATION_INFEASIBLE, never a negative/impossible carbsG', () => {
      // A severely tight daily macro budget (very high protein relative to a
      // reduced-calorie target, as calculateMacros can legitimately produce for
      // an aggressive weight_loss pace at a high body weight) combined with the
      // snack protein-share premium can make a single meal's own protein+fat
      // alone exceed that meal's kcal share. Before this fix, distributeMeals
      // would have silently returned a carbsG target making the mismatch worse
      // instead of surfacing it.
      const tightDaily = { kcal: 1500, proteinG: 190, fatG: 80, carbsG: 5, fiberG: 21 };
      const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
      expect(() => distributeMeals(allSlots, tightDaily)).toThrow(NutritionEngineError);
      try {
        distributeMeals(allSlots, tightDaily);
        throw new Error('expected to throw');
      } catch (error) {
        expect((error as NutritionEngineError).code).toBe('MACRO_ALLOCATION_INFEASIBLE');
      }
    });

    it('carbsG = 0 for a meal is a valid boundary (not an error) when protein + fat exactly consume that meal\'s kcal target', () => {
      // Single slot reduces shares to 1, so this is the same boundary
      // calculateMacros already treats as valid at the daily level.
      const boundaryDaily = { kcal: 952, proteinG: 112, fatG: 56, carbsG: 0, fiberG: 13.3 };
      const [meal] = distributeMeals(['lunch'], boundaryDaily);
      expect(meal.carbsG.target).toBeCloseTo(0, 5);
      expect(meal.carbsG.target).toBeGreaterThanOrEqual(0);
    });

    it('sum of per-meal carbsG targets still equals the daily carbsG target, when the daily totals are themselves energy-coherent (as calculateMacros always produces)', () => {
      // daily.carbsG here is deliberately NOT self-consistent with
      // daily.{kcal,proteinG,fatG} (250 vs the 292.5 that 4/9/4 implies) — it's
      // an arbitrary fixture, not calculateMacros output. The sum-preservation
      // guarantee only holds for a self-consistent daily input, which is what
      // the real engine always passes in practice.
      const coherentDaily = { kcal: 2400, proteinG: 150, fatG: 70, carbsG: 292.5, fiberG: 33.6 };
      const allSlots: NutritionMealSlot[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'];
      const meals = distributeMeals(allSlots, coherentDaily);
      const totalCarbs = meals.reduce((sum, meal) => sum + meal.carbsG.target, 0);
      expect(totalCarbs).toBeCloseTo(coherentDaily.carbsG, 5);
    });
  });
});
