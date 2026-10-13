import type {
  MealNutritionTarget, NutritionGoal, NutritionMealSlot, NutritionProfile,
} from '../shared/types/nutrition';
import { NutritionAiProviderError, type AiResult, type NutritionAiProvider } from '../ai/provider';
import { MAX_AI_ATTEMPTS } from '../ai/config';
import { PlanValidationError, validateAndBuildMealAlternative, type ValidatedMealAlternative } from './domain';
import { classifyAttemptError, GenerationAttemptsExhausted, type AttemptAudit, type AttemptCode } from './attempts';
import type { NutritionPromptFoodNames } from './foodNames';

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
): Promise<{ validated: ValidatedMealAlternative; result: AiResult; attempt: number; fallback: boolean }> {
  if (!provider.generateMealAlternative) throw new NutritionAiProviderError('AI_PROVIDER_ERROR', false);
  let lastCode: AttemptCode = 'AI_RETRY_EXHAUSTED';
  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    const fallback = attempt === MAX_AI_ATTEMPTS
      && ['AI_SCHEMA_INVALID', 'AI_MACRO_VALIDATION_FAILED'].includes(lastCode);
    const started = Date.now();
    let result: AiResult | null = null;
    try {
      result = await provider.generateMealAlternative({ profile, target, avoidFoodNames, goal, foodNames,
        feedback: attempt > 1 ? lastCode : feedback, fallback });
    } catch (error) {
      lastCode = classifyAttemptError(error);
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started });
      if ((error instanceof PlanValidationError || error instanceof NutritionAiProviderError) && !error.retryable) break;
      continue;
    }
    let validated: ValidatedMealAlternative;
    try {
      validated = validateAndBuildMealAlternative(result.output, slot, target, profile.excludedAllergens);
    } catch (error) {
      lastCode = classifyAttemptError(error);
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started });
      if (error instanceof PlanValidationError && !error.retryable) break;
      continue;
    }
    await onAttempt({ attempt, fallback, result, code: null, latencyMs: Date.now() - started });
    return { validated, result, attempt, fallback };
  }
  throw new GenerationAttemptsExhausted(lastCode);
}
