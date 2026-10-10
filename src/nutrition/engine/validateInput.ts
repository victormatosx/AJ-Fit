import type { NutritionEngineInput } from '../../types/nutrition';
import { NUTRITION_MEAL_SLOTS } from '../../types/nutrition';
import { NutritionEngineError } from './errors';

/**
 * Plausibility guardrails only — not a clinical/legal age gate (that's
 * already enforced elsewhere in the product, per
 * `09_safety/nutrition_safety_rules.md` §3 "menores não têm acesso ao
 * app"). This just rejects obviously-corrupt input (e.g. age 0 or 400).
 */
const MIN_PLAUSIBLE_AGE_YEARS = 10;
const MAX_PLAUSIBLE_AGE_YEARS = 100;

const MIN_MEAL_SLOTS = 2;
const MAX_MEAL_SLOTS = 6;

/**
 * Structural/plausibility validation only — deliberately NOT a clinical
 * questionnaire (per task: "Não transforme validação em sistema clínico
 * complexo"). Throws the first violation found; does not try to collect
 * every error at once, since the engine is not a form-validation UI.
 */
export function validateNutritionEngineInput(input: NutritionEngineInput): void {
  const { inherited, workout, nutritionProfile } = input;

  if (!Number.isFinite(inherited.currentWeightKg) || inherited.currentWeightKg <= 0) {
    throw new NutritionEngineError('INVALID_WEIGHT', `currentWeightKg must be > 0, got ${inherited.currentWeightKg}`);
  }

  if (!Number.isFinite(inherited.heightCm) || inherited.heightCm <= 0) {
    throw new NutritionEngineError('INVALID_HEIGHT', `heightCm must be > 0, got ${inherited.heightCm}`);
  }

  if (
    !Number.isFinite(inherited.ageYears)
    || inherited.ageYears < MIN_PLAUSIBLE_AGE_YEARS
    || inherited.ageYears > MAX_PLAUSIBLE_AGE_YEARS
  ) {
    throw new NutritionEngineError(
      'INVALID_AGE',
      `ageYears must be between ${MIN_PLAUSIBLE_AGE_YEARS} and ${MAX_PLAUSIBLE_AGE_YEARS}, got ${inherited.ageYears}`,
    );
  }

  if (!Number.isFinite(workout.weeklyTrainingFrequency) || workout.weeklyTrainingFrequency < 0) {
    throw new NutritionEngineError(
      'INVALID_TRAINING_FREQUENCY',
      `weeklyTrainingFrequency must be >= 0, got ${workout.weeklyTrainingFrequency}`,
    );
  }

  const mealSlots = nutritionProfile.mealSlots;
  if (!Array.isArray(mealSlots) || mealSlots.length < MIN_MEAL_SLOTS || mealSlots.length > MAX_MEAL_SLOTS) {
    throw new NutritionEngineError(
      'INVALID_MEAL_SLOT_COUNT',
      `mealSlots must have between ${MIN_MEAL_SLOTS} and ${MAX_MEAL_SLOTS} entries, got ${mealSlots?.length}`,
    );
  }

  const uniqueSlots = new Set(mealSlots);
  if (uniqueSlots.size !== mealSlots.length || [...uniqueSlots].some((slot) => !NUTRITION_MEAL_SLOTS.includes(slot))) {
    throw new NutritionEngineError(
      'INVALID_MEAL_SLOT_VALUE',
      `mealSlots must contain unique, recognized values; got [${mealSlots.join(', ')}]`,
    );
  }
}
