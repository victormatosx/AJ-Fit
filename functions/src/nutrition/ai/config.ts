import { defineSecret } from 'firebase-functions/params';

export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
export const NUTRITION_AI_MODELS = {
  fullPlan: 'gpt-6.1-sol',
  mealAlternative: 'gpt-6-luna',
  fallback: 'gpt-6-astra',
} as const;
// v2: diet-quality-v3 (2026-10-10) — free-form AI diet, no catalog/foodId dependency.
export const PROMPT_VERSION = 'nutrition-full-plan-v2.0.0';
export const AI_SCHEMA_VERSION = '2.0.0';
/** `NutritionPlanVersions.foodCatalogVersion` is vestigial since generation stopped reading `nutritionFoods` (diet-quality-v3) — kept only for schema stability. */
export const FOOD_CATALOG_VERSION_PLACEHOLDER = 'unused-since-diet-quality-v3';
export const MAX_AI_ATTEMPTS = 3; // initial + two retries, fallback consumes the last attempt
