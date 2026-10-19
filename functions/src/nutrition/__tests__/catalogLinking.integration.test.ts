import { favoriteCatalogMealHandler } from '../catalogLinking/favoriteMeal';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../../lib/firebaseAdmin';
import { normalizeFoodRecord } from '../shared/nutrition/catalog/normalize';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { requestNutritionMealAlternativeHandler } from '../generation/mealAlternativeRequest';
import { restoreNutritionPlanHandler } from '../plans/restore';
import { logCatalogMealHandler } from '../catalogLinking/logMeal';
import { catalogItemNutrition } from '../shared/nutrition/catalog/binding';
import type { RawAiFoodItem } from '../generation/domain';
import type { NutritionAiProvider } from '../ai/provider';

const req = (uid: string, data: object) => ({ auth: { uid }, data } as CallableRequest);
afterEach(() => vi.unstubAllEnvs());
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('catalog linked lifecycle — emulator only', () => {
  it('queues, regenerates, links alternatives/favorites, logs by ID idempotently, restores and preserves active plan on failure', async () => {
    vi.stubEnv('NUTRITION_CATALOG_LINKING_ENABLED', 'true');
    const uid = `catalog-it-${randomUUID()}`; const user = db.collection('users').doc(uid); const now = Timestamp.now();
    const foods: string[] = [];
    try {
      await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175 } });
      await user.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1,
        nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore',
        preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], supplements: [], pregnant: false,
        breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now });
      await user.collection('questionnaires').doc('q').set({ createdAt: now, answers: { sex: 'm', goal: 'health', weight: 70, days: 0 } });
      await db.collection('nutritionRolloutConfig').doc('active').set({ nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
        nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 } });
      const context = await loadGenerationContext(db, uid);
      const intents: RawAiFoodItem[] = [];
      for (let i = 0; i < context.engine.mealTargets.length; i++) {
        const t = context.engine.mealTargets[i]; const name = `Alimento ${randomUUID().slice(0, 8)}`;
        const n = { kcal: t.kcal.target / 3, proteinG: t.proteinG.target / 3, carbsG: t.carbsG.target / 3,
          fatG: t.fatG.target / 3, fiberG: t.fiberG!.target / 3 };
        const food = normalizeFoodRecord({ source: { type: 'taco', sourceId: `${uid}-${i}`, sourceName: 'Synthetic test' },
          name, category: 'other', nutritionPer100g: n, generationStatus: 'pending_review' }, 'test-v1');
        foods.push(food.id); await db.collection('nutritionFoods').doc(food.id).set({ ...food, createdAt: now, updatedAt: now });
        intents.push({ name, quantity: 300, unit: 'g', preparationNote: '', estimatedNutrition: { ...n, kcal: 1 }, allergens: [], ingredients: [{ name, origin: 'plant' }] });
      }
      const output = { meals: context.profile.mealSlots.map((slot, i) => ({ slot, foods: [intents[i]] })) };
      const result = (output: unknown) => ({ output, model: 'synthetic', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 });
      const provider: NutritionAiProvider = { generatePlan: vi.fn(async () => result(output)),
        generateMealAlternative: vi.fn(async () => result({ recommendedOptionIndex: 0, options: [{ foods: [intents[0]] }, { foods: [intents[0]] }] })) };
      await user.update({ 'metadata.createdAt': now });
      await user.collection('onboardingNutritionState').doc('current').set({ createdAt: now });
      await db.collection('nutritionRolloutConfig').doc('onboardingAutomatic').set({ schemaVersion: 1, enabled: true, percentage: 100 });
      await user.collection('workoutLifecycleState').doc('current').set({ activeContentIdentity: 'synthetic-program' });
      await user.collection('workoutProgramState').doc('scheduleConfig').set({ version: 1 });
      await user.collection('workoutPrograms').doc('synthetic-program').set({ prescribedTrainingFrequency: 0 });
      await expect(requestNutritionPlanGenerationHandler(req(uid, { intent: 'initial_onboarding' }), db, async () => false)).rejects.toThrow('NUTRITION_NOT_ENTITLED');
      const first = await requestNutritionPlanGenerationHandler(req(uid, { intent: 'initial_onboarding' }), db, async () => true);
      expect(await requestNutritionPlanGenerationHandler(req(uid, { intent: 'initial_onboarding' }), db, async () => true)).toEqual(first);
      expect(await requestNutritionPlanGenerationHandler(req(uid, { requestId: 'catalog-request-1' }), db)).toEqual(first);
      expect((await user.collection('nutritionGenerationJobs').doc(first.generationId).get()).get('generationMode')).toBe('catalog');
      expect(await processNutritionGenerationJob(uid, first.generationId, provider, db)).toBe(true);
      expect(await processNutritionGenerationJob(uid, first.generationId, provider, db)).toBe(false);
      const plan = (await user.collection('nutritionPlans').doc(first.generationId).get()).data()!;
      expect(plan.versions.planSchemaVersion).toBe('3.0.0');
      const item = plan.meals[0].options[0].foods[0];
      expect(item.estimatedNutrition).toEqual(catalogItemNutrition(item.catalogBinding));
      const log = { requestId: randomUUID(), origin: 'plan', documentId: first.generationId, optionId: 'breakfast-1', slot: 'breakfast', localDate: '2026-10-18', timezone: 'America/Sao_Paulo' };
      await expect(logCatalogMealHandler(req(`${uid}-intruder`, log), db)).rejects.toThrow();
      await expect(logCatalogMealHandler(req(uid, { ...log, estimatedNutrition: { kcal: 1 } }), db)).rejects.toThrow('INVALID_REQUEST');
      expect(await logCatalogMealHandler(req(uid, log), db)).toEqual({ status: 'recorded', replayed: false });
      expect(await logCatalogMealHandler(req(uid, log), db)).toEqual({ status: 'recorded', replayed: true });
      const dayRef = user.collection('nutritionDailyLogs').doc(log.localDate);
      const logged = await dayRef.collection('meals').doc('breakfast').collection('items').get();
      expect(logged.size).toBe(1); expect(logged.docs[0].get('foodId')).toBe(item.catalogBinding.foodId);
      expect(logged.docs[0].get('snapshot.kcal')).toBe(item.estimatedNutrition.kcal);
      await expect(requestNutritionPlanGenerationHandler(req(uid, { requestId: 'catalog-too-soon' }), db)).rejects.toThrow('NUTRITION_GENERATION_COOLDOWN');
      const alt = await requestNutritionMealAlternativeHandler(req(uid, { requestId: randomUUID(), planId: first.generationId, slot: 'breakfast' }), db, provider);
      expect((alt.options as { foods: typeof item[] }[])[0].foods[0].catalogBinding).toBeDefined();
      const favorite = await favoriteCatalogMealHandler(req(uid, { origin: 'alternative', documentId: alt.alternativeId, optionId: 'breakfast-1', slot: 'breakfast' }), db);
      const favoriteLog = { ...log, requestId: randomUUID(), origin: 'favorite', documentId: favorite.favoriteId, optionId: favorite.favoriteId, localDate: '2026-10-17' };
      await expect(logCatalogMealHandler(req(uid, favoriteLog), db)).resolves.toMatchObject({ replayed: false });
      await user.collection('nutritionFavoriteMealOptions').doc(favorite.favoriteId).update({ 'foods': [{ ...item, catalogBinding: { ...item.catalogBinding, grams: 1 } }] });
      await expect(logCatalogMealHandler(req(uid, { ...favoriteLog, requestId: randomUUID() }), db)).rejects.toThrow('DIARY_OPTION_NOT_LINKED');
      await db.collection('nutritionFoods').doc(item.catalogBinding.foodId).update({ 'nutritionPer100g.fiberG': 99 });
      await expect(logCatalogMealHandler(req(uid, { ...log, requestId: randomUUID() }), db)).rejects.toThrow('DIARY_CATALOG_CHANGED');
      expect((await logged.docs[0].ref.get()).get('snapshot')).toEqual(logged.docs[0].get('snapshot'));
      await db.collection('nutritionFoods').doc(item.catalogBinding.foodId).update({ 'nutritionPer100g': item.catalogBinding.nutritionPer100g });
      await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
      const second = await requestNutritionPlanGenerationHandler(req(uid, { requestId: 'catalog-request-2' }), db);
      expect(await processNutritionGenerationJob(uid, second.generationId, provider, db)).toBe(true);
      await restoreNutritionPlanHandler(req(uid, { planId: first.generationId }), db);
      expect((await user.collection('nutritionPlans').doc(first.generationId).get()).get('meals')).toEqual(plan.meals);
      await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
      const third = await requestNutritionPlanGenerationHandler(req(uid, { requestId: 'catalog-request-3' }), db);
      const bad: NutritionAiProvider = { generatePlan: async () => result({ meals: output.meals.map(m => ({ ...m, foods: [{ ...intents[0], name: 'Inexistente' }] })) }) };
      expect(await processNutritionGenerationJob(uid, third.generationId, bad, db)).toBe(false);
      expect((await user.collection('nutritionPlans').doc(third.generationId).get()).exists).toBe(false);
      expect((await user.collection('nutritionPlans').doc(first.generationId).get()).get('status')).toBe('active');
      vi.stubEnv('NUTRITION_CATALOG_LINKING_ENABLED', 'false');
      await expect(requestNutritionMealAlternativeHandler(req(uid, { requestId: randomUUID(), planId: first.generationId, slot: 'lunch' }), db, provider)).rejects.toThrow();
    } finally {
      await db.recursiveDelete(user);
      await db.collection('nutritionRateLimits').doc(uid).delete();
      for (const id of foods) await db.collection('nutritionFoods').doc(id).delete();
      const ops = await db.collection('nutritionAiOperations').where('ownerUid', '==', uid).get();
      for (const doc of ops.docs) await doc.ref.delete();
    }
  }, 60_000);
});
