import { REVIEW_CHECKS, type NutritionReviewRequest, type NutritionReview } from '../ai/review';
/** Explicit mocked reviewer for existing creator/domain/transaction tests.
 * Adversarial reviewer behaviors are exercised separately in independentReview.test.ts. */
export async function approveReview(request: NutritionReviewRequest) {
  return { output: { candidateDigest: request.candidateDigest, status: 'approved',
    checks: Object.fromEntries(REVIEW_CHECKS.map(k => [k, true])) as NutritionReview['checks'], issues: [], requiresRegeneration: false } as NutritionReview,
    model: 'gpt-6-luna', usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 }, latencyMs: 1 };
}

export async function rejectReview(request: NutritionReviewRequest) {
  const result = await approveReview(request);
  return { ...result, output: { ...result.output, status: 'insufficient_information' as const, requiresRegeneration: true,
    issues: [{ category: 'insufficient_information' as const, severity: 'high' as const,
      mealIndex: 0, optionIndex: 0, foodIndex: 0, reason: 'Composição desconhecida.',
      suggestedCorrection: 'Usar alimento identificado e compatível.' }] } };
}
