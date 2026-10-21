import type { MealNutritionTarget, NutritionMealSlot, NutritionNumericRange } from '../../types/nutrition';
import {
  CARBOHYDRATE_KCAL_PER_GRAM,
  ENERGY_WEIGHT_BY_MEAL_CATEGORY,
  FAT_KCAL_PER_GRAM,
  MEAL_SLOT_CATEGORY,
  type MealSlotCategory,
  PROTEIN_KCAL_PER_GRAM,
  PROTEIN_WEIGHT_BY_MEAL_CATEGORY,
  TOLERANCE_PERCENT,
} from './constants';
import { NutritionEngineError } from './errors';

export interface DailyTotalsForDistribution {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
}

/**
 * `canonical/nutrition_rules.json` `mealDistribution.distributionWeights`:
 * energy/fat follow the "main vs. snack" energy weight; protein deliberately
 * uses its own gentler weight so it stays "relatively even"
 * (`mealDistribution.proteinRelativelyEven`). Because protein's share of a
 * meal therefore diverges from that meal's share of energy, carbs CANNOT
 * also be assigned an independent energy-weighted share without routinely
 * producing a meal whose own protein+fat+carbs (at 4/9/4 kcal/g) implies a
 * kcal total outside that meal's own kcal range — a self-inconsistent
 * target no real food can satisfy, and no uniform portion-scaling
 * correction can repair (see `functions/src/nutrition/generation/correction.ts`:
 * it scales one candidate's existing ratios, it cannot change them). Carbs
 * is instead solved as the residual that makes each meal's own
 * protein/fat/carbs exactly reconstitute its own kcal target — the same
 * technique `calculateMacros` already uses at the daily level. This keeps
 * `proteinRelativelyEven` and the energy/fat weighting exactly as
 * documented; only how carbs is derived changes. Ranges around each
 * per-meal target use the same daily tolerances (`tolerances`) — a
 * deliberate simplification (one tolerance table, not a second per-meal one).
 */
export function distributeMeals(
  mealSlots: NutritionMealSlot[],
  daily: DailyTotalsForDistribution,
): MealNutritionTarget[] {
  const energyShares = normalizedShares(mealSlots, ENERGY_WEIGHT_BY_MEAL_CATEGORY);
  const proteinShares = normalizedShares(mealSlots, PROTEIN_WEIGHT_BY_MEAL_CATEGORY);

  return mealSlots.map((slot, index) => {
    const kcalTarget = daily.kcal * energyShares[index];
    const proteinTarget = daily.proteinG * proteinShares[index];
    const fatTarget = daily.fatG * energyShares[index];
    const proteinKcal = proteinTarget * PROTEIN_KCAL_PER_GRAM;
    const fatKcal = fatTarget * FAT_KCAL_PER_GRAM;
    const carbsKcal = kcalTarget - proteinKcal - fatKcal;
    if (carbsKcal < 0) {
      throw new NutritionEngineError(
        'MACRO_ALLOCATION_INFEASIBLE',
        `Meal "${slot}": protein (${proteinKcal.toFixed(0)} kcal) + fat (${fatKcal.toFixed(0)} kcal) alone exceed its kcal target (${kcalTarget.toFixed(0)}); cannot allocate a non-negative carbohydrate amount.`,
      );
    }
    const carbsTarget = carbsKcal / CARBOHYDRATE_KCAL_PER_GRAM;

    return {
      slot,
      kcal: rangeFor(kcalTarget, TOLERANCE_PERCENT.calories),
      proteinG: rangeFor(proteinTarget, TOLERANCE_PERCENT.protein),
      carbsG: rangeFor(carbsTarget, TOLERANCE_PERCENT.carbohydrates),
      fatG: rangeFor(fatTarget, TOLERANCE_PERCENT.fat),
      fiberG: rangeFor(daily.fiberG * energyShares[index], TOLERANCE_PERCENT.fiber),
    };
  });
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
