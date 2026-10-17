/**
 * AJ Fit Nutrition Engine — pure, deterministic, no Firebase/React/IA.
 *
 * Pipeline (`docs/nutrition/03_nutrition_engine/nutrition_engine_contract.md` §2):
 * Perfil -> Nutrition Engine -> Food Catalog -> IA -> Validador -> Persistência.
 * This module implements only the "Nutrition Engine" box — no catalog, no
 * AI, no persistence.
 */

import type {
  NutritionEligibilityBlocker,
  NutritionEngineInput,
  NutritionEngineOutput,
} from '../../types/nutrition';
import {
  ENERGY_RULES_VERSION,
  FOOD_CATALOG_VERSION_NOT_INTEGRATED,
  MACRO_RULES_VERSION,
  MEAL_DISTRIBUTION_VERSION,
  NUTRITION_ENGINE_VERSION,
} from './constants';
import { calculateEnergyTarget } from './calculateEnergyTarget';
import { calculateFiberG } from './calculateFiber';
import { calculateMacros } from './calculateMacros';
import { calculateRmr } from './calculateRmr';
import { calculateTdee } from './calculateTdee';
import { distributeMeals } from './distributeMeals';
import { resolveGoalCategory } from './resolveGoalCategory';
import { validateNutritionEngineInput } from './validateInput';

export * from './constants';
export * from './errors';
export { resolveGoalCategory } from './resolveGoalCategory';
export { calculateRmr } from './calculateRmr';
export { calculateTdee } from './calculateTdee';
export { calculateEnergyTarget } from './calculateEnergyTarget';
export { calculateMacros } from './calculateMacros';
export { calculateFiberG } from './calculateFiber';
export { distributeMeals } from './distributeMeals';
export { validateNutritionEngineInput } from './validateInput';

export interface EligibilityResult {
  eligible: boolean;
  blockers: NutritionEligibilityBlocker[];
}

/** Legacy eligibility API: historical pregnancy/lactation fields no longer gate generation. */
export function resolveEligibility(_input: NutritionEngineInput): EligibilityResult {
  return { eligible: true, blockers: [] };
}

/**
 * Main entry point. Deterministic: same input + same rule versions always
 * produce the same output (no randomness, no current-time/hidden-state
 * reads, no I/O). Throws `NutritionEngineError` — never a silent default —
 * when the input is invalid, the goal cannot be resolved, or macro allocation is
 * infeasible.
 */
export function calculateNutritionTargets(input: NutritionEngineInput): NutritionEngineOutput {
  validateNutritionEngineInput(input);

  const { inherited, workout, nutritionProfile } = input;
  const goalCategory = resolveGoalCategory(inherited.goal, nutritionProfile);

  const rmrKcal = calculateRmr(inherited.sex, inherited.currentWeightKg, inherited.heightCm, inherited.ageYears);
  const tdeeKcal = calculateTdee(
    rmrKcal,
    nutritionProfile.nonTrainingActivityLevel,
    workout.weeklyTrainingFrequency,
    inherited.currentWeightKg,
  );

  const { targetKcal, safetyClampApplied } = calculateEnergyTarget(
    tdeeKcal,
    goalCategory,
    nutritionProfile.progressionPace,
    inherited.sex,
  );

  const { proteinG, fatG, carbsG } = calculateMacros(targetKcal, inherited.currentWeightKg, goalCategory);
  const fiberG = calculateFiberG(targetKcal);

  const mealTargets = distributeMeals(nutritionProfile.mealSlots, {
    kcal: targetKcal,
    proteinG,
    fatG,
    carbsG,
    fiberG,
  });

  return {
    eligible: true,
    blockers: [],
    energy: { rmrKcal, tdeeKcal, targetKcal, safetyClampApplied },
    macros: { proteinG, fatG, carbsG, fiberG },
    mealTargets,
    calculationTrace: {
      sex: inherited.sex,
      ageYears: inherited.ageYears,
      heightCm: inherited.heightCm,
      weightKg: inherited.currentWeightKg,
      nonTrainingActivityLevel: nutritionProfile.nonTrainingActivityLevel,
      weeklyTrainingFrequency: workout.weeklyTrainingFrequency,
      resolvedGoalCategory: goalCategory,
      progressionPaceUsed: nutritionProfile.progressionPace ?? null,
      rmrKcal,
      tdeeKcal,
    },
    versions: {
      nutritionEngineVersion: NUTRITION_ENGINE_VERSION,
      energyRulesVersion: ENERGY_RULES_VERSION,
      macroRulesVersion: MACRO_RULES_VERSION,
      mealDistributionVersion: MEAL_DISTRIBUTION_VERSION,
      questionnaireVersion: nutritionProfile.questionnaireVersion,
      foodCatalogVersion: FOOD_CATALOG_VERSION_NOT_INTEGRATED,
    },
  };
}
