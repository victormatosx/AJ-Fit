import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { requireActiveAccount } from '../../accountDeletion/activeAccountGuard';
import { requireAuth } from '../../lib/auth';
import { db as defaultDb } from '../../lib/firebaseAdmin';
import { OPENAI_API_KEY, NUTRITION_AI_MODELS, FOOD_CATALOG_VERSION_PLACEHOLDER } from '../ai/config';
import { OpenAiNutritionProvider, type NutritionAiProvider } from '../ai/provider';
import { trackNutritionBackendEvent } from '../analytics';
import { countBucket, durationBucket } from '../shared/nutrition/analytics/contract';
import {
  NUTRITION_MEAL_FEEDBACK_REASONS, NUTRITION_MEAL_SLOTS,
  type NutritionMealFeedbackReason, type NutritionMealSlot,
} from '../shared/types/nutrition';
import { generateValidatedMealAlternative } from './alternative';
import { classifyAttemptError, GenerationAttemptsExhausted, type AttemptCode } from './attempts';
import { loadGenerationContext } from './context';
import { resolvePromptFoodNames } from './foodNames';
import { recommendedOptionFoodNames } from './mealAlternativeShared';
import { recordAiOperation } from './operations';
import { requireNutritionGenerationRollout } from './rollout';

export const MEAL_ALTERNATIVE_COOLDOWN_MS = 20 * 1000;
export const MEAL_ALTERNATIVE_REQUEST_LEASE_MS = 3 * 60 * 1000;
export const MEAL_ALTERNATIVE_HOURLY_LIMIT = 12;
const MEAL_ALTERNATIVE_WINDOW_MS = 60 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FinalCode = AttemptCode | 'FEATURE_DISABLED' | 'INVALID_NUTRITION_CONTEXT'
  | 'ACCOUNT_INACTIVE' | 'AI_PROVIDER_ERROR' | 'PLAN_NOT_FOUND' | 'MEAL_SLOT_NOT_IN_PLAN';

interface MealAlternativeRequestData {
  requestId: string;
  planId: string;
  slot: NutritionMealSlot;
  /** `dislikedFoodIds` is historical naming — diet-quality-v3 plan items have no catalog id, so this now holds free-text names the user disliked. */
  feedback?: { reason: NutritionMealFeedbackReason; dislikedFoodIds?: string[] };
}
interface MealShape {
  slot: string;
  recommendedOptionId: string;
  options: { id: string; foods: { name: string }[] }[];
}
interface AlternativeResponse { alternativeId: string; options: unknown; recommendedOptionId: string }

function parseRequestData(data: unknown): MealAlternativeRequestData {
  const invalid = (): never => { throw new HttpsError('invalid-argument', 'INVALID_REQUEST'); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  const value = data as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['requestId', 'planId', 'slot', 'feedback'].includes(key))) return invalid();
  if (typeof value.requestId !== 'string' || !REQUEST_ID_PATTERN.test(value.requestId)) return invalid();
  if (typeof value.planId !== 'string' || value.planId.length < 1 || value.planId.length > 120) return invalid();
  if (typeof value.slot !== 'string' || !NUTRITION_MEAL_SLOTS.includes(value.slot as NutritionMealSlot)) return invalid();
  if (value.feedback === undefined) {
    return { requestId: value.requestId, planId: value.planId, slot: value.slot as NutritionMealSlot };
  }
  if (!value.feedback || typeof value.feedback !== 'object' || Array.isArray(value.feedback)) return invalid();
  const feedback = value.feedback as Record<string, unknown>;
  if (Object.keys(feedback).some((key) => !['reason', 'dislikedFoodIds'].includes(key))) return invalid();
  if (typeof feedback.reason !== 'string'
    || !NUTRITION_MEAL_FEEDBACK_REASONS.includes(feedback.reason as NutritionMealFeedbackReason)) return invalid();
  if (feedback.dislikedFoodIds !== undefined && (!Array.isArray(feedback.dislikedFoodIds)
    || feedback.dislikedFoodIds.length > 8
    || !feedback.dislikedFoodIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120))) return invalid();
  return {
    requestId: value.requestId,
    planId: value.planId,
    slot: value.slot as NutritionMealSlot,
    feedback: { reason: feedback.reason as NutritionMealFeedbackReason,
      ...(Array.isArray(feedback.dislikedFoodIds) ? { dislikedFoodIds: feedback.dislikedFoodIds as string[] } : {}) },
  };
}

function errorCode(error: unknown): FinalCode {
  if (error instanceof GenerationAttemptsExhausted) return error.code;
  if (error instanceof Error && ['NUTRITION_GENERATION_DISABLED', 'INVALID_NUTRITION_CONTEXT',
    'ACCOUNT_INACTIVE', 'AI_PROVIDER_ERROR', 'PLAN_NOT_FOUND', 'MEAL_SLOT_NOT_IN_PLAN'].includes(error.message)) {
    return error.message === 'NUTRITION_GENERATION_DISABLED' ? 'FEATURE_DISABLED' : error.message as FinalCode;
  }
  return classifyAttemptError(error);
}

function responseFrom(data: FirebaseFirestore.DocumentData): AlternativeResponse {
  return { alternativeId: String(data.alternativeId), options: data.options,
    recommendedOptionId: String(data.recommendedOptionId) };
}

export async function requestNutritionMealAlternativeHandler(
  request: CallableRequest,
  db: Firestore = defaultDb,
  provider: NutritionAiProvider = new OpenAiNutritionProvider(OPENAI_API_KEY.value()),
): Promise<AlternativeResponse> {
  const startedAt = Date.now();
  const uid = requireAuth(request);
  const { requestId, planId, slot, feedback } = parseRequestData(request.data);
  try { await requireActiveAccount(uid, db); }
  catch { throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE'); }
  try { await requireNutritionGenerationRollout(db, uid); }
  catch { throw new HttpsError('failed-precondition', 'NUTRITION_GENERATION_DISABLED'); }

  const user = db.collection('users').doc(uid);
  const planRef = user.collection('nutritionPlans').doc(planId);
  const alternativeRef = user.collection('nutritionMealAlternatives').doc(requestId);
  const rateRef = db.collection('nutritionRateLimits').doc(uid);
  const deletionLockRef = db.collection('accountDeletionLocks').doc(uid);
  const claimedAt = Timestamp.now();
  const claim = await db.runTransaction(async (tx) => {
    const [lock, plan, existing, rate] = await Promise.all([
      tx.get(deletionLockRef), tx.get(planRef), tx.get(alternativeRef), tx.get(rateRef),
    ]);
    if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
    if (existing.exists) return { replay: responseFrom(existing.data()!), meal: null };
    if (!plan.exists || plan.get('status') !== 'active') throw new HttpsError('not-found', 'PLAN_NOT_FOUND');
    const meals = plan.get('meals') as MealShape[];
    const meal = Array.isArray(meals) ? meals.find((item) => item.slot === slot) : undefined;
    if (!meal) throw new HttpsError('invalid-argument', 'MEAL_SLOT_NOT_IN_PLAN');

    const activeRequestId = rate.get('activeMealAlternativeRequestId');
    const activeStartedAt = rate.get('activeMealAlternativeStartedAt');
    if (typeof activeRequestId === 'string' && activeStartedAt instanceof Timestamp
      && claimedAt.toMillis() - activeStartedAt.toMillis() < MEAL_ALTERNATIVE_REQUEST_LEASE_MS) {
      throw new HttpsError('aborted', activeRequestId === requestId
        ? 'MEAL_ALTERNATIVE_IN_PROGRESS' : 'MEAL_ALTERNATIVE_COOLDOWN');
    }
    const last = rate.get('lastMealAlternativeAt');
    if (last instanceof Timestamp && claimedAt.toMillis() - last.toMillis() < MEAL_ALTERNATIVE_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'MEAL_ALTERNATIVE_COOLDOWN');
    }
    const priorWindow = rate.get('mealAlternativeWindowStartedAt');
    const sameWindow = priorWindow instanceof Timestamp
      && claimedAt.toMillis() - priorWindow.toMillis() < MEAL_ALTERNATIVE_WINDOW_MS;
    const priorCount = sameWindow && Number.isInteger(rate.get('mealAlternativeWindowCount'))
      ? Number(rate.get('mealAlternativeWindowCount')) : 0;
    if (priorCount >= MEAL_ALTERNATIVE_HOURLY_LIMIT) {
      throw new HttpsError('resource-exhausted', 'MEAL_ALTERNATIVE_RATE_LIMIT');
    }
    tx.set(rateRef, {
      ownerUid: uid,
      activeMealAlternativeRequestId: requestId,
      activeMealAlternativeStartedAt: claimedAt,
      mealAlternativeWindowStartedAt: sameWindow ? priorWindow : claimedAt,
      mealAlternativeWindowCount: priorCount + 1,
      updatedAt: claimedAt,
    }, { merge: true });
    return { replay: null, meal };
  });
  if (claim.replay) return claim.replay;
  const meal = claim.meal!;

  let finalAttempt = 0;
  try {
    const context = await loadGenerationContext(db, uid);
    const mealIndex = context.profile.mealSlots.indexOf(slot);
    if (mealIndex === -1) throw new Error('INVALID_NUTRITION_CONTEXT');
    const target = context.engine.mealTargets[mealIndex];
    const foodNames = await resolvePromptFoodNames(db, context.profile, uid);

    const { validated, result, attempt, fallback } = await generateValidatedMealAlternative(
      provider, context.profile, slot, target, recommendedOptionFoodNames(meal),
      context.physical.goal, foodNames, feedback?.reason,
      async (audit) => {
        finalAttempt = audit.attempt;
        await recordAiOperation(db, { ownerUid: uid, generationId: requestId, operation: 'meal_alternative',
          defaultModel: audit.fallback ? NUTRITION_AI_MODELS.fallback : NUTRITION_AI_MODELS.mealAlternative,
          attempt: audit.attempt, result: audit.result, code: audit.code, fallback: audit.fallback,
          latencyMs: audit.latencyMs });
      },
    );

    const createdAt = Timestamp.now();
    const saved = await db.runTransaction(async (tx) => {
      const [lock, currentPlan, rate, existing, latestProfile] = await Promise.all([
        tx.get(deletionLockRef), tx.get(planRef), tx.get(rateRef), tx.get(alternativeRef),
        tx.get(user.collection('nutritionProfile').doc('current')),
      ]);
      if (lock.exists) throw new HttpsError('failed-precondition', 'ACCOUNT_INACTIVE');
      if (existing.exists) return responseFrom(existing.data()!);
      if (!latestProfile.get('updatedAt')?.isEqual(context.profile.updatedAt)) {
        throw new HttpsError('aborted', 'MEAL_ALTERNATIVE_STALE_REQUEST');
      }
      if (!currentPlan.exists || currentPlan.get('status') !== 'active') {
        throw new HttpsError('failed-precondition', 'PLAN_NOT_FOUND');
      }
      if (rate.get('activeMealAlternativeRequestId') !== requestId) {
        throw new HttpsError('aborted', 'MEAL_ALTERNATIVE_STALE_REQUEST');
      }
      const value = { alternativeId: requestId, planId, slot, options: validated.options,
        recommendedOptionId: validated.recommendedOptionId, feedback: feedback ?? null,
        catalogVersion: FOOD_CATALOG_VERSION_PLACEHOLDER,
        generationMetadata: { provider: 'openai', model: result.model, attempts: attempt,
          corrected: validated.corrected, fallbackUsed: fallback }, createdAt };
      tx.create(alternativeRef, value);
      tx.update(rateRef, { activeMealAlternativeRequestId: null, activeMealAlternativeStartedAt: null,
        lastMealAlternativeAt: createdAt, lastMealAlternativeRequestId: requestId,
        lastMealAlternativeId: requestId, updatedAt: createdAt });
      return responseFrom(value);
    });
    await trackNutritionBackendEvent({ name: 'nutrition_meal_alternative_completed', properties: {
      durationBucket: durationBucket(Date.now() - startedAt), retryCountBucket: countBucket(attempt - 1),
      fallbackUsed: fallback, mealSlot: slot } });
    return saved;
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const [lock, rate] = await Promise.all([tx.get(deletionLockRef), tx.get(rateRef)]);
      if (lock.exists || !rate.exists || rate.get('activeMealAlternativeRequestId') !== requestId) return;
      tx.update(rateRef, { activeMealAlternativeRequestId: null, activeMealAlternativeStartedAt: null,
        updatedAt: Timestamp.now() });
    }).catch(() => undefined);
    const code = errorCode(error);
    await trackNutritionBackendEvent({ name: 'nutrition_meal_alternative_failed', properties: {
      durationBucket: durationBucket(Date.now() - startedAt),
      retryCountBucket: countBucket(Math.max(0, finalAttempt - 1)), failureCode: code, mealSlot: slot } });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', code);
  }
}

export const requestNutritionMealAlternative = onCall(
  { enforceAppCheck: true, timeoutSeconds: 120, secrets: [OPENAI_API_KEY] },
  (request) => requestNutritionMealAlternativeHandler(request),
);
