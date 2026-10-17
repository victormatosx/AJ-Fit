import { defineSecret } from 'firebase-functions/params';

export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
/**
 * Cost pass (2026-10-10, incident: a single generation averaging ~$0.40):
 * `luna` is ~20x cheaper than `sol` per token and ~100x cheaper than `astra`
 * (see `observability/modelPricing.ts`). `luna` is now primary AND retry
 * model for both operations; `sol` is kept only as the last-attempt
 * fallback for schema/macro failures. `astra` is removed from the live
 * flow entirely — it stays in `modelPricing.ts` only so historical
 * `nutritionAiOperations` records (written before this change) can still
 * resolve a cost estimate.
 */
export const NUTRITION_AI_MODELS = {
  fullPlan: 'gpt-6-luna',
  mealAlternative: 'gpt-6-luna',
  fallback: 'gpt-6.1-sol',
} as const;
// v3: one recommended option per meal on initial generation, alternatives generated on-demand only (2026-10-10 cost pass).
export const PROMPT_VERSION = 'nutrition-full-plan-v3.3.0';
export const AI_SCHEMA_VERSION = '3.1.0';
/** `NutritionPlanVersions.foodCatalogVersion` is vestigial since generation stopped reading `nutritionFoods` (diet-quality-v3) — kept only for schema stability. */
export const FOOD_CATALOG_VERSION_PLACEHOLDER = 'unused-since-diet-quality-v3';
export const MAX_AI_ATTEMPTS = 3; // initial + two retries, fallback consumes the last attempt
