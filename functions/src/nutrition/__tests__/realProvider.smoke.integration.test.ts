import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { OpenAiNutritionProvider } from '../ai/provider';
import { MAX_AI_CALLS, PROMPT_VERSION } from '../ai/config';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';

// Explicit opt-in: calls the real provider (at most four calls across both roles),
// but all user/profile/job/plan writes MUST stay in the Firestore emulator.
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST
  && process.env.NUTRITION_REAL_AI_SMOKE === '1' && process.env.OPENAI_API_KEY);

describe.skipIf(!enabled)('real AI with synthetic context and emulator persistence', () => {
  it('queues, generates, validates, persists and exposes one active plan', async () => {
    const uid = `synthetic-ai-smoke-${randomUUID()}`;
    const user = db.collection('users').doc(uid);
    const now = Timestamp.now();
    await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1996-01-01')), height: 175 } });
    await user.collection('nutritionProfile').doc('current').set({
      questionnaireVersion: 1, nonTrainingActivityLevel: 'active',
      mealSlots: ['breakfast', 'lunch', 'afternoon_snack', 'dinner'], dietaryPattern: 'omnivore',
      preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], supplements: [], pregnant: false,
      breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now,
    });
    await user.collection('questionnaires').doc('synthetic').set({ createdAt: now, version: 1,
      answers: { birthDate: Timestamp.fromDate(new Date('1996-01-01')), height: 175,
        weight: 70, sex: 'm', goal: 'health', days: 3 } });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    const { generationId } = await requestNutritionPlanGenerationHandler({
      auth: { uid }, data: { requestId: randomUUID() },
    } as unknown as CallableRequest, db);
    const jobRef = user.collection('nutritionGenerationJobs').doc(generationId);
    let calls = 0;
    const realProvider = new OpenAiNutritionProvider(process.env.OPENAI_API_KEY!);
    const success = await processNutritionGenerationJob(uid, generationId, {
      generatePlan: async (request) => { calls++; return realProvider.generatePlan(request); },
      reviewPlan: async (request) => { calls++; return realProvider.reviewPlan(request); },
    }, db);
    const job = await jobRef.get();
    // Log only operational enums/counts, never the generated diet or profile.
    console.info(JSON.stringify({ synthetic: true, generationId, status: job.get('status'),
      failureCode: job.get('errorCode'), calls }));
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(MAX_AI_CALLS);
    expect(success).toBe(true);
    expect(job.get('status')).toBe('completed');
    const plan = await user.collection('nutritionPlans').doc(generationId).get();
    expect(plan.get('status')).toBe('active');
    expect(plan.get('meals')).toHaveLength(4);
    expect(plan.get('versions.promptVersion')).toBe(PROMPT_VERSION);
    expect(plan.get('generationMetadata.review.calls')).toBe(calls);
    expect((await user.collection('nutritionPlans').where('status', '==', 'active').get()).size).toBe(1);
    expect(await processNutritionGenerationJob(uid, generationId, {
      generatePlan: async () => { throw new Error('duplicate provider call'); },
    }, db)).toBe(false);
  }, 300_000);
});
