import { linkAndValidateAlternative } from '../catalogLinking/pipeline';
import type { CatalogSearchSession } from '../catalogLinking/search';
import type {
  MealNutritionTarget, NutritionGoal, NutritionMealSlot, NutritionProfile,
} from '../shared/types/nutrition';
import { nutritionAiProfile, NutritionAiProviderError, type AiResult, type NutritionAiProvider } from '../ai/provider';
import { MAX_AI_ATTEMPTS } from '../ai/config';
import { PlanValidationError, validateAndBuildMealAlternative, type ValidatedMealAlternative } from './domain';
import { classifyAttemptError, GenerationAttemptsExhausted, type AttemptAudit, type AttemptCode } from './attempts';
import type { NutritionPromptFoodNames } from './foodNames';
import { validationRetryFeedback } from './diagnostics';

/**
 * Mirrors `generateValidatedPlan`'s bounded retry/fallback loop exactly
 * (same `MAX_AI_ATTEMPTS`, same fallback-only-on-selected-failures rule) but
 * scoped to one meal and calling `generateMealAlternative` — a meal
 * alternative is a single, synchronous-sized AI call, so it has no
 * job/lease machinery of its own (round brief §11).
 */
export async function generateValidatedMealAlternative(
  provider: NutritionAiProvider, profile: NutritionProfile, slot: NutritionMealSlot, target: MealNutritionTarget,
  avoidFoodNames: readonly string[], goal: NutritionGoal, foodNames: NutritionPromptFoodNames,
  feedback: string | undefined, onAttempt: (audit: AttemptAudit) => Promise<void> = async () => {},
  options: { catalogSession?: CatalogSearchSession; deadline?: number } = {},
): Promise<{ validated: ValidatedMealAlternative; result: AiResult; attempt: number; fallback: boolean }> {
  if (!provider.generateMealAlternative) throw new NutritionAiProviderError('AI_PROVIDER_ERROR', false);
  if (!options.catalogSession && profile.excludedSubstances?.length) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, 'critical_absence_requires_catalog');
  let lastCode: AttemptCode = 'AI_RETRY_EXHAUSTED';
  let retryFeedback: string | undefined;
  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    const fallback = attempt === MAX_AI_ATTEMPTS
      && ['AI_SCHEMA_INVALID', 'AI_MACRO_VALIDATION_FAILED'].includes(lastCode);
    if (options.catalogSession && options.deadline && Date.now() + 5_000 >= options.deadline) break;
    const started = Date.now();
    let result: AiResult | null = null;
    try {
      result = await provider.generateMealAlternative({ profile: nutritionAiProfile(profile), target, avoidFoodNames, goal, foodNames,
        feedback: attempt > 1 ? retryFeedback ?? lastCode : feedback, fallback,
        ...(options.catalogSession ? { catalogMode: true, timeoutMs: Math.min(90_000, (options.deadline ?? Date.now() + 95_000) - Date.now() - 5_000) } : {}) });
    } catch (error) {
      lastCode = classifyAttemptError(error);
      retryFeedback = undefined;
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started });
      if ((error instanceof PlanValidationError || error instanceof NutritionAiProviderError) && !error.retryable) break;
      continue;
    }
    let validated: ValidatedMealAlternative;
    try {
      validated = options.catalogSession ? await linkAndValidateAlternative(result.output, options.catalogSession, profile, slot, target, foodNames) : validateAndBuildMealAlternative(result.output, slot, target, profile.excludedAllergens, true, { dietaryPattern: profile.dietaryPattern, excludedFoodNames: foodNames.excluded });
    } catch (error) {
      lastCode = classifyAttemptError(error);
      const validationIssue = error instanceof PlanValidationError ? error.issue : undefined;
      const validationDiagnostics = error instanceof PlanValidationError ? error.diagnostics : undefined;
      retryFeedback = validationRetryFeedback(lastCode, validationIssue, validationDiagnostics,
        error instanceof PlanValidationError ? error.repairCandidate ?? result.output : result.output);
      if (options.catalogSession && error instanceof PlanValidationError && error.code === 'AI_CATALOG_RESOLUTION_FAILED') retryFeedback = JSON.stringify({ catalogFailure: error.message, catalogRepair: error.repairCandidate, previousPlan: result.output });
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started, validationIssue, validationDiagnostics });
      if (error instanceof PlanValidationError && !error.retryable) break;
      continue;
    }
    await onAttempt({ attempt, fallback, result, code: null, latencyMs: Date.now() - started, validationDiagnostics: validated.diagnostics });
    return { validated, result, attempt, fallback };
  }
  throw new GenerationAttemptsExhausted(lastCode);
}
