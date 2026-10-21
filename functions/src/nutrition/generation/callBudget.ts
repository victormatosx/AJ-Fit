import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { MAX_AI_CALLS, MAX_JOB_RESERVED_USD } from '../ai/config';
import { NutritionAiProviderError } from '../ai/provider';
import { HttpsError } from 'firebase-functions/v2/https';
import { stageReservedUsd, type AiAgentRole } from './attempts';

export class NutritionLeaseLost extends Error { constructor() { super('NUTRITION_LEASE_LOST'); } }
export const operationId = (generationId: string, role: AiAgentRole, callNumber: number) => `${generationId}-${role}-${callNumber}`;
/** Counter, reservation and pending operation are committed BEFORE the HTTP call.
 * A crash can waste a reservation, never refund or repeat a potentially paid call. */
export async function reserveAiCall(db: Firestore, ref: DocumentReference, uid: string, leaseOwner: string,
  generationId: string, operation: 'full_plan' | 'meal_alternative', role: AiAgentRole, attempt: number, callNumber: number) {
  await db.runTransaction(async tx => {
    const [budget, lock] = await Promise.all([tx.get(ref), tx.get(db.collection('accountDeletionLocks').doc(uid))]);
    if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
    if (budget.get('leaseOwner') !== leaseOwner || !['running', 'validating'].includes(budget.get('status'))) throw new NutritionLeaseLost();
    const used = budget.get('aiCallCount') ?? 0;
    const reserved = budget.get('aiReservedUsd') ?? 0;
    if (!Number.isInteger(used) || used < 0 || callNumber !== used + 1 || callNumber > MAX_AI_CALLS
      || typeof reserved !== 'number' || !Number.isFinite(reserved) || reserved < 0
      || reserved + stageReservedUsd(role) > MAX_JOB_RESERVED_USD) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
    tx.update(ref, { aiCallCount: callNumber, aiReservedUsd: reserved + stageReservedUsd(role),
      ...(role === 'creator' ? { aiAttemptCount: attempt } : {}), updatedAt: Timestamp.now() });
    tx.create(db.collection('nutritionAiOperations').doc(operationId(generationId, role, callNumber)), {
      ownerUid: uid, generationId, operation, agentRole: role, callNumber, attemptNumber: attempt,
      resultStatus: 'pending', reservedCostUsd: stageReservedUsd(role), createdAt: Timestamp.now(),
    });
  });
}
