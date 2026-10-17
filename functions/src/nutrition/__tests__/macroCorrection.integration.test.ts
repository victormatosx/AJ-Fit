import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';
import type { ParsedAiMealPlanOutput } from '../generation/domain';
import { NUTRIENTS } from '../generation/diagnostics';

// Every write in this file is guarded by the local emulator flag. No production
// project, API key or real provider participates in this suite.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('P1 correction persistence (Firestore emulator)', () => {
  async function fixture() {
    const uid = `macro-p1-${randomUUID()}`;
    const user = db.collection('users').doc(uid);
    const now = Timestamp.now();
    await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175 } });
    await user.collection('questionnaires').doc('q').set({ createdAt: now, version: 1,
      answers: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175, weight: 70, sex: 'm', goal: 'health', days: 3 } });
    await user.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1,
      nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore',
      preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: ['milk'], supplements: [],
      pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    const context = await loadGenerationContext(db, uid);
    const output: ParsedAiMealPlanOutput = { meals: context.engine.mealTargets.map((target) => ({ slot: target.slot, foods: [{
      name: 'Alimento sintético', ingredients: [{ name: 'Ingrediente sintético', origin: 'plant' }],
      quantity: 100, unit: 'g', preparationNote: '', allergens: [],
      estimatedNutrition: { kcal: target.kcal.target, proteinG: target.proteinG.target, carbsG: target.carbsG.target,
        fatG: target.fatG.target, fiberG: target.fiberG!.target },
    }] })) };
    const request = { auth: { uid }, data: { requestId: randomUUID() } } as unknown as CallableRequest;
    const { generationId } = await requestNutritionPlanGenerationHandler(request, db);
    return { uid, user, output, generationId };
  }

  it('persists only the revalidated corrected portions, once, without diagnostics or raw composition metadata', async () => {
    const { uid, user, output, generationId } = await fixture();
    try {
      output.meals[0].foods[0].estimatedNutrition.proteinG *= 1.12;
      const before = structuredClone(output);
      const generatePlan = vi.fn().mockResolvedValue({ output, model: 'synthetic',
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, latencyMs: 0 });
      expect(await processNutritionGenerationJob(uid, generationId, { generatePlan }, db)).toBe(true);
      expect(generatePlan).toHaveBeenCalledTimes(1);
      const saved = (await user.collection('nutritionPlans').doc(generationId).get()).data()!;
      expect(saved.generationMetadata.corrected).toBe(true);
      expect(saved.generationMetadata.attempts).toBe(1);
      expect(saved.diagnostics).toBeUndefined();
      const item = saved.meals[0].options[0].foods[0];
      expect(item.quantity).toBeGreaterThan(0); expect(item.quantity).toBeLessThan(100);
      expect(item.ingredients).toBeUndefined();
      for (const nutrient of NUTRIENTS) expect(item.estimatedNutrition[nutrient]).toBeCloseTo(
        before.meals[0].foods[0].estimatedNutrition[nutrient] * item.quantity / 100, 8);
      expect((await user.collection('nutritionGenerationJobs').doc(generationId).get()).get('status')).toBe('completed');
      expect(await processNutritionGenerationJob(uid, generationId, { generatePlan }, db)).toBe(false);
      expect(generatePlan).toHaveBeenCalledTimes(1);
    } finally { await deleteUserNutritionResources(uid, db); await db.recursiveDelete(user); }
  });

  it('never persists an unsafe plan even if an earlier meal has a macro deviation', async () => {
    const { uid, user, output, generationId } = await fixture();
    try {
      output.meals[0].foods[0].estimatedNutrition.proteinG *= 4;
      output.meals[1].foods[0].allergens = ['milk'];
      const generatePlan = vi.fn().mockResolvedValue({ output, model: 'synthetic',
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, latencyMs: 0 });
      expect(await processNutritionGenerationJob(uid, generationId, { generatePlan }, db)).toBe(false);
      expect(generatePlan).toHaveBeenCalledTimes(1);
      expect((await user.collection('nutritionPlans').get()).empty).toBe(true);
      const job = await user.collection('nutritionGenerationJobs').doc(generationId).get();
      expect(job.get('status')).toBe('failed');
      expect(job.get('errorCode')).toBe('AI_SAFETY_VALIDATION_FAILED');
      expect(job.get('aiAttemptCount')).toBe(1);
      expect(job.get('diagnostics')).toBeUndefined();
    } finally { await deleteUserNutritionResources(uid, db); await db.recursiveDelete(user); }
  });
});
