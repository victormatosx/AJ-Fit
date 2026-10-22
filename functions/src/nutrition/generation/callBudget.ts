import { isDeepStrictEqual } from 'node:util';
import { recoveryEligible, recoveryReviewAllowed, type RecoveryEvent } from './adaptiveRecovery';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { BASE_AI_CALLS, MAX_AI_ATTEMPTS, MAX_AI_CALLS, MAX_JOB_RESERVED_USD } from '../ai/config';
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
    const history: RecoveryEvent[] = budget.get('aiRecoveryHistory') ?? [];
    const creditUsed = budget.get('aiRecoveryCreditUsed') === true;
    const grant = role === 'creator' && attempt === 3 && used === 3 && !creditUsed && recoveryEligible(history);
    const finalReview = role === 'reviewer' && used === 4 && creditUsed && recoveryReviewAllowed(history);
    const requiredUsd = stageReservedUsd(role) + (role === 'creator' ? stageReservedUsd('reviewer') : 0);
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_AI_ATTEMPTS
      || role === 'creator' && (attempt !== (budget.get('aiAttemptCount') ?? 0) + 1 || used + 2 > BASE_AI_CALLS && !grant)
      || role === 'reviewer' && (attempt !== budget.get('aiAttemptCount') || used >= BASE_AI_CALLS && !finalReview)
      || !Number.isInteger(used) || used < 0 || callNumber !== used + 1 || callNumber > MAX_AI_CALLS
      || typeof reserved !== 'number' || !Number.isFinite(reserved) || reserved < 0
      || reserved + requiredUsd > MAX_JOB_RESERVED_USD) throw new NutritionAiProviderError('AI_COST_LIMIT_EXCEEDED', false);
    tx.update(ref, { aiCallCount: callNumber, aiReservedUsd: reserved + stageReservedUsd(role),
      ...(role === 'creator' ? { aiAttemptCount: attempt } : {}),
      ...(grant ? { aiRecoveryCreditUsed: true, aiRecoveryGrantedAtCall: callNumber, aiRecoveryPolicyVersion: 1 } : {}), updatedAt: Timestamp.now() });
    tx.create(db.collection('nutritionAiOperations').doc(operationId(generationId, role, callNumber)), {
      ownerUid: uid, generationId, operation, agentRole: role, callNumber, attemptNumber: attempt,
      recoveryCreditUsed: creditUsed || grant, recoveryPolicyVersion: 1,
      resultStatus: 'pending', reservedCostUsd: stageReservedUsd(role), createdAt: Timestamp.now(),
    });
  });
}

/** Checkpoint only completed, owned reservations. Missing audit after a crash
 * never confers eligibility, and replay cannot append a second event. */
export async function persistAiProgress(db: Firestore, ref: DocumentReference, leaseOwner: string,
  history: RecoveryEvent[], feedback: string | undefined): Promise<void> {
  await db.runTransaction(async tx => {
    const job = await tx.get(ref);
    if (job.get('leaseOwner') !== leaseOwner || !['running', 'validating'].includes(job.get('status'))) throw new NutritionLeaseLost();
    const last = history[history.length - 1];
    const prior: RecoveryEvent[] = job.get('aiRecoveryHistory') ?? [];
    if (!last || history.length > MAX_AI_CALLS || last.callNumber !== job.get('aiCallCount')
      || !isDeepStrictEqual(history.slice(0, -1), prior)) {
      if (isDeepStrictEqual(history, prior)) return;
      throw new NutritionLeaseLost();
    }
    tx.update(ref, { aiRecoveryHistory: history, aiRetryFeedback: feedback ?? null,
      aiRecoveryPolicyVersion: 1, updatedAt: Timestamp.now() });
  });
}
