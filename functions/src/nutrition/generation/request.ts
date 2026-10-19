import { catalogLinkingEnabled } from '../catalogLinking/config';
import { createRevenueCatV2Client, REVENUECAT_API_SECRET_KEY } from '../../billing/revenueCatApi';
import { reconcileRevenueCatPremiumSubscriptions } from '../../billing/revenueCatSubscription';
import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { logInfo, logWarn } from '../../lib/logger';
import { requireAuth, requireVerifiedEmailForPrivateAccess } from '../../lib/auth';
import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { loadGenerationContext } from './context';
import { onboardingAutomaticGenerationEnabled } from '../shared/nutrition/rolloutCore';
import { requireNutritionGenerationRollout } from './rollout';

export const FULL_PLAN_COOLDOWN_MS = 15 * 60 * 1000;
function requestIdFrom(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'requestId' && key !== 'intent')
    || (value.requestId !== undefined && (typeof value.requestId !== 'string'
      || !/^[A-Za-z0-9_.:-]{8,100}$/.test(value.requestId)))) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  }
  if (value.intent !== undefined && value.intent !== 'initial_onboarding') throw new HttpsError('invalid-argument', 'INVALID_REQUEST');
  return typeof value.requestId === 'string' ? value.requestId : null;
}
async function hasActivePremium(uid: string): Promise<boolean> {
  const subscriptions = await createRevenueCatV2Client().getCustomerSubscriptions(uid);
  return reconcileRevenueCatPremiumSubscriptions(subscriptions).status === 'active';
}
export async function requestNutritionPlanGenerationHandler(
  request: CallableRequest, db: Firestore = defaultDb,
  entitled: (uid: string) => Promise<boolean> = hasActivePremium,
): Promise<{ generationId: string; status?: 'skipped' | 'disabled' }> {
  const started = Date.now();
  const operationId = randomUUID();
  let stage = 'authentication';
  logInfo('nutrition.generation', 'request_started', { operationId, stage });
  try {
    const uid = requireAuth(request);
    const requestId = requestIdFrom(request.data);
    const initial = request.data?.intent === 'initial_onboarding';
    if (initial) {
      requireVerifiedEmailForPrivateAccess(request);
      const automaticFlag = await db.collection('nutritionRolloutConfig').doc('onboardingAutomatic').get();
      if (!onboardingAutomaticGenerationEnabled(uid, automaticFlag.data())) return { generationId: '', status: 'disabled' };
      if (!await entitled(uid)) throw new HttpsError('failed-precondition', 'NUTRITION_NOT_ENTITLED');
      const root = db.collection('users').doc(uid);
      const [enrollment, account, lifecycle, schedule] = await Promise.all([
        root.collection('onboardingNutritionState').doc('current').get(), root.get(),
        root.collection('workoutLifecycleState').doc('current').get(),
        root.collection('workoutProgramState').doc('scheduleConfig').get(),
      ]);
      if (!enrollment.exists || !(account.get('metadata.createdAt') instanceof Timestamp) || !(enrollment.get('createdAt') instanceof Timestamp)
        || !enrollment.get('createdAt').isEqual(account.get('metadata.createdAt'))) return { generationId: '', status: 'skipped' };
      const pointer = lifecycle.exists ? null : await root.collection('workoutProgramState').doc('active').get();
      const identity = lifecycle.get('lifecycle.activeContentIdentity') ?? lifecycle.get('activeContentIdentity') ?? pointer?.get('programId');
      if (typeof identity !== 'string' || !identity || !schedule.exists) throw new HttpsError('failed-precondition', 'NUTRITION_CONTEXT_PENDING');
    }
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
    const enrollmentRef = user.collection('onboardingNutritionState').doc('current');
    const now = Timestamp.now();
    stage = 'queue';
    const result = await db.runTransaction(async (tx) => {
      const rate = await tx.get(rateRef);
      const enrollment = await tx.get(enrollmentRef);
      if (initial && !onboardingAutomaticGenerationEnabled(uid, (await tx.get(db.collection('nutritionRolloutConfig').doc('onboardingAutomatic'))).data())) return { generationId: '', status: 'disabled' as const };
      let onboardingRetry = false;
      if (!initial && typeof enrollment.get('autoGenerationId') === 'string' && !rate.get('activePlanId')) {
        onboardingRetry = (await tx.get(user.collection('nutritionPlans').limit(1))).empty;
      }
      if (initial) {
        if (!enrollment.exists || enrollment.get('autoSkipped')) return { generationId: '', status: 'skipped' as const };
        const previous = enrollment.get('autoGenerationId');
        if (typeof previous === 'string') return { generationId: previous };
        const plans = await tx.get(user.collection('nutritionPlans').limit(1));
        if (!plans.empty || typeof rate.get('activePlanId') === 'string') {
          tx.update(enrollmentRef, { autoSkipped: true });
          return { generationId: '', status: 'skipped' as const };
        }
      }
      const activeId = rate.get('activeGenerationId');
      const existing = typeof activeId === 'string'
        ? await tx.get(user.collection('nutritionGenerationJobs').doc(activeId)) : null;
      if (existing && ['queued', 'running', 'validating'].includes(existing.get('status'))) {
        if (initial) {
          tx.update(enrollmentRef, { autoGenerationId: activeId });
          tx.update(existing.ref, { initialOnboarding: true });
        }
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
      if (initial) tx.update(enrollmentRef, { autoGenerationId: generationId });
      else if (onboardingRetry) tx.update(enrollmentRef, { latestGenerationId: generationId });
      tx.create(jobRef, { ...(catalogLinkingEnabled() ? { generationMode: 'catalog' } : {}), ...((initial || onboardingRetry) ? { initialOnboarding: true } : {}), generationId, operationType: 'full_plan', status: 'queued', requestedAt: now,
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
  { enforceAppCheck: true, timeoutSeconds: 60, secrets: [REVENUECAT_API_SECRET_KEY] },
  (request) => requestNutritionPlanGenerationHandler(request),
);
