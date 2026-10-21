import type { CatalogMetrics } from '../catalogLinking/search';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { PROMPT_VERSION } from '../ai/config';
import type { AiResult } from '../ai/provider';
import type { NutritionGenerationOperationType } from '../shared/types/nutrition';
import { AI_SCHEMA_VERSION } from '../ai/config';
import { estimateOpenAiCost } from '../observability/modelPricing';
import { operationId } from './callBudget';
import type { AiAgentRole } from './attempts';
import { AI_REVIEW_VERSION } from '../ai/config';

export interface RecordAiOperationParams {
  role?: AiAgentRole;
  callNumber?: number;
  reviewStatus?: string;
  issueCategories?: string[];
  catalogMetrics?: CatalogMetrics;
  ownerUid: string;
  generationId: string;
  operation: NutritionGenerationOperationType;
  defaultModel: string;
  attempt: number;
  result: AiResult | null;
  code: string | null;
  fallback: boolean;
  latencyMs: number;
}

/**
 * `06_ai/ai_observability.md` §4 — the single write path for every AI attempt
 * record, shared by the full-plan job (`worker.ts`) and a meal alternative
 * (`mealAlternativeRequest.ts`). Never stores raw prompt/response text.
 */
export async function recordAiOperation(db: Firestore, params: RecordAiOperationParams): Promise<void> {
  const { ownerUid, generationId, operation, defaultModel, attempt, result, code, fallback, latencyMs } = params;
  const ref = db.collection('nutritionAiOperations').doc(params.role && params.callNumber
    ? operationId(generationId, params.role, params.callNumber) : `${generationId}-${attempt}`);
  const model = result?.model ?? defaultModel;
  const usage = result?.usage ?? { inputTokens: null, outputTokens: null, cachedInputTokens: null };
  const cost = estimateOpenAiCost({ model, ...usage });
  await db.runTransaction(async (tx) => {
    const lock = await tx.get(db.collection('accountDeletionLocks').doc(ownerUid));
    if (lock.exists) return;
    tx.set(ref, { ownerUid, generationId, operation, provider: 'openai',
      ...(params.role ? { agentRole: params.role, callNumber: params.callNumber,
        reviewerVersion: AI_REVIEW_VERSION, reviewStatus: params.reviewStatus ?? null,
        issueCategories: params.issueCategories ?? [] } : {}),
      ...(params.catalogMetrics ? { catalogMetrics: params.catalogMetrics } : {}),
      model, promptVersion: params.role ? PROMPT_VERSION : params.catalogMetrics ? `${PROMPT_VERSION}+catalog-intent-v1` : PROMPT_VERSION, aiSchemaVersion: AI_SCHEMA_VERSION,
      attempts: attempt, attemptNumber: attempt, retryCount: attempt - 1,
      fallbackUsed: fallback, latencyMs, inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens,
      ...(cost ?? {}),
      resultStatus: code ? 'failed' : params.role === 'creator' ? 'created' : params.role === 'reviewer' ? 'approved' : 'validated',
      failureCode: code, createdAt: Timestamp.now() }, { merge: true });
  });
}
