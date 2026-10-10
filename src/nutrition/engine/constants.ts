/**
 * Closed numeric constants for the Nutrition Engine — mirrors
 * `docs/nutrition/canonical/nutrition_rules.json` exactly (verified by
 * `__tests__/constants.test.ts` reading that file at test time). Every
 * value here has a citation in that JSON file; this module does not repeat
 * the citations, only the numbers themselves, to avoid two sources of truth
 * for the same prose.
 *
 * Nothing still marked `PENDING_PROFESSIONAL_VALIDATION` in canonical is
 * represented here — see the implementation report for what, if anything,
 * remains open.
 */

import type {
  DietaryPattern,
  NonTrainingActivityLevel,
  NutritionGoalCategory,
  NutritionMealSlot,
  Sex,
} from '../../types/nutrition';

// ---------------------------------------------------------------------------
// Versions — `canonical/nutrition_rules.json` only defines one top-level
// `engine.version` ("1.0.0") today; V1 has no independent versioning for
// energy/macro/meal-distribution sub-rules yet, so all three share that same
// value until the canonical file introduces separate ones.
// ---------------------------------------------------------------------------

export const NUTRITION_ENGINE_VERSION = '1.0.0';
export const ENERGY_RULES_VERSION = '1.0.0';
export const MACRO_RULES_VERSION = '1.0.0';
export const MEAL_DISTRIBUTION_VERSION = '1.0.0';

/**
 * Explicit placeholder, not a random string: the Nutrition Engine (this
 * module) never reads the Food Catalog — it produces macro/meal TARGETS
 * only, with no food selection. There is no real catalog version to report
 * yet because the catalog itself is not implemented (out of scope for this
 * pass, per `04_food_catalog/`). Whoever wires the catalog in must replace
 * this constant, not leave it silently stale.
 */
export const FOOD_CATALOG_VERSION_NOT_INTEGRATED = 'not_integrated_v1';

// ---------------------------------------------------------------------------
// RMR — Mifflin-St Jeor (`canonical/nutrition_rules.json` `energy.restingEnergyFormula`)
// ---------------------------------------------------------------------------

export const MIFFLIN_ST_JEOR = {
  weightCoefficient: 10,
  heightCoefficient: 6.25,
  ageCoefficient: 5,
  sexConstant: { m: 5, f: -161 } as Record<Sex, number>,
};

// ---------------------------------------------------------------------------
// TDEE — split non-training-activity factor + additive training contribution
// (`canonical/nutrition_rules.json` `energy.tdeeStrategy`)
// ---------------------------------------------------------------------------

export const NON_TRAINING_ACTIVITY_FACTOR: Record<NonTrainingActivityLevel, number> = {
  sedentary: 1.2,
  low_active: 1.3,
  active: 1.4,
  very_active: 1.5,
};

export const TRAINING_SESSION_MET = 5.0;
export const TRAINING_SESSION_MINUTES = 50;

/** kcal/min = METs * 3.5 * weightKg / 200 (ACSM metabolic equation) */
export function trainingSessionKcal(weightKg: number): number {
  return TRAINING_SESSION_MET * 3.5 * weightKg / 200 * TRAINING_SESSION_MINUTES;
}

// ---------------------------------------------------------------------------
// Goal adjustment — deficit/surplus % of TDEE by pace
// (`canonical/nutrition_rules.json` `goals.deficitPercentages`/`surplusPercentages`)
// ---------------------------------------------------------------------------

export const DEFICIT_PERCENTAGE_BY_PACE = {
  gradual: 0.10,
  moderate: 0.15,
  accelerated: 0.20,
} as const;

export const SURPLUS_PERCENTAGE_BY_PACE = {
  gradual: 0.05,
  moderate: 0.10,
  accelerated: 0.15,
} as const;

/** Fixed, pace-independent — see `goals_and_adjustments.md` §2.1 for why `body_recomposition` does not scale with pace. */
export const BODY_RECOMPOSITION_DEFICIT_PERCENTAGE = 0.10;

// ---------------------------------------------------------------------------
// Safety — calorie floor (`canonical/nutrition_rules.json` `safety.minimumCaloriesBySex`)
// ---------------------------------------------------------------------------

export const MINIMUM_CALORIES_BY_SEX: Record<Sex, number> = {
  m: 1500,
  f: 1200,
};

// ---------------------------------------------------------------------------
// Protein — g/kg ranges by NutritionGoalCategory
// (`canonical/nutrition_rules.json` `macros.protein.rangesByGoal`)
// ---------------------------------------------------------------------------

export interface GPerKgRange {
  minGPerKg: number;
  targetGPerKg: number;
  maxGPerKg: number;
}

export const PROTEIN_RANGE_BY_GOAL_CATEGORY: Record<NutritionGoalCategory, GPerKgRange> = {
  weight_loss: { minGPerKg: 1.8, targetGPerKg: 2.0, maxGPerKg: 2.4 },
  muscle_gain: { minGPerKg: 1.6, targetGPerKg: 1.8, maxGPerKg: 2.2 },
  maintenance: { minGPerKg: 1.2, targetGPerKg: 1.6, maxGPerKg: 2.0 },
  body_recomposition: { minGPerKg: 1.8, targetGPerKg: 2.0, maxGPerKg: 2.4 },
};

// ---------------------------------------------------------------------------
// Fat — g/kg floor + %-of-calories target/max
// (`canonical/nutrition_rules.json` `macros.fat.ranges`)
// ---------------------------------------------------------------------------

export const FAT_MIN_G_PER_KG = 0.8;
export const FAT_TARGET_PERCENT_OF_CALORIES = 0.25;
export const FAT_MAX_PERCENT_OF_CALORIES = 0.35;

// ---------------------------------------------------------------------------
// Fiber — g / 1000 kcal (`canonical/nutrition_rules.json` `macros.fiber.target`)
// ---------------------------------------------------------------------------

export const FIBER_G_PER_1000_KCAL = 14;

// ---------------------------------------------------------------------------
// Calorie conversions (`canonical/nutrition_rules.json` `macros.calorieConversions`)
// ---------------------------------------------------------------------------

export const PROTEIN_KCAL_PER_GRAM = 4;
export const CARBOHYDRATE_KCAL_PER_GRAM = 4;
export const FAT_KCAL_PER_GRAM = 9;

// ---------------------------------------------------------------------------
// Tolerances (`canonical/nutrition_rules.json` `tolerances`)
// ---------------------------------------------------------------------------

export const TOLERANCE_PERCENT = {
  calories: 0.05,
  protein: 0.10,
  carbohydrates: 0.10,
  fat: 0.10,
  fiber: 0.20,
} as const;

// ---------------------------------------------------------------------------
// Meal distribution weights
// (`canonical/nutrition_rules.json` `mealDistribution.distributionWeights`)
// ---------------------------------------------------------------------------

export type MealSlotCategory = 'main' | 'snack';

export const MEAL_SLOT_CATEGORY: Record<NutritionMealSlot, MealSlotCategory> = {
  breakfast: 'main',
  lunch: 'main',
  dinner: 'main',
  morning_snack: 'snack',
  afternoon_snack: 'snack',
  supper: 'snack',
};

export const ENERGY_WEIGHT_BY_MEAL_CATEGORY: Record<MealSlotCategory, number> = {
  main: 1.5,
  snack: 1.0,
};

export const PROTEIN_WEIGHT_BY_MEAL_CATEGORY: Record<MealSlotCategory, number> = {
  main: 1.2,
  snack: 1.0,
};

// ---------------------------------------------------------------------------
// Dietary pattern — not yet used by the pure engine (no food selection
// happens here), kept only so validateInput can type-check the field
// without importing the full catalog contracts.
// ---------------------------------------------------------------------------

export const DIETARY_PATTERNS_SUPPORTED: readonly DietaryPattern[] = [
  'omnivore', 'vegetarian', 'vegan', 'pescatarian',
];
