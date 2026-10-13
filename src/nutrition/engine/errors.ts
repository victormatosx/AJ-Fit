/**
 * Domain errors for the Nutrition Engine. The engine never returns a
 * silent default or a partial/zeroed-out "success" when it cannot produce
 * a safe, well-defined result — it throws one of these instead.
 */

export const NUTRITION_ENGINE_ERROR_CODES = [
  'INVALID_WEIGHT',
  'INVALID_HEIGHT',
  'INVALID_AGE',
  'INVALID_TRAINING_FREQUENCY',
  'INVALID_MEAL_SLOT_COUNT',
  'INVALID_MEAL_SLOT_VALUE',
  'GOAL_UNRESOLVED',
  'PROGRESSION_PACE_REQUIRED',
  'INELIGIBLE_PREGNANCY',
  'INELIGIBLE_BREASTFEEDING',
  'MACRO_ALLOCATION_INFEASIBLE',
] as const;

export type NutritionEngineErrorCode = (typeof NUTRITION_ENGINE_ERROR_CODES)[number];

export class NutritionEngineError extends Error {
  readonly code: NutritionEngineErrorCode;

  constructor(code: NutritionEngineErrorCode, message: string) {
    super(message);
    this.name = 'NutritionEngineError';
    this.code = code;
  }
}
