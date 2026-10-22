import { recoveryEligible, recoveryReviewAllowed, type RecoveryEvent } from './adaptiveRecovery';
import type { CatalogSearchSession } from '../catalogLinking/search';
import type { NutritionEngineOutput, NutritionGoal, NutritionProfile } from '../shared/types/nutrition';
import { nutritionAiProfile, NutritionAiProviderError, type AiResult, type NutritionAiProvider } from '../ai/provider';
import { AI_REVIEW_VERSION, BASE_AI_CALLS, MAX_AI_ATTEMPTS, MAX_AI_CALLS, MAX_JOB_RESERVED_USD, AI_STAGE_LIMITS, NUTRITION_AI_MODELS } from '../ai/config';
import { estimateOpenAiCost } from '../observability/modelPricing';
import { candidateDigest, parseNutritionReview, ReviewContractError, type NutritionReviewRequest, type NutritionReview } from '../ai/review';
import { PlanValidationError, parseAiOutput, validateAndBuildPlan, type ValidatedPlan, type FailureCode, type ValidationIssue } from './domain';
import type { NutritionPromptFoodNames } from './foodNames';
import { validationRetryFeedback, type ValidationDiagnostics } from './diagnostics';
import { inspectFoodEvidence, type TrustedFoodEvidence } from './reviewEvidence';
import { TOLERANCE_PERCENT } from '../shared/nutrition/engine/constants';

export type AiAgentRole = 'creator' | 'reviewer';
export type AttemptCode = FailureCode | 'AI_TIMEOUT' | 'AI_RATE_LIMIT' | 'AI_RETRY_EXHAUSTED' | 'AI_PROVIDER_ERROR'
  | 'AI_PROVIDER_REFUSAL' | 'AI_REVIEW_PROVIDER_REFUSAL' | 'AI_REVIEW_SCHEMA_INVALID' | 'AI_REVIEW_UNAVAILABLE'
  | 'AI_REVIEW_TIMEOUT' | 'AI_REVIEW_RATE_LIMIT' | 'AI_COST_LIMIT_EXCEEDED';
export interface AttemptAudit {
  attempt: number; fallback: boolean; result: AiResult | null; code: AttemptCode | null; latencyMs: number;
  role?: AiAgentRole; callNumber?: number; reviewStatus?: NutritionReview['status']; issueCategories?: string[];
  refusalReason?: string; validationIssue?: ValidationIssue; validationDiagnostics?: ValidationDiagnostics;
}
export class GenerationAttemptsExhausted extends Error {
  readonly code = 'AI_RETRY_EXHAUSTED';
  constructor(readonly lastFailureCode: AttemptCode) { super('AI_RETRY_EXHAUSTED'); }
}
export function classifyAttemptError(error: unknown): AttemptCode {
  if (error instanceof PlanValidationError || error instanceof NutritionAiProviderError || error instanceof ReviewContractError) return error.code;
  if (error instanceof GenerationAttemptsExhausted) return error.code;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'AI_TIMEOUT';
  if (error instanceof Error && error.message === 'AI_RATE_LIMIT') return 'AI_RATE_LIMIT';
  if (error instanceof Error && error.message === 'AI_SCHEMA_INVALID') return 'AI_SCHEMA_INVALID';
  return 'AI_PROVIDER_ERROR';
}
export interface ReviewedGenerationOptions {
  startAttempt?: number; previousFailureCode?: AttemptCode; generationId?: string;
  catalogSession?: CatalogSearchSession; deadline?: number; physicalContext?: unknown; initialCallCount?: number;
  initialReservedUsd?: number; initialRecoveryHistory?: RecoveryEvent[]; initialRecoveryCreditUsed?: boolean;
  initialFeedback?: string;
  onProgress?: (history: RecoveryEvent[], feedback: string | undefined) => Promise<void>;
  onBeforeAttempt?: (attempt: number) => Promise<void>;
  onBeforeCall?: (role: AiAgentRole, attempt: number, callNumber: number) => Promise<void>;
}
export interface ReviewApproval {
  version: string; model: string; candidateDigest: string; calls: number; evidence: TrustedFoodEvidence[];
}
export interface ReviewedResult<T> { validated: T; result: AiResult; attempt: number; fallback: boolean; review: ReviewApproval }
// Worst-case Standard prices; never refund failed calls or unknown usage.
export function stageReservedUsd(role: AiAgentRole): number {
  const l = AI_STAGE_LIMITS[role];
  const cost = estimateOpenAiCost({ model: role === 'reviewer' ? NUTRITION_AI_MODELS.reviewer : NUTRITION_AI_MODELS.fullPlan,
    inputTokens: l.inputTokenUpperBound, outputTokens: l.outputTokens, cachedInputTokens: 0 });
  if (!cost) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
  return cost.estimatedCostUsd;
}
export async function runReviewedGeneration<T>(provider: NutritionAiProvider,
  create: (attempt: number, feedback: string | undefined, timeoutMs: number) => Promise<AiResult>,
  validate: (raw: unknown) => Promise<{ validated: T; candidate: unknown; evidence: TrustedFoodEvidence[] }>,
  context: Omit<NutritionReviewRequest, 'candidate' | 'candidateDigest' | 'evidence' | 'timeoutMs'>,
  onAttempt: (audit: AttemptAudit) => Promise<void>, onValidating: (attempt: number) => Promise<void>,
  options: ReviewedGenerationOptions, initialFeedback?: string,
): Promise<ReviewedResult<T>> {
  if (!provider.reviewPlan) throw new NutritionAiProviderError('AI_REVIEW_UNAVAILABLE', false);
  if (context.profile.excludedAllergens?.includes('other')) throw new PlanValidationError('AI_SAFETY_VALIDATION_FAILED', false, 'unspecified_allergen');
  let calls = options.initialCallCount ?? 0;
  if (!Number.isInteger(calls) || calls < 0 || calls > MAX_AI_CALLS) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
  let reserved = options.initialReservedUsd ?? calls * Math.max(stageReservedUsd('creator'), stageReservedUsd('reviewer'));
  if (!Number.isFinite(reserved) || reserved < 0 || reserved > MAX_JOB_RESERVED_USD) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
  let history = options.initialRecoveryHistory ?? [];
  let creditUsed = options.initialRecoveryCreditUsed === true;
  const creatorAllowed = () => calls + 2 <= BASE_AI_CALLS || calls === 3 && !creditUsed && recoveryEligible(history);
  const reviewerAllowed = () => calls < BASE_AI_CALLS || calls === 4 && creditUsed && recoveryReviewAllowed(history);
  async function auditProgress(audit: AttemptAudit) {
    await onAttempt(audit);
    history = [...history, { callNumber: audit.callNumber!, attempt: audit.attempt, role: audit.role!,
      code: audit.code, reviewStatus: audit.reviewStatus ?? null }];
    await options.onProgress?.(history, feedback);
  }
  let lastCode: AttemptCode = options.previousFailureCode ?? 'AI_RETRY_EXHAUSTED';
  let feedback = options.initialFeedback ?? initialFeedback;
  const startAttempt = options.startAttempt ?? 1;
  if (!Number.isInteger(startAttempt) || startAttempt < 1 || startAttempt > MAX_AI_ATTEMPTS + 1) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
  const remainingMs = () => (options.deadline ?? Date.now() + 430_000) - Date.now() - 5_000;
  async function reserve(role: AiAgentRole, attempt: number) {
    const requiredUsd = stageReservedUsd(role) + (role === 'creator' ? stageReservedUsd('reviewer') : 0);
    if (role === 'creator' && (calls === 3 && attempt !== 3 || !creatorAllowed()) || role === 'reviewer' && !reviewerAllowed()
      || calls >= MAX_AI_CALLS || reserved + requiredUsd > MAX_JOB_RESERVED_USD || remainingMs() <= 0) throw new GenerationAttemptsExhausted(lastCode);
    if (role === 'creator') await options.onBeforeAttempt?.(attempt);
    await options.onBeforeCall?.(role, attempt, calls + 1);
    if (role === 'creator' && calls === 3) creditUsed = true;
    calls++; reserved += stageReservedUsd(role);
  }
  for (let attempt = startAttempt; attempt <= MAX_AI_ATTEMPTS && creatorAllowed(); attempt++) {
    if (remainingMs() <= 0) break;
    await reserve('creator', attempt);
    const started = Date.now();
    let result: AiResult | null = null;
    let built: Awaited<ReturnType<typeof validate>>;
    try {
      const available = remainingMs();
      // Preserve the original 90s creator ceiling while leaving room for review,
      // especially inside the existing 120s alternative callable.
      const reviewAllowance = Math.min(AI_STAGE_LIMITS.reviewer.timeoutMs, available / 2);
      result = await create(attempt, feedback, Math.min(AI_STAGE_LIMITS.creator.timeoutMs, available - reviewAllowance));
      await onValidating(attempt);
      built = await validate(result.output);
    } catch (error) {
      // Firestore/state failures are not creator compliance failures. Do not
      // spend another paid call to compensate for a failed state transition.
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
        || error instanceof Error && error.message === 'NUTRITION_LEASE_LOST') throw error;
      lastCode = classifyAttemptError(error);
      if (error instanceof PlanValidationError) {
        const prior = validationRetryFeedback(lastCode, error.issue, error.diagnostics, error.repairCandidate ?? result?.output);
        let structured: Record<string, unknown>;
        try { structured = JSON.parse(prior); }
        catch { structured = { failureCode: lastCode, previousPlan: error.repairCandidate ?? result?.output }; }
        feedback = JSON.stringify({ ...structured, constraintReason: error.message,
          ...(error.foodFailure ? { foodFailure: error.foodFailure } : {}) });
      } else feedback = lastCode;
      await auditProgress({ attempt, fallback: false, role: 'creator', callNumber: calls,
        result: result ?? (error instanceof NutritionAiProviderError ? error.result ?? null : null),
        code: lastCode, latencyMs: Date.now() - started,
        refusalReason: error instanceof NutritionAiProviderError ? error.refusalReason : undefined,
        validationIssue: error instanceof PlanValidationError ? error.issue : undefined,
        validationDiagnostics: error instanceof PlanValidationError ? error.diagnostics : undefined });
      if (error instanceof NutritionAiProviderError && !error.retryable || error instanceof PlanValidationError && !error.retryable) throw error;
      continue;
    }
    await auditProgress({ attempt, fallback: false, role: 'creator', callNumber: calls, result, code: null, latencyMs: Date.now() - started });
    const digest = candidateDigest(built.candidate);
    while (reviewerAllowed() && remainingMs() > 0) {
      await reserve('reviewer', attempt);
      await onValidating(attempt);
      const reviewStarted = Date.now();
      let reviewResult: AiResult | null = null;
      let review: NutritionReview;
      try {
        reviewResult = await provider.reviewPlan({ ...context, candidate: built.candidate, candidateDigest: digest,
          evidence: built.evidence, timeoutMs: Math.min(AI_STAGE_LIMITS.reviewer.timeoutMs, remainingMs()) });
        review = parseNutritionReview(reviewResult.output, digest);
      } catch (error) {
        lastCode = error instanceof ReviewContractError || error instanceof NutritionAiProviderError ? error.code
          : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'AI_REVIEW_TIMEOUT' : 'AI_REVIEW_UNAVAILABLE';
        await auditProgress({ attempt, fallback: false, role: 'reviewer', callNumber: calls,
          result: reviewResult ?? (error instanceof NutritionAiProviderError ? error.result ?? null : null),
          code: lastCode, latencyMs: Date.now() - reviewStarted });
        if (error instanceof NutritionAiProviderError && !error.retryable) throw error;
        continue; // Retry only the failed review, not the valid creator output.
      }
      lastCode = review.status === 'insufficient_information' ? 'AI_REVIEW_INSUFFICIENT_INFORMATION' : 'AI_REVIEW_REJECTED';
      if (review.status !== 'approved') feedback = JSON.stringify({ reviewer: review, previousPlan: built.candidate,
        instruction: 'Correct the rejected candidate; preserve restrictions and targets. Never invent evidence.' });
      await auditProgress({ attempt, fallback: false, role: 'reviewer', callNumber: calls, result: reviewResult,
        code: review.status === 'approved' ? null : lastCode, latencyMs: Date.now() - reviewStarted,
        reviewStatus: review.status, issueCategories: review.issues.map(i => i.category) });
      if (review.status === 'approved') return { validated: built.validated, result, attempt, fallback: false,
        review: { version: AI_REVIEW_VERSION, model: reviewResult!.model, candidateDigest: digest, calls, evidence: built.evidence } };
      break; // A real rejection needs a corrected candidate, never another vote.
    }
  }
  throw new GenerationAttemptsExhausted(lastCode);
}

export async function generateValidatedPlan(
  provider: NutritionAiProvider, profile: NutritionProfile, engine: NutritionEngineOutput, goal: NutritionGoal,
  foodNames: NutritionPromptFoodNames, onAttempt: (audit: AttemptAudit) => Promise<void> = async () => {},
  onValidating: (attempt: number) => Promise<void> = async () => {}, options: ReviewedGenerationOptions = {},
): Promise<ReviewedResult<ValidatedPlan>> {
  return runReviewedGeneration(provider, (attempt, feedback, timeoutMs) => provider.generatePlan({
    profile: nutritionAiProfile(profile), engine, goal, foodNames, feedback, fallback: false, timeoutMs,
    physicalContext: options.physicalContext,
    ...(options.generationId ? { trace: { generationId: options.generationId, attempt } } : {}),
  }), async raw => {
    const parsed = parseAiOutput(raw);
    const evidence = await inspectFoodEvidence(parsed.meals.flatMap(m => m.foods), profile, foodNames, options.catalogSession);
    const validated = validateAndBuildPlan(raw, profile.mealSlots, engine, profile.excludedAllergens, true,
      { dietaryPattern: profile.dietaryPattern, excludedFoodNames: foodNames.excluded });
    const candidate = { meals: validated.meals.map((m, i) => ({ slot: m.slot,
      foods: m.options[0].foods.map((f, j) => ({ ...f, ingredients: parsed.meals[i].foods[j].ingredients })) })) };
    return { validated, candidate, evidence };
  }, { profile: nutritionAiProfile(profile), targets: { engine, dailyToleranceFraction: TOLERANCE_PERCENT }, goal, foodNames, physicalContext: options.physicalContext },
  onAttempt, onValidating, options);
}
