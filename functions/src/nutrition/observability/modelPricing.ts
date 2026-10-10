export const OPENAI_PRICING_VERSION = 'openai-standard-2026-10-08';
export const OPENAI_PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';

export interface ModelPricing {
  modelId: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  effectiveFrom: string;
  version: string;
  source: string;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-6.1-sol': {
    modelId: 'gpt-6.1-sol', inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 10, effectiveFrom: '2026-10-08', version: OPENAI_PRICING_VERSION,
    source: OPENAI_PRICING_SOURCE,
  },
  'gpt-6-luna': {
    modelId: 'gpt-6-luna', inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01,
    outputUsdPerMillion: 0.5, effectiveFrom: '2026-10-08', version: OPENAI_PRICING_VERSION,
    source: OPENAI_PRICING_SOURCE,
  },
  'gpt-6-astra': {
    modelId: 'gpt-6-astra', inputUsdPerMillion: 10, cachedInputUsdPerMillion: 1,
    outputUsdPerMillion: 50, effectiveFrom: '2026-10-08', version: OPENAI_PRICING_VERSION,
    source: OPENAI_PRICING_SOURCE,
  },
};

export function estimateOpenAiCost(input: {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
}): { estimatedCostUsd: number; pricingVersion: string } | null {
  const pricing = MODEL_PRICING[input.model];
  if (!pricing || input.inputTokens === null || input.outputTokens === null
    || input.cachedInputTokens === null) return null;
  const values = [input.inputTokens, input.outputTokens, input.cachedInputTokens];
  if (values.some((value) => !Number.isInteger(value) || value < 0)
    || input.cachedInputTokens > input.inputTokens) return null;
  const uncached = input.inputTokens - input.cachedInputTokens;
  const estimatedCostUsd = (
    uncached * pricing.inputUsdPerMillion
    + input.cachedInputTokens * pricing.cachedInputUsdPerMillion
    + input.outputTokens * pricing.outputUsdPerMillion
  ) / 1_000_000;
  return { estimatedCostUsd, pricingVersion: pricing.version };
}
