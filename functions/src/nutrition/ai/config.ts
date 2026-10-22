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
// v4.2.0 (2026-10-22): lactose-exclusion evidence no longer dead-ends on the
// never-populated `safetyEvidence` field (see `catalogLinking/lactoseClaims.ts`);
// whey retry feedback asks for a specific zero-lactose product instead of a
// generic ban; single-item meals with mathematically conflicting deviations
// (`empty_intersection`/`optimizer_infeasible`) now ask for recomposition.
export const PROMPT_VERSION = 'nutrition-full-plan-v4.2.0';
export const AI_SCHEMA_VERSION = '3.1.0';
/** `NutritionPlanVersions.foodCatalogVersion` is vestigial since generation stopped reading `nutritionFoods` (diet-quality-v3) — kept only for schema stability. */
export const FOOD_CATALOG_VERSION_PLACEHOLDER = 'unused-since-diet-quality-v3';
export const MAX_AI_ATTEMPTS = 3; // initial + two creator retries; every role also consumes the shared call ceiling
// Four calls normally; a persisted, single-use recovery credit admits only
// creator validation failure -> corrected candidate -> negative independent review.
// The final creator/reviewer pair is admitted together (see adaptiveRecovery.ts).
export const BASE_AI_CALLS = 4;
export const MAX_AI_CALLS = 5;
export const AI_REVIEW_VERSION = 'nutrition-independent-review-v1';
export const AI_STAGE_LIMITS = {
  creator: { inputTokenUpperBound: 32_000, outputTokens: 8_000, timeoutMs: 90_000 },
  reviewer: { inputTokenUpperBound: 64_000, outputTokens: 1_500, timeoutMs: 30_000 },
} as const;
// Standard luna pricing, conservative byte-based input bound plus framing margin.
// Worst case at MAX_AI_CALLS=5 (3 creator + 2 reviewer) ~= $0.0359; $0.04 leaves margin.
export const MAX_JOB_RESERVED_USD = 0.04;
