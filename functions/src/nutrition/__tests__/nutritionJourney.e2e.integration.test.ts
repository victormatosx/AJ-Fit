import { randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runFirestoreCleanup } from '../../accountDeletion/firestoreCleanup/engine';
import { NUTRITION_USER_RESOURCES } from '../../accountDeletion/firestoreCleanup/resources';
import { db } from '../../lib/firebaseAdmin';
import { dispatchNutritionPlanReady } from '../../notifications/nutritionNotifications';
import { NutritionAiProviderError, type NutritionAiProvider } from '../ai/provider';
import { configureNutritionBackendAnalytics } from '../analytics';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionMealAlternativeHandler } from '../generation/mealAlternativeRequest';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { restoreNutritionPlanHandler } from '../plans/restore';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

type Seed = Awaited<ReturnType<typeof seedEligibleUser>>;

function callable(uid: string, data: unknown): CallableRequest {
  return { auth: { uid }, data } as unknown as CallableRequest;
}

async function seedEligibleUser(uid: string) {
  const user = db.collection('users').doc(uid);
  const now = Timestamp.now();
  await user.set({
    profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01T12:00:00.000Z')), height: 175 },
    preferences: { language: 'pt-BR', notificationPreferences: { pushEnabled: true, nutrition: true } },
  });
  await user.collection('nutritionProfile').doc('current').set({
    questionnaireVersion: 1,
    nonTrainingActivityLevel: 'active',
    mealSlots: ['breakfast', 'lunch'],
    dietaryPattern: 'omnivore',
    preferredFoodIds: [],
    usualFoodIds: [],
    excludedFoodIds: [],
    excludedAllergens: [],
    supplements: [],
    pregnant: false,
    breastfeeding: false,
    varietyPreference: 'indifferent',
    updatedAt: now,
  });
  await user.collection('questionnaires').doc('q1').set({
    createdAt: now,
    version: 1,
    answers: {
      birthDate: Timestamp.fromDate(new Date('1995-01-01T12:00:00.000Z')),
      height: 175,
      sex: 'm',
      goal: 'health',
      days: 3,
    },
  });
  await user.collection('assessments').doc('weight-1').set({
    measuredAt: now,
    createdAt: now,
    weight: 70,
  });
  await user.collection('workoutProgramState').doc('scheduleConfig').set({ timezone: 'America/Sao_Paulo' });
  await db.collection('nutritionRolloutConfig').doc('active').set({
    nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
  });

  const context = await loadGenerationContext(db, uid);
  return { uid, user, context };
}

/** Diet-quality-v3 (2026-10-10): no catalog/foodId — a free-form item whose self-estimated nutrition matches a meal's deterministic target exactly. */
function planItem(target: Seed['context']['engine']['mealTargets'][number], name: string) {
  return { name, quantity: 100, unit: 'g', preparationNote: '',
    estimatedNutrition: { kcal: target.kcal.target, proteinG: target.proteinG.target,
      carbsG: target.carbsG.target, fatG: target.fatG.target, fiberG: target.fiberG?.target ?? 1 },
    allergens: [] };
}

// Cost pass (2026-10-10): full-plan AI output is one option per meal — no options/recommendedOptionIndex wrapper.
function validPlanOutput(seed: Seed) {
  const [breakfastTarget, lunchTarget] = seed.context.engine.mealTargets;
  return {
    meals: [
      { slot: 'breakfast', foods: [planItem(breakfastTarget, 'Mingau de aveia')] },
      { slot: 'lunch', foods: [planItem(lunchTarget, 'Frango grelhado com arroz e feijão')] },
    ],
  };
}

function validAlternativeOutput(seed: Seed) {
  const lunchTarget = seed.context.engine.mealTargets[1];
  return {
    recommendedOptionIndex: 0,
    options: [
      { foods: [planItem(lunchTarget, 'Peixe assado com legumes')] },
      { foods: [planItem(lunchTarget, 'Omelete com salada')] },
    ],
  };
}

async function waitForObservedStatus(ref: DocumentReference, terminal: string) {
  const observed: string[] = [];
  let unsubscribe: () => void = () => {};
  let firstSnapshot!: () => void;
  const ready = new Promise<void>((resolve) => { firstSnapshot = resolve; });
  const reached = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`status timeout: ${observed.join(',')}`)), 5_000);
    unsubscribe = ref.onSnapshot((snapshot) => {
      const status = snapshot.get('status');
      if (typeof status === 'string') observed.push(status);
      firstSnapshot();
      if (status === terminal) {
        clearTimeout(timer);
        resolve();
      }
    }, reject);
  });
  // Attach before starting the worker; otherwise the initial snapshot may
  // already be `running`, making the assertion about observing `queued` race.
  await Promise.race([ready, reached]);
  return { observed, reached, stop: () => unsubscribe() };
}

afterEach(() => configureNutritionBackendAnalytics(null));

describe.skipIf(!enabled)('Nutrition complete journey (Firestore Emulator)', () => {
  it('runs generation, retry, plan activation, alternative, restore, notifications, observability and deletion', async () => {
    const seed = await seedEligibleUser(`nutrition-e2e-${randomUUID()}`);
    const backendEvents: string[] = [];
    configureNutritionBackendAnalytics({ track: (event) => { backendEvents.push(event.name); } });

    const firstRequest = callable(seed.uid, { requestId: 'journey-request-0001' });
    const first = await requestNutritionPlanGenerationHandler(firstRequest, db);
    await expect(requestNutritionPlanGenerationHandler(firstRequest, db)).resolves.toEqual(first);
    const firstJobRef = seed.user.collection('nutritionGenerationJobs').doc(first.generationId);
    expect((await firstJobRef.get()).get('status')).toBe('queued');
    const observer = await waitForObservedStatus(firstJobRef, 'completed');
    const generatePlan = vi.fn()
      .mockResolvedValueOnce({
        output: { meals: [] },
        model: 'gpt-6-luna',
        usage: { inputTokens: 120, outputTokens: 20, cachedInputTokens: 10 },
        latencyMs: 11,
      })
      .mockResolvedValueOnce({
        output: validPlanOutput(seed),
        model: 'gpt-6-luna',
        usage: { inputTokens: 140, outputTokens: 30, cachedInputTokens: 20 },
        latencyMs: 12,
      });
    expect(await processNutritionGenerationJob(seed.uid, first.generationId, { generatePlan }, db)).toBe(true);
    await observer.reached;
    observer.stop();
    expect(observer.observed).toEqual(expect.arrayContaining(['queued', 'running', 'validating', 'completed']));
    expect(generatePlan).toHaveBeenCalledTimes(2);

    const planARef = seed.user.collection('nutritionPlans').doc(first.generationId);
    const planA = await planARef.get();
    expect(planA.get('status')).toBe('active');
    expect(planA.get('versions')).toMatchObject({ planSchemaVersion: '2.0.0' });
    expect(planA.get('profileSnapshot')).toBeTruthy();
    expect(planA.get('physicalSnapshot')).toBeTruthy();
    for (const meal of planA.get('meals')) {
      expect(meal.options).toHaveLength(1);
      expect(meal.options.filter((option: { id: string }) => option.id === meal.recommendedOptionId)).toHaveLength(1);
      for (const option of meal.options) {
        expect(option.foods[0]).toHaveProperty('estimatedNutrition');
        expect(option.foods[0]).not.toHaveProperty('foodId');
      }
    }
    expect(planA.get('dailyTotals.kcal')).toBeCloseTo(seed.context.engine.energy.targetKcal, 1);

    await db.collection('nutritionRateLimits').doc(seed.uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const second = await requestNutritionPlanGenerationHandler(callable(seed.uid, { requestId: 'journey-request-0002' }), db);
    expect(await processNutritionGenerationJob(seed.uid, second.generationId, {
      generatePlan: async () => ({
        output: validPlanOutput(seed),
        model: 'gpt-6-luna',
        usage: { inputTokens: 100, outputTokens: 25, cachedInputTokens: 0 },
        latencyMs: 8,
      }),
    }, db)).toBe(true);
    const planBRef = seed.user.collection('nutritionPlans').doc(second.generationId);
    expect((await planARef.get()).get('status')).toBe('archived');
    expect((await planBRef.get()).get('status')).toBe('active');
    expect((await seed.user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);

    const alternativeRequestId = randomUUID();
    const generateMealAlternative = vi.fn()
      .mockResolvedValueOnce({
        output: { options: [] }, model: 'gpt-6-luna',
        usage: { inputTokens: 40, outputTokens: 10, cachedInputTokens: 0 }, latencyMs: 3,
      })
      .mockResolvedValueOnce({
        output: validAlternativeOutput(seed), model: 'gpt-6-luna',
        usage: { inputTokens: 50, outputTokens: 12, cachedInputTokens: 5 }, latencyMs: 4,
      });
    const alternativeProvider: NutritionAiProvider = { generatePlan: vi.fn(), generateMealAlternative };
    const planMealsBeforeAlternative = (await planBRef.get()).get('meals');
    const alternativeRequest = callable(seed.uid, {
      requestId: alternativeRequestId,
      planId: second.generationId,
      slot: 'lunch',
      feedback: { reason: 'more_variety' },
    });
    const alternative = await requestNutritionMealAlternativeHandler(alternativeRequest, db, alternativeProvider);
    expect(generateMealAlternative).toHaveBeenCalledTimes(2);
    await expect(requestNutritionMealAlternativeHandler(alternativeRequest, db, alternativeProvider))
      .resolves.toEqual(alternative);
    expect(generateMealAlternative).toHaveBeenCalledTimes(2);
    expect((await planBRef.get()).get('meals')).toEqual(planMealsBeforeAlternative);

    const operations = await db.collection('nutritionAiOperations').where('ownerUid', '==', seed.uid).get();
    expect(operations.size).toBe(5);
    expect(new Set(operations.docs.map((item) => item.get('operation')))).toEqual(new Set(['full_plan', 'meal_alternative']));
    for (const operation of operations.docs) {
      const data = operation.data();
      expect(data).toMatchObject({ provider: 'openai' });
      expect(data.attempts).toBeGreaterThan(0);
      expect(data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(data.pricingVersion).toBe('openai-standard-2026-10-08');
      expect(data.estimatedCostUsd).toBeGreaterThan(0);
      for (const forbidden of ['prompt', 'rawPrompt', 'rawOutput', 'diary', 'weight', 'allergens']) {
        expect(data).not.toHaveProperty(forbidden);
      }
    }
    expect(backendEvents).toEqual(expect.arrayContaining([
      'nutrition_generation_completed',
      'nutrition_meal_alternative_completed',
    ]));

    const notificationTime = Timestamp.fromDate(new Date('2026-10-05T12:00:00.000Z'));
    await expect(dispatchNutritionPlanReady(seed.uid, second.generationId, db, notificationTime))
      .resolves.toMatchObject({ status: 'NO_ELIGIBLE_DEVICE' });
    await expect(dispatchNutritionPlanReady(seed.uid, second.generationId, db, notificationTime))
      .resolves.toMatchObject({ status: 'DUPLICATE' });

    const planABeforeRestore = (await planARef.get()).data();
    await expect(restoreNutritionPlanHandler(callable(seed.uid, { planId: first.generationId }), db))
      .resolves.toEqual({ planId: first.generationId });
    expect((await planARef.get()).get('status')).toBe('active');
    expect((await planBRef.get()).get('status')).toBe('archived');
    expect((await seed.user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);
    expect((await planARef.get()).get('meals')).toEqual(planABeforeRestore?.meals);
    expect((await planARef.get()).get('engineSnapshot')).toEqual(planABeforeRestore?.engineSnapshot);

    const dailyLogRef = seed.user.collection('nutritionDailyLogs').doc('2026-10-05');
    await dailyLogRef.set({
      localDate: '2026-10-05', timezone: 'America/Sao_Paulo', loggedItemCount: 1,
      totals: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1, fiberG: 1 },
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await dailyLogRef.collection('meals').doc('lunch').set({
      slot: 'lunch', totals: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1, fiberG: 1 },
    });
    await dailyLogRef.collection('meals').doc('lunch').collection('items').doc('item-e2e').set({
      id: 'item-e2e', foodId: 'rice', grams: 100, source: 'catalog_food',
      snapshot: { name: 'Rice', kcal: 100, proteinG: 2, carbsG: 20, fatG: 1 }, loggedAt: Timestamp.now(),
    });
    await seed.user.collection('nutritionRecipes').doc('recipe-e2e').set({ id: 'recipe-e2e' });
    await seed.user.collection('nutritionFoods').doc('custom-e2e').set({ id: 'custom-e2e' });
    await seed.user.collection('nutritionPreferences').doc('current').set({ favoriteFoodIds: [] });
    await db.collection('notificationProductWindows').doc(`nutrition-e2e-${seed.uid}`).set({ uid: seed.uid });

    const otherUid = `nutrition-e2e-other-${randomUUID()}`;
    const other = db.collection('users').doc(otherUid);
    await other.set({ marker: 'preserve' });
    for (const resource of NUTRITION_USER_RESOURCES) {
      await other.collection(resource).doc('preserve').set({ ownerUid: otherUid });
    }
    await db.collection('nutritionAiOperations').doc(`preserve-${otherUid}`).set({ ownerUid: otherUid });
    await db.collection('nutritionRateLimits').doc(otherUid).set({ ownerUid: otherUid });
    await db.collection('accountDeletionLocks').doc(seed.uid).set({ status: 'PROCESSING' });
    // The global diary/log catalog is never user-owned — proves per-user
    // deletion never touches it, independent of generation (diet-quality-v3
    // no longer reads this collection at all).
    const globalCatalogFoodId = `nutrition-foods-global-${randomUUID()}`;
    await db.collection('nutritionFoods').doc(globalCatalogFoodId).set({ id: globalCatalogFoodId, name: 'Global fixture' });

    await expect(runFirestoreCleanup(seed.uid, { db })).resolves.toEqual({ kind: 'SUCCEEDED' });
    await expect(runFirestoreCleanup(seed.uid, { db })).resolves.toEqual({ kind: 'SUCCEEDED' });
    expect((await seed.user.get()).exists).toBe(false);
    for (const resource of NUTRITION_USER_RESOURCES) {
      expect((await seed.user.collection(resource).get()).empty).toBe(true);
      expect((await other.collection(resource).doc('preserve').get()).exists).toBe(true);
    }
    // nutritionDailyLogs' meals/items subcollections must not survive as orphans.
    expect((await dailyLogRef.collection('meals').doc('lunch').get()).exists).toBe(false);
    expect((await dailyLogRef.collection('meals').doc('lunch').collection('items').doc('item-e2e').get()).exists).toBe(false);
    expect((await db.collection('nutritionAiOperations').where('ownerUid', '==', seed.uid).get()).empty).toBe(true);
    expect((await db.collection('nutritionAiOperations').doc(`preserve-${otherUid}`).get()).exists).toBe(true);
    expect((await db.collection('nutritionRateLimits').doc(seed.uid).get()).exists).toBe(false);
    expect((await db.collection('nutritionFoods').doc(globalCatalogFoodId).get()).exists).toBe(true);
    expect((await db.collection('nutritionRolloutConfig').doc('active').get()).exists).toBe(true);
    expect((await db.collection('notificationDispatches').where('uid', '==', seed.uid).get()).empty).toBe(true);
    expect((await db.collection('notificationProductWindows').where('uid', '==', seed.uid).get()).empty).toBe(true);
    await expect(dispatchNutritionPlanReady(seed.uid, second.generationId, db, notificationTime)).resolves.toBeNull();
    expect((await db.collection('notificationDispatches').where('uid', '==', seed.uid).get()).empty).toBe(true);
  }, 40_000);

  it('blocks safety, rollout and deletion before queueing a job with stable client-facing codes', async () => {
    const seed = await seedEligibleUser(`nutrition-gates-${randomUUID()}`);
    const request = () => requestNutritionPlanGenerationHandler(
      callable(seed.uid, { requestId: `gate-${randomUUID()}` }), db,
    );
    await seed.user.collection('nutritionProfile').doc('current').update({ pregnant: true });
    await expect(request()).rejects.toThrow('INELIGIBLE_PREGNANCY');
    await seed.user.collection('nutritionProfile').doc('current').update({ pregnant: false, breastfeeding: true });
    await expect(request()).rejects.toThrow('INELIGIBLE_BREASTFEEDING');
    await seed.user.collection('nutritionProfile').doc('current').update({ breastfeeding: false });
    await seed.user.collection('questionnaires').doc('q1').update({ 'answers.goal': 'strength' });
    await expect(request()).rejects.toThrow('INVALID_NUTRITION_CONTEXT');
    await seed.user.collection('questionnaires').doc('q1').update({ 'answers.goal': 'health' });
    await db.collection('nutritionRolloutConfig').doc('active').update({ 'nutritionPlanGenerationEnabled.enabled': false });
    await expect(request()).rejects.toThrow('NUTRITION_GENERATION_DISABLED');
    await db.collection('nutritionRolloutConfig').doc('active').update({ 'nutritionPlanGenerationEnabled.enabled': true });
    await db.collection('accountDeletionLocks').doc(seed.uid).set({ status: 'REQUESTED' });
    await expect(request()).rejects.toThrow('ACCOUNT_INACTIVE');
    expect((await seed.user.collection('nutritionGenerationJobs').get()).empty).toBe(true);
  });

  it('uses fallback only for retryable validation failures and persists no plan after exhaustion or safety refusal', async () => {
    const fallbackSeed = await seedEligibleUser(`nutrition-fallback-${randomUUID()}`);
    const fallbackJob = await requestNutritionPlanGenerationHandler(
      callable(fallbackSeed.uid, { requestId: 'fallback-request-0001' }), db,
    );
    const fallbackProvider = vi.fn()
      .mockResolvedValueOnce({ output: { meals: [] }, model: 'gpt-6-luna', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 })
      .mockResolvedValueOnce({ output: { meals: [] }, model: 'gpt-6-luna', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 })
      .mockResolvedValueOnce({ output: validPlanOutput(fallbackSeed), model: 'gpt-6.1-sol', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 });
    expect(await processNutritionGenerationJob(fallbackSeed.uid, fallbackJob.generationId, { generatePlan: fallbackProvider }, db)).toBe(true);
    expect(fallbackProvider.mock.calls.map(([request]) => request.fallback)).toEqual([false, false, true]);
    expect((await fallbackSeed.user.collection('nutritionPlans').doc(fallbackJob.generationId).get())
      .get('generationMetadata.fallbackUsed')).toBe(true);

    const exhaustedSeed = await seedEligibleUser(`nutrition-exhausted-${randomUUID()}`);
    const exhaustedJob = await requestNutritionPlanGenerationHandler(
      callable(exhaustedSeed.uid, { requestId: 'exhausted-request-0001' }), db,
    );
    const invalidProvider = vi.fn().mockResolvedValue({
      output: { meals: [] }, model: 'gpt-6-luna',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1,
    });
    expect(await processNutritionGenerationJob(exhaustedSeed.uid, exhaustedJob.generationId, { generatePlan: invalidProvider }, db)).toBe(false);
    expect(invalidProvider).toHaveBeenCalledTimes(3);
    expect((await exhaustedSeed.user.collection('nutritionGenerationJobs').doc(exhaustedJob.generationId).get()).get('status')).toBe('failed');
    expect((await exhaustedSeed.user.collection('nutritionPlans').doc(exhaustedJob.generationId).get()).exists).toBe(false);

    const safetySeed = await seedEligibleUser(`nutrition-safety-${randomUUID()}`);
    const safetyJob = await requestNutritionPlanGenerationHandler(
      callable(safetySeed.uid, { requestId: 'safety-request-0001' }), db,
    );
    const safetyProvider = vi.fn().mockRejectedValue(
      new NutritionAiProviderError('AI_SAFETY_VALIDATION_FAILED', false),
    );
    expect(await processNutritionGenerationJob(safetySeed.uid, safetyJob.generationId, { generatePlan: safetyProvider }, db)).toBe(false);
    expect(safetyProvider).toHaveBeenCalledTimes(1);
    expect(safetyProvider.mock.calls[0]?.[0].fallback).toBe(false);
    expect((await safetySeed.user.collection('nutritionGenerationJobs').doc(safetyJob.generationId).get())
      .get('errorCode')).toBe('AI_SAFETY_VALIDATION_FAILED');
    expect((await safetySeed.user.collection('nutritionPlans').doc(safetyJob.generationId).get()).exists).toBe(false);
  }, 30_000);
});
