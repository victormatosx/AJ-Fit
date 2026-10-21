import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from '../../lib/firebaseAdmin';
import { logInfo, logWarn } from '../../lib/logger';
import { buildAiMetricsByOperation, buildAiMetricsByRole, type AiOperationFact } from './metrics';

export const AI_ALERT_WINDOW_MS = 60 * 60 * 1000;
export const AI_ALERT_MIN_REQUESTS = 5;
export const AI_FULL_PLAN_AVERAGE_COST_ALERT_USD = 0.25;
export const AI_MEAL_ALTERNATIVE_AVERAGE_COST_ALERT_USD = 0.05;

export function aiAlertCodes(metrics: ReturnType<typeof buildAiMetricsByOperation>): string[] {
  const codes: string[] = [];
  for (const [operation, value] of Object.entries(metrics)) {
    if (value.requests < AI_ALERT_MIN_REQUESTS) continue;
    if (value.successRate < 0.8) codes.push(`NUTRITION_AI_FAILURE_RATE_HIGH:${operation}`);
    if (value.fallbackRate > 0.25) codes.push(`NUTRITION_AI_FALLBACK_RATE_HIGH:${operation}`);
    if ((value.averageLatencyMs ?? 0) > 45_000) codes.push(`NUTRITION_AI_LATENCY_HIGH:${operation}`);
    const costThreshold = operation === 'full_plan'
      ? AI_FULL_PLAN_AVERAGE_COST_ALERT_USD : AI_MEAL_ALTERNATIVE_AVERAGE_COST_ALERT_USD;
    if ((value.averageEstimatedCostPerSuccessUsd ?? 0) > costThreshold) {
      codes.push(`NUTRITION_AI_AVERAGE_COST_HIGH:${operation}`);
    }
  }
  return codes;
}

export const monitorNutritionAiOperations = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Etc/UTC', timeoutSeconds: 120 },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - AI_ALERT_WINDOW_MS);
    const snapshot = await db.collection('nutritionAiOperations')
      .where('createdAt', '>=', since)
      .orderBy('createdAt')
      .limit(500)
      .get();
    const facts = snapshot.docs.map((document): AiOperationFact | null => {
      const data = document.data();
      if (!['full_plan', 'meal_alternative'].includes(String(data.operation))
        || !['validated', 'failed', 'created', 'pending', 'approved'].includes(String(data.resultStatus))
        || typeof data.generationId !== 'string') return null;
      const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
      return {
        generationId: data.generationId,
        operation: data.operation as AiOperationFact['operation'],
        attemptNumber: numberOrNull(data.attemptNumber) ?? numberOrNull(data.attempts) ?? 1,
        fallbackUsed: data.fallbackUsed === true,
        latencyMs: numberOrNull(data.latencyMs) ?? 0,
        inputTokens: numberOrNull(data.inputTokens),
        outputTokens: numberOrNull(data.outputTokens),
        estimatedCostUsd: numberOrNull(data.estimatedCostUsd),
        ...(data.agentRole === 'creator' || data.agentRole === 'reviewer' ? { agentRole: data.agentRole } : {}),
        resultStatus: data.resultStatus as AiOperationFact['resultStatus'],
        failureCode: typeof data.failureCode === 'string' ? data.failureCode : null,
      };
    }).filter((fact): fact is AiOperationFact => fact !== null);
    const metrics = buildAiMetricsByOperation(facts);
    const byRole = buildAiMetricsByRole(facts);
    logInfo('nutrition.aiObservability', 'window_metrics', {
      windowMinutes: 60, creatorCalls: byRole.creator.attempts, reviewerCalls: byRole.reviewer.attempts,
      creatorEstimatedCostUsd: byRole.creator.totalEstimatedCostUsd, reviewerEstimatedCostUsd: byRole.reviewer.totalEstimatedCostUsd,
      fullPlanRequests: metrics.full_plan.requests,
      fullPlanSuccessRate: metrics.full_plan.successRate,
      mealAlternativeRequests: metrics.meal_alternative.requests,
      mealAlternativeSuccessRate: metrics.meal_alternative.successRate,
      sampleLimited: snapshot.size === 500,
    });
    for (const code of aiAlertCodes(metrics)) {
      // See the comment on `failureCode` in `generation/worker.ts` — a bare
      // `code` key gets blanket-redacted by the logger's secret-key sanitizer.
      logWarn('nutrition.aiObservability', 'threshold_exceeded', { alertCode: code, windowMinutes: 60 });
    }
  },
);
