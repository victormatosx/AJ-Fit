import type { NutritionEngineOutput, NutritionGoal, NutritionProfile } from '../shared/types/nutrition';
import { nutritionAiProfile, NutritionAiProviderError, type AiResult, type NutritionAiProvider } from '../ai/provider';
import { MAX_AI_ATTEMPTS } from '../ai/config';
import { PlanValidationError, validateAndBuildPlan, type ValidatedPlan, type FailureCode, type ValidationIssue } from './domain';
import type { NutritionPromptFoodNames } from './foodNames';
import { validationRetryFeedback, type ValidationDiagnostics } from './diagnostics';

export type AttemptCode = FailureCode | 'AI_TIMEOUT' | 'AI_RATE_LIMIT' | 'AI_RETRY_EXHAUSTED' | 'AI_PROVIDER_ERROR';
export interface AttemptAudit {
  attempt: number; fallback: boolean; result: AiResult | null; code: AttemptCode | null; latencyMs: number;
  /** Only ever set for AI_SAFETY_VALIDATION_FAILED — see NutritionAiProviderError.refusalReason. */
  refusalReason?: string;
  validationIssue?: ValidationIssue;
  validationDiagnostics?: ValidationDiagnostics;
}
export class GenerationAttemptsExhausted extends Error {
  constructor(readonly code: AttemptCode) { super(code); }
}
export function classifyAttemptError(error: unknown): AttemptCode {
  if (error instanceof PlanValidationError) return error.code;
  if (error instanceof NutritionAiProviderError) return error.code;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'AI_TIMEOUT';
  if (error instanceof Error && error.message === 'AI_RATE_LIMIT') return 'AI_RATE_LIMIT';
  if (error instanceof Error && error.message === 'AI_SCHEMA_INVALID') return 'AI_SCHEMA_INVALID';
  return 'AI_RETRY_EXHAUSTED';
}

export async function generateValidatedPlan(
  provider: NutritionAiProvider, profile: NutritionProfile, engine: NutritionEngineOutput,
  goal: NutritionGoal, foodNames: NutritionPromptFoodNames,
  onAttempt: (audit: AttemptAudit) => Promise<void> = async () => {},
  onValidating: (attempt: number) => Promise<void> = async () => {},
  options: { startAttempt?: number; previousFailureCode?: AttemptCode; generationId?: string;
    onBeforeAttempt?: (attempt: number) => Promise<void> } = {},
): Promise<{ validated: ValidatedPlan; result: AiResult; attempt: number; fallback: boolean }> {
  let lastCode: AttemptCode = options.previousFailureCode ?? 'AI_RETRY_EXHAUSTED';
  let feedback: string | undefined;
  for (let attempt = options.startAttempt ?? 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    const fallback = attempt === MAX_AI_ATTEMPTS
      && ['AI_SCHEMA_INVALID', 'AI_MACRO_VALIDATION_FAILED'].includes(lastCode);
    const started = Date.now();
    let result: AiResult | null = null;
    await options.onBeforeAttempt?.(attempt);
    try {
      result = await provider.generatePlan({ profile: nutritionAiProfile(profile), engine, goal, foodNames,
        ...(options.generationId ? { trace: { generationId: options.generationId, attempt } } : {}),
        feedback: attempt > 1 ? feedback ?? lastCode : undefined, fallback });
    } catch (error) {
      lastCode = classifyAttemptError(error);
      feedback = undefined;
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started,
        refusalReason: error instanceof NutritionAiProviderError ? error.refusalReason : undefined });
      if ((error instanceof PlanValidationError || error instanceof NutritionAiProviderError) && !error.retryable) break;
      continue;
    }
    await onValidating(attempt);
    let validated: ValidatedPlan;
    try {
      validated = validateAndBuildPlan(result.output, profile.mealSlots, engine, profile.excludedAllergens, true, { dietaryPattern: profile.dietaryPattern, excludedFoodNames: foodNames.excluded });
    } catch (error) {
      lastCode = classifyAttemptError(error);
      const validationIssue = error instanceof PlanValidationError ? error.issue : undefined;
      const validationDiagnostics = error instanceof PlanValidationError ? error.diagnostics : undefined;
      // Repair the actual rejected candidate instead of asking for a fresh
      // plan with a context-free error code. This stays in memory and goes
      // only to the provider; it must never enter logs or job documents.
      feedback = validationRetryFeedback(lastCode, validationIssue, validationDiagnostics,
        error instanceof PlanValidationError ? error.repairCandidate ?? result.output : result.output);
      await onAttempt({ attempt, fallback, result, code: lastCode, latencyMs: Date.now() - started, validationIssue, validationDiagnostics });
      if (error instanceof PlanValidationError && !error.retryable) break;
      continue;
    }
    await onAttempt({ attempt, fallback, result, code: null, latencyMs: Date.now() - started, validationDiagnostics: validated.diagnostics });
    return { validated, result, attempt, fallback };
  }
  throw new GenerationAttemptsExhausted(lastCode);
}
