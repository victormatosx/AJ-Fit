import type { NutritionGoalCategory } from '../../types/nutrition';
import {
  CARBOHYDRATE_KCAL_PER_GRAM,
  FAT_KCAL_PER_GRAM,
  FAT_MAX_PERCENT_OF_CALORIES,
  FAT_MIN_G_PER_KG,
  FAT_TARGET_PERCENT_OF_CALORIES,
  PROTEIN_KCAL_PER_GRAM,
  PROTEIN_RANGE_BY_GOAL_CATEGORY,
} from './constants';
import { NutritionEngineError } from './errors';

export interface MacroResult {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/**
 * Protein (`macros.protein.rangesByGoal`), fat (`macros.fat.ranges`) and
 * carbohydrates (`macros.carbohydrates`) per `canonical/nutrition_rules.json`.
 */
export function calculateMacros(
  targetKcal: number,
  weightKg: number,
  goalCategory: NutritionGoalCategory,
): MacroResult {
  const proteinG = calculateProteinG(weightKg, goalCategory);
  const fatG = calculateFatG(targetKcal, weightKg);

  const proteinKcal = proteinG * PROTEIN_KCAL_PER_GRAM;
  const fatKcal = fatG * FAT_KCAL_PER_GRAM;
  const remainingKcal = targetKcal - proteinKcal - fatKcal;

  if (remainingKcal < 0) {
    throw new NutritionEngineError(
      'MACRO_ALLOCATION_INFEASIBLE',
      `Protein (${proteinKcal.toFixed(0)} kcal) + fat (${fatKcal.toFixed(0)} kcal) alone exceed targetKcal (${targetKcal.toFixed(0)}); cannot allocate a non-negative carbohydrate amount.`,
    );
  }

  const carbsG = remainingKcal / CARBOHYDRATE_KCAL_PER_GRAM;

  return { proteinG, fatG, carbsG };
}

function calculateProteinG(weightKg: number, goalCategory: NutritionGoalCategory): number {
  return PROTEIN_RANGE_BY_GOAL_CATEGORY[goalCategory].targetGPerKg * weightKg;
}

/** fat = max(g/kg floor, %-of-calories target), clamped at the %-of-calories ceiling — never reduced below the g/kg floor to "free up" calories for carbs. */
function calculateFatG(targetKcal: number, weightKg: number): number {
  const floorG = FAT_MIN_G_PER_KG * weightKg;
  const targetPercentG = (FAT_TARGET_PERCENT_OF_CALORIES * targetKcal) / FAT_KCAL_PER_GRAM;
  const maxPercentG = (FAT_MAX_PERCENT_OF_CALORIES * targetKcal) / FAT_KCAL_PER_GRAM;

  const candidateG = Math.max(floorG, targetPercentG);
  return Math.min(candidateG, Math.max(maxPercentG, floorG));
}
