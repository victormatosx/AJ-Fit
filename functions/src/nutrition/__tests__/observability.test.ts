import { describe, expect, it } from 'vitest';

import { aiAlertCodes } from '../observability/alerts';
import { buildAiMetricsByOperation, buildAiOperationMetrics, type AiOperationFact } from '../observability/metrics';
import { estimateOpenAiCost, OPENAI_PRICING_VERSION } from '../observability/modelPricing';

const fact = (overrides: Partial<AiOperationFact> = {}): AiOperationFact => ({
  generationId: 'generation-1', operation: 'full_plan', attemptNumber: 1,
  fallbackUsed: false, latencyMs: 1_000, inputTokens: 100, outputTokens: 50,
  estimatedCostUsd: 0.00069, resultStatus: 'validated', failureCode: null, ...overrides,
});

describe('nutrition AI observability', () => {
  it('calculates versioned cost from real input/output/cached usage', () => {
    expect(estimateOpenAiCost({ model: 'gpt-6.1-sol', inputTokens: 100,
      cachedInputTokens: 20, outputTokens: 50 })).toEqual({
      estimatedCostUsd: 0.000662, pricingVersion: OPENAI_PRICING_VERSION,
    });
  });

  it('keeps cost unknown for missing usage or unsupported pricing', () => {
    expect(estimateOpenAiCost({ model: 'unknown', inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 })).toBeNull();
    expect(estimateOpenAiCost({ model: 'gpt-6-luna', inputTokens: null, cachedInputTokens: null, outputTokens: null })).toBeNull();
  });

  it('derives success, retry, fallback, token, cost and failure metrics by operation', () => {
    const metrics = buildAiOperationMetrics([
      fact({ resultStatus: 'failed', failureCode: 'AI_SCHEMA_INVALID' }),
      fact({ attemptNumber: 2, fallbackUsed: true }),
      fact({ generationId: 'alt-1', operation: 'meal_alternative', inputTokens: null,
        outputTokens: null, estimatedCostUsd: null }),
    ]);
    expect(metrics.requests).toBe(2);
    expect(metrics.retryRate).toBe(0.5);
    expect(metrics.fallbackRate).toBe(0.5);
    expect(metrics.successRate).toBe(1);
    expect(metrics.totalEstimatedCostUsd).toBeNull();
    expect(metrics.failuresByCode.AI_SCHEMA_INVALID).toBe(1);
    expect(buildAiMetricsByOperation([fact(), fact({ operation: 'meal_alternative' })])
      .meal_alternative.requests).toBe(1);
  });

  it('emits stable alert codes only after the minimum sample', () => {
    const poor = Array.from({ length: 5 }, (_, index) => fact({ generationId: `g-${index}`,
      resultStatus: 'failed', failureCode: 'AI_PROVIDER_ERROR', fallbackUsed: true, latencyMs: 60_000 }));
    expect(aiAlertCodes(buildAiMetricsByOperation(poor))).toEqual([
      'NUTRITION_AI_FAILURE_RATE_HIGH:full_plan',
      'NUTRITION_AI_FALLBACK_RATE_HIGH:full_plan',
      'NUTRITION_AI_LATENCY_HIGH:full_plan',
    ]);
  });
});
