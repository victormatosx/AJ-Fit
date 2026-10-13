import type { MealNutritionTarget, NutritionMealSlot, NutritionNumericRange } from '../../types/nutrition';
import {
  ENERGY_WEIGHT_BY_MEAL_CATEGORY,
  MEAL_SLOT_CATEGORY,
  type MealSlotCategory,
  PROTEIN_WEIGHT_BY_MEAL_CATEGORY,
  TOLERANCE_PERCENT,
} from './constants';

export interface DailyTotalsForDistribution {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
}

/**
 * `canonical/nutrition_rules.json` `mealDistribution.distributionWeights`:
 * energy/fat/carbs follow the "main vs. snack" energy weight; protein uses
 * its own gentler weight so it stays "relatively even"
 * (`mealDistribution.proteinRelativelyEven`). Ranges around each per-meal
 * target use the same daily tolerances (`tolerances`) — a deliberate
 * simplification (one tolerance table, not a second per-meal one).
 */
export function distributeMeals(
  mealSlots: NutritionMealSlot[],
  daily: DailyTotalsForDistribution,
): MealNutritionTarget[] {
  const energyShares = normalizedShares(mealSlots, ENERGY_WEIGHT_BY_MEAL_CATEGORY);
  const proteinShares = normalizedShares(mealSlots, PROTEIN_WEIGHT_BY_MEAL_CATEGORY);

  return mealSlots.map((slot, index) => ({
    slot,
    kcal: rangeFor(daily.kcal * energyShares[index], TOLERANCE_PERCENT.calories),
    proteinG: rangeFor(daily.proteinG * proteinShares[index], TOLERANCE_PERCENT.protein),
    carbsG: rangeFor(daily.carbsG * energyShares[index], TOLERANCE_PERCENT.carbohydrates),
    fatG: rangeFor(daily.fatG * energyShares[index], TOLERANCE_PERCENT.fat),
    fiberG: rangeFor(daily.fiberG * energyShares[index], TOLERANCE_PERCENT.fiber),
  }));
}

function normalizedShares(slots: NutritionMealSlot[], weightByCategory: Record<MealSlotCategory, number>): number[] {
  const weights = slots.map((slot) => weightByCategory[MEAL_SLOT_CATEGORY[slot]]);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return weights.map((weight) => weight / sum);
}

function rangeFor(target: number, tolerancePercent: number): NutritionNumericRange {
  return {
    min: target * (1 - tolerancePercent),
    target,
    max: target * (1 + tolerancePercent),
  };
}
