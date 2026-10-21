import type { NutritionGenerationErrorCode, NutritionGenerationStatus } from '../../types/nutrition';

/**
 * Pure UX projection of a generation job's live state (`08_frontend/
 * states_and_loading.md` §4, `error_states.md` §1) — no backend concept
 * (provider, model, attempt count, JSON) ever leaks into these keys.
 */
export type GenerationStageKey = 'queued' | 'running' | 'validating' | 'completing';

export function generationStageKey(status: NutritionGenerationStatus): GenerationStageKey {
  if (status === 'completed') return 'completing';
  if (status === 'validating') return 'validating';
  if (status === 'running') return 'running';
  return 'queued';
}

/** `09_safety/nutrition_safety_rules.md` / `error_states.md` §3 — never offer a retry CTA for these. */
const NON_RETRYABLE_ERROR_CODES: readonly NutritionGenerationErrorCode[] = [
  'AI_SAFETY_VALIDATION_FAILED', 'AI_DETERMINISTIC_SAFETY_BLOCKED', 'FEATURE_DISABLED', 'ACCOUNT_INACTIVE',
];

export type GenerationFailureCopyKey =
  | 'disabled' | 'safetyBlocked' | 'accountInactive' | 'catalogUnavailable' | 'genericError'
  | 'reviewNotApproved' | 'reviewUnavailable' | 'attemptsExhausted';

/** Unknown codes from a newer backend remain generic and retryable.
 * No provider/reviewer refusal is interpreted as a clinical diagnosis.
 * Permanent safety blocks (unspecified allergy or revoked evidence) remain separate. */
export function generationFailureCopyKey(code: NutritionGenerationErrorCode | null | undefined): GenerationFailureCopyKey {
  if (code === 'AI_EVIDENCE_INSUFFICIENT' || code === 'AI_REVIEW_REJECTED' || code === 'AI_REVIEW_INSUFFICIENT_INFORMATION') return 'reviewNotApproved';
  if (code?.startsWith('AI_REVIEW_')) return 'reviewUnavailable';
  if (code === 'AI_RETRY_EXHAUSTED' || code === 'AI_COST_LIMIT_EXCEEDED') return 'attemptsExhausted';
  if (code === 'AI_CATALOG_RESOLUTION_FAILED') return 'catalogUnavailable';
  if (code === 'FEATURE_DISABLED') return 'disabled';
  if (code === 'AI_SAFETY_VALIDATION_FAILED' || code === 'AI_DETERMINISTIC_SAFETY_BLOCKED') return 'safetyBlocked';
  if (code === 'ACCOUNT_INACTIVE') return 'accountInactive';
  return 'genericError';
}

export function isGenerationRetryable(code: NutritionGenerationErrorCode | null | undefined): boolean {
  if (!code) return true;
  return !NON_RETRYABLE_ERROR_CODES.includes(code);
}

export type GenerationRequestErrorKey =
  'disabled' | 'cooldown' | 'accountInactive' | 'missingPhysicalContext' | 'genericError';

/**
 * Maps `requestNutritionPlanGeneration`'s `HttpsError.message` (thrown
 * before any job exists) to one of the same small, user-safe copy buckets
 * — distinct from `generationFailureCopyKey`, which maps a terminal job's
 * `errorCode` instead. Never surfaces the raw message.
 *
 * `INVALID_PHYSICAL_CONTEXT` used to fall into the generic bucket, which
 * tells the user to "try again in a moment" — misleading for the most
 * common real cause (a brand-new account with no `assessments` entry yet:
 * weight is read ONLY from the latest assessment, never from the
 * onboarding questionnaire, `07_backend/firestore_schema.md` §Peso) since
 * retrying alone can never succeed; the user needs to log a weigh-in
 * first. Same bucket for age/height/goal gaps — all require fixing data
 * outside this flow, not a retry.
 */
export function mapGenerationRequestError(error: unknown): GenerationRequestErrorKey {
  const message = error instanceof Error ? error.message : '';
  if (message === 'NUTRITION_GENERATION_DISABLED') return 'disabled';
  if (message === 'NUTRITION_GENERATION_COOLDOWN') return 'cooldown';
  if (message === 'ACCOUNT_INACTIVE') return 'accountInactive';
  if (message === 'INVALID_PHYSICAL_CONTEXT') return 'missingPhysicalContext';
  return 'genericError';
}

export function isGenerationRequestErrorRetryable(key: GenerationRequestErrorKey): boolean {
  return key !== 'disabled' && key !== 'accountInactive' && key !== 'missingPhysicalContext';
}
