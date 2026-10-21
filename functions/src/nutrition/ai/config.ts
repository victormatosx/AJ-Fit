import { defineSecret } from 'firebase-functions/params';

export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
/** Both independent roles use the existing economical model. The fallback
 * identifier is retained for historical compatibility only; no live request escalates. */
export const NUTRITION_AI_MODELS = {
  fullPlan: 'gpt-6-luna',
  mealAlternative: 'gpt-6-luna',
  fallback: 'gpt-6.1-sol',
  reviewer: 'gpt-6-luna',
} as const;
// v3: one recommended option per meal on initial generation, alternatives generated on-demand only (2026-10-10 cost pass).
export const PROMPT_VERSION = 'nutrition-full-plan-v4.0.0';
export const AI_SCHEMA_VERSION = '3.1.0';
/** `NutritionPlanVersions.foodCatalogVersion` is vestigial since generation stopped reading `nutritionFoods` (diet-quality-v3) — kept only for schema stability. */
export const FOOD_CATALOG_VERSION_PLACEHOLDER = 'unused-since-diet-quality-v3';
export const MAX_AI_ATTEMPTS = 3; // initial + two creator retries; every role also consumes the shared call ceiling
// Two independent calls on success; at most one fully reviewed correction.
// Creator failures may use the third creator attempt within the same four-call ceiling.
export const MAX_AI_CALLS = 4;
export const AI_REVIEW_VERSION = 'nutrition-independent-review-v1';
export const AI_STAGE_LIMITS = {
  creator: { inputTokenUpperBound: 32_000, outputTokens: 8_000, timeoutMs: 90_000 },
  reviewer: { inputTokenUpperBound: 64_000, outputTokens: 1_500, timeoutMs: 30_000 },
} as const;
// Standard luna pricing, conservative byte-based input bound plus framing margin.
export const MAX_JOB_RESERVED_USD = 0.03;
