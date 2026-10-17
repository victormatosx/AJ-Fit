import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import type { NutritionAiProvider } from '../ai/provider';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('nutrition job Firestore transactions (emulator)', () => {
  it('deduplicates double tap, completes in background, archives prior plan and cleans global records', async () => {
    const uid = `nutrition-it-${randomUUID()}`;
    const user = db.collection('users').doc(uid);
    const now = Timestamp.now();
    await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175 } });
    await user.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1,
      nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore',
      preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], supplements: [], pregnant: false,
      breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now });
    await user.collection('questionnaires').doc('q1').set({ createdAt: now, version: 1,
      answers: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175, sex: 'm', goal: 'health', days: 3 } });
    await user.collection('assessments').doc('a1').set({ measuredAt: now, createdAt: now, weight: 70 });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    const context = await loadGenerationContext(db, uid);
    // Diet-quality-v3 (2026-10-10): the AI output is free-form — no catalog
    // seeding needed at all, just items whose self-estimated nutrition
    // matches each meal's deterministic target exactly.
    const itemFor = (target: typeof context.engine.mealTargets[number], name: string) => ({
      name, ingredients: [{ name, origin: 'plant' as const }], quantity: 100, unit: 'g', preparationNote: '',
      estimatedNutrition: { kcal: target.kcal.target, proteinG: target.proteinG.target,
        carbsG: target.carbsG.target, fatG: target.fatG.target, fiberG: target.fiberG?.target ?? 0 },
      allergens: [],
    });
    // Cost pass (2026-10-10): full-plan AI output is one option per meal — no options/recommendedOptionIndex wrapper.
    const output = { meals: [
      { slot: 'breakfast', foods: [itemFor(context.engine.mealTargets[0], 'Mingau de aveia')] },
      { slot: 'lunch', foods: [itemFor(context.engine.mealTargets[1], 'Frango grelhado com arroz e feijão')] },
    ] };
    const request = (requestId: string) => ({ auth: { uid }, data: { requestId } } as unknown as CallableRequest);
    const first = await requestNutritionPlanGenerationHandler(request('request-0001'), db);
    const doubleTap = await requestNutritionPlanGenerationHandler(request('request-0001'), db);
    expect(doubleTap).toEqual(first);
    expect((await user.collection('nutritionGenerationJobs').doc(first.generationId).get()).get('status')).toBe('queued');
    const generatePlan = vi.fn().mockImplementation(async () => {
      expect((await user.collection('nutritionGenerationJobs').doc(first.generationId).get()).get('status')).toBe('running');
      return { output, model: 'fake', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 };
    });
    const provider: NutritionAiProvider = { generatePlan };
    expect(await processNutritionGenerationJob(uid, first.generationId, provider, db)).toBe(true);
    expect(generatePlan).toHaveBeenCalledTimes(1);
    const firstPlan = user.collection('nutritionPlans').doc(first.generationId);
    expect((await firstPlan.get()).get('status')).toBe('active');
    expect((await firstPlan.get()).get('meals')[0].options[0].foods[0].name).toBe('Mingau de aveia');
    expect((await user.collection('nutritionGenerationJobs').doc(first.generationId).get()).get('status')).toBe('completed');
    expect(await processNutritionGenerationJob(uid, first.generationId, provider, db)).toBe(false);
    await expect(requestNutritionPlanGenerationHandler(request('request-new-without-cooldown'), db))
      .rejects.toThrow('NUTRITION_GENERATION_COOLDOWN');
    await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const second = await requestNutritionPlanGenerationHandler(request('request-0002'), db);
    expect(second.generationId).not.toBe(first.generationId);
    expect(await processNutritionGenerationJob(uid, second.generationId, { generatePlan: async () => ({
      output, model: 'fake', usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null }, latencyMs: 1,
    }) }, db)).toBe(true);
    expect((await firstPlan.get()).get('status')).toBe('archived');
    expect((await user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);
    await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const third = await requestNutritionPlanGenerationHandler(request('request-0003'), db);
    await processNutritionGenerationJob(uid, third.generationId, { generatePlan: async () => ({
      output: { meals: [] }, model: 'fake', usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null }, latencyMs: 1,
    }) }, db);
    expect((await user.collection('nutritionGenerationJobs').doc(third.generationId).get()).get('status')).toBe('failed');
    expect((await user.collection('nutritionPlans').doc(third.generationId).get()).exists).toBe(false);
    expect((await user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);
    const jobCount = (await user.collection('nutritionGenerationJobs').get()).size;
    await user.collection('nutritionProfile').doc('current').update({ pregnant: true });
    expect((await loadGenerationContext(db, uid)).engine.eligible).toBe(true);
    await user.collection('nutritionProfile').doc('current').update({ pregnant: false, breastfeeding: true });
    expect((await loadGenerationContext(db, uid)).engine.eligible).toBe(true);
    await user.collection('nutritionProfile').doc('current').update({ breastfeeding: false });
    await user.collection('questionnaires').doc('q1').update({ 'answers.goal': 'strength' });
    await expect(requestNutritionPlanGenerationHandler(request('request-0004'), db)).rejects.toThrow('INVALID_NUTRITION_CONTEXT');
    await user.collection('questionnaires').doc('q1').update({ 'answers.goal': 'health', 'answers.height': 0 });
    await user.update({ 'profile.height': 0 });
    await expect(requestNutritionPlanGenerationHandler(request('request-0004'), db)).rejects.toThrow('INVALID_PHYSICAL_CONTEXT');
    expect((await user.collection('nutritionGenerationJobs').get()).size).toBe(jobCount);
    await user.update({ 'profile.height': 175 });
    await db.collection('nutritionRolloutConfig').doc('active').update({ 'nutritionPlanGenerationEnabled.enabled': false });
    await expect(requestNutritionPlanGenerationHandler(request('request-0004'), db)).rejects.toThrow('NUTRITION_GENERATION_DISABLED');
    expect((await user.collection('nutritionGenerationJobs').get()).size).toBe(jobCount);

    await user.collection('nutritionProfile').doc('current').update({ pregnant: false, breastfeeding: false });
    await user.collection('questionnaires').doc('q1').update({ 'answers.goal': 'health', 'answers.height': 175 });
    await db.collection('nutritionRolloutConfig').doc('active').update({ 'nutritionPlanGenerationEnabled.enabled': true });
    await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const profileRace = await requestNutritionPlanGenerationHandler(request('request-profile-race'), db);
    expect(await processNutritionGenerationJob(uid, profileRace.generationId, { generatePlan: async () => {
      await user.collection('nutritionProfile').doc('current').update({ dietaryPattern: 'vegan', updatedAt: Timestamp.now() });
      return { output, model: 'fake', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 };
    } }, db)).toBe(false);
    expect((await user.collection('nutritionPlans').doc(profileRace.generationId).get()).exists).toBe(false);
    expect((await user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);
    await user.collection('nutritionProfile').doc('current').update({ dietaryPattern: 'omnivore', updatedAt: Timestamp.now() });
    await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const deletionRace = await requestNutritionPlanGenerationHandler(request('request-deletion-race'), db);
    const deletionRaceProvider: NutritionAiProvider = { generatePlan: async () => {
      await db.collection('accountDeletionLocks').doc(uid).set({ status: 'REQUESTED' });
      return { output, model: 'fake', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 };
    } };
    expect(await processNutritionGenerationJob(uid, deletionRace.generationId, deletionRaceProvider, db)).toBe(false);
    expect((await user.collection('nutritionPlans').doc(deletionRace.generationId).get()).exists).toBe(false);

    await deleteUserNutritionResources(uid, db);
    expect((await db.collection('nutritionAiOperations').where('ownerUid', '==', uid).get()).empty).toBe(true);
    expect((await db.collection('nutritionRateLimits').doc(uid).get()).exists).toBe(false);
  });
});
