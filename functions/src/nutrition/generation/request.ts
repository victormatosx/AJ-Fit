import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { logInfo, logWarn } from '../../lib/logger';
import { requireAuth } from '../../lib/auth';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { loadGenerationContext } from './context';
import { requireNutritionGenerationRollout } from './rollout';

export const FULL_PLAN_COOLDOWN_MS = 15 * 60 * 1000;
function requestIdFrom(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'requestId')
    || (value.requestId !== undefined && (typeof value.requestId !== 'string'
      || !/^[A-Za-z0-9_.:-]{8,100}$/.test(value.requestId)))) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  }
  return typeof value.requestId === 'string' ? value.requestId : null;
}
export async function requestNutritionPlanGenerationHandler(
  request: CallableRequest, db: Firestore = defaultDb,
): Promise<{ generationId: string }> {
  const started = Date.now();
  const operationId = randomUUID();
  let stage = 'authentication';
  logInfo('nutrition.generation', 'request_started', { operationId, stage });
  try {
    const uid = requireAuth(request);
    const requestId = requestIdFrom(request.data);
    logInfo('nutrition.generation', 'request_authenticated', { operationId,
      requestId: requestId && /^[a-f0-9-]{36}$/i.test(requestId) ? requestId : null });
    stage = 'account';
    try { await requireActiveAccount(uid, db); }
    catch (error) {
      if (error instanceof HttpsError && error.code === 'failed-precondition') {
        throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
      }
      throw error;
    }
    stage = 'rollout';
    try { await requireNutritionGenerationRollout(db, uid); }
    catch (error) {
      if (error instanceof Error && error.message === 'NUTRITION_GENERATION_DISABLED') {
        throw new HttpsError('failed-precondition', 'NUTRITION_GENERATION_DISABLED');
      }
      throw error;
    }
    // All safety/context checks happen before the job is queued and again in the worker.
    stage = 'context';
    await loadGenerationContext(db, uid);
    const rateRef = db.collection('nutritionRateLimits').doc(uid);
    const user = db.collection('users').doc(uid);
    const generationId = randomUUID();
    const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
    const now = Timestamp.now();
    stage = 'queue';
    const result = await db.runTransaction(async (tx) => {
      const rate = await tx.get(rateRef);
      const activeId = rate.get('activeGenerationId');
      const existing = typeof activeId === 'string'
        ? await tx.get(user.collection('nutritionGenerationJobs').doc(activeId)) : null;
      if (existing && ['queued', 'running', 'validating'].includes(existing.get('status'))) {
        return { generationId: activeId as string };
      }
      if (requestId && rate.get('lastRequestId') === requestId && typeof rate.get('lastGenerationId') === 'string') {
        return { generationId: rate.get('lastGenerationId') as string };
      }
      const last = rate.get('lastRequestedAt');
      if (last instanceof Timestamp && now.toMillis() - last.toMillis() < FULL_PLAN_COOLDOWN_MS) {
        throw new HttpsError('resource-exhausted', 'NUTRITION_GENERATION_COOLDOWN');
      }
      const deletionLock = await tx.get(db.collection('accountDeletionLocks').doc(uid));
      if (deletionLock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
      tx.create(jobRef, { generationId, operationType: 'full_plan', status: 'queued', requestedAt: now,
        retryCount: 0, aiAttemptCount: 0, lastFailureCode: null,
        planId: null, errorCode: null, ownerUid: uid, nextAttemptAt: now, leaseUntil: null });
      tx.set(rateRef, { ownerUid: uid, activeGenerationId: generationId, activePlanId: rate.get('activePlanId') ?? null,
        lastGenerationId: generationId, lastRequestId: requestId, lastRequestedAt: now, updatedAt: now }, { merge: true });
      return { generationId };
    });
    logInfo('nutrition.generation', 'request_completed', { operationId, generationId: result.generationId,
      durationMs: Date.now() - started, stage: 'queued' });
    return result;
  } catch (error) {
    logWarn('nutrition.generation', 'request_failed', { operationId, stage, durationMs: Date.now() - started,
      failureCode: error instanceof HttpsError ? error.code : 'internal',
      failureReason: error instanceof HttpsError && /^[A-Z_]{1,80}$/.test(error.message) ? error.message : null });
    throw error;
  }
}

export const requestNutritionPlanGeneration = onCall(
  { enforceAppCheck: true, timeoutSeconds: 60 },
  (request) => requestNutritionPlanGenerationHandler(request),
);
