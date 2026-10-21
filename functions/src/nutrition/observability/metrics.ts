export interface AiOperationFact {
  generationId: string;
  operation: 'full_plan' | 'meal_alternative';
  attemptNumber: number;
  fallbackUsed: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  agentRole?: 'creator' | 'reviewer';
  resultStatus: 'validated' | 'failed' | 'created' | 'pending' | 'approved';
  failureCode: string | null;
}

export interface AiOperationMetrics {
  requests: number;
  attempts: number;
  successRate: number;
  retryRate: number;
  fallbackRate: number;
  averageLatencyMs: number | null;
  averageInputTokens: number | null;
  averageOutputTokens: number | null;
  totalEstimatedCostUsd: number | null;
  averageEstimatedCostPerSuccessUsd: number | null;
  failuresByCode: Record<string, number>;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function buildAiOperationMetrics(facts: readonly AiOperationFact[]): AiOperationMetrics {
  const byRequest = new Map<string, AiOperationFact[]>();
  for (const fact of facts) {
    const key = `${fact.operation}:${fact.generationId}`;
    byRequest.set(key, [...(byRequest.get(key) ?? []), fact]);
  }
  const requests = [...byRequest.values()];
  const successful = requests.filter((items) => items.some((item) => item.resultStatus === 'validated'));
  const retried = requests.filter(items => items.some(item => item.attemptNumber > 1)
    || items.filter(item => item.agentRole === 'reviewer').length > 1);
  const fallback = requests.filter((items) => items.some((item) => item.fallbackUsed));
  const failuresByCode: Record<string, number> = {};
  for (const fact of facts) {
    if (fact.failureCode) failuresByCode[fact.failureCode] = (failuresByCode[fact.failureCode] ?? 0) + 1;
  }
  const knownCosts = facts.map((item) => item.estimatedCostUsd)
    .filter((value): value is number => typeof value === 'number');
  const successfulCosts = successful.map((items) => {
    const values = items.map((item) => item.estimatedCostUsd);
    return values.every((value): value is number => typeof value === 'number')
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  }).filter((value): value is number => value !== null);
  return {
    requests: requests.length,
    attempts: facts.length,
    successRate: requests.length ? successful.length / requests.length : 0,
    retryRate: requests.length ? retried.length / requests.length : 0,
    fallbackRate: requests.length ? fallback.length / requests.length : 0,
    averageLatencyMs: average(facts.map((item) => item.latencyMs)),
    averageInputTokens: average(facts.map((item) => item.inputTokens)
      .filter((value): value is number => value !== null)),
    averageOutputTokens: average(facts.map((item) => item.outputTokens)
      .filter((value): value is number => value !== null)),
    totalEstimatedCostUsd: knownCosts.length === facts.length
      ? knownCosts.reduce((sum, value) => sum + value, 0)
      : null,
    averageEstimatedCostPerSuccessUsd: successfulCosts.length === successful.length
      ? average(successfulCosts)
      : null,
    failuresByCode,
  };
}

export function buildAiMetricsByOperation(facts: readonly AiOperationFact[]) {
  return {
    full_plan: buildAiOperationMetrics(facts.filter((item) => item.operation === 'full_plan')),
    meal_alternative: buildAiOperationMetrics(facts.filter((item) => item.operation === 'meal_alternative')),
  };
}

export function buildAiMetricsByRole(facts: readonly AiOperationFact[]) {
  return { creator: buildAiOperationMetrics(facts.filter(f => f.agentRole === 'creator')),
    reviewer: buildAiOperationMetrics(facts.filter(f => f.agentRole === 'reviewer')) };
}
