import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { requestNutritionPlanGenerationHandler } from '../generation/request';

async function fixture(enrolled = true) {
  const uid = `initial-nutrition-${randomUUID()}`;
  const root = db.collection('users').doc(uid);
  const now = Timestamp.now();
  await root.set({ metadata: { createdAt: now }, profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175 } });
  if (enrolled) await root.collection('onboardingNutritionState').doc('current').set({ sessionId: randomUUID(), createdAt: now });
  await root.collection('questionnaires').doc('q').set({ createdAt: now, answers: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), weight: 70, height: 175, sex: 'm', goal: 'health', days: 3 } });
  await root.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1,
    nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'omnivore',
    preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: [], supplements: [],
    pregnant: false, breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now });
  await root.collection('workoutProgramState').doc('active').set({ programId: 'p' });
  await root.collection('workoutProgramState').doc('scheduleConfig').set({ timezone: 'America/Sao_Paulo' });
  await root.collection('workoutPrograms').doc('p').set({ prescribedTrainingFrequency: 3 });
  await db.collection('nutritionRolloutConfig').doc('active').set({ nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 }, nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 } });
  await db.collection('nutritionRolloutConfig').doc('onboardingAutomatic').set({ schemaVersion: 1, enabled: true, percentage: 100 });
  const request = { auth: { uid, token: {} }, data: { intent: 'initial_onboarding' } } as unknown as CallableRequest;
  return { uid, root, request };
}
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('first onboarding generation', () => {
  it('defaults automatic OFF without changing manual generation or existing jobs', async () => {
    const { request, root } = await fixture();
    await db.collection('nutritionRolloutConfig').doc('onboardingAutomatic').delete();
    expect(await requestNutritionPlanGenerationHandler(request, db, async () => { throw new Error('must not call RevenueCat'); })).toMatchObject({ status: 'disabled' });
    expect((await root.collection('nutritionGenerationJobs').get()).empty).toBe(true);
    const manual = await requestNutritionPlanGenerationHandler({ ...request, data: { requestId: 'manual-disabled-001' } } as CallableRequest, db);
    expect(manual.generationId).toBeTruthy();
    expect((await root.collection('nutritionGenerationJobs').doc(manual.generationId).get()).get('status')).toBe('queued');
  });
  it('fences an automatic request disabled while RevenueCat preflight was running', async () => {
    const { request, root } = await fixture();
    const result = await requestNutritionPlanGenerationHandler(request, db, async () => {
      await db.collection('nutritionRolloutConfig').doc('onboardingAutomatic').set({ schemaVersion: 1, enabled: false, percentage: 100 });
      return true;
    });
    expect(result.status).toBe('disabled');
    expect((await root.collection('nutritionGenerationJobs').get()).empty).toBe(true);
  });
  it('serializes concurrent devices and persists the first attempt even after terminal failure and another manual request', async () => {
    const { root, request, uid } = await fixture();
    const calls = await Promise.all(Array.from({ length: 4 }, () => requestNutritionPlanGenerationHandler(request, db, async () => true)));
    expect(new Set(calls.map((call) => call.generationId)).size).toBe(1);
    const id = calls[0].generationId;
    expect((await root.collection('nutritionGenerationJobs').get()).size).toBe(1);
    await root.collection('nutritionGenerationJobs').doc(id).update({ status: 'failed' });
    await db.collection('nutritionRateLimits').doc(uid).update({ activeGenerationId: null, lastRequestedAt: Timestamp.fromMillis(0), lastRequestId: 'different-request' });
    expect((await requestNutritionPlanGenerationHandler(request, db, async () => true)).generationId).toBe(id);
    expect((await root.collection('nutritionGenerationJobs').get()).size).toBe(1);
    const manual = await requestNutritionPlanGenerationHandler({ ...request, data: { requestId: 'explicit-retry-0001' } } as CallableRequest, db);
    expect(manual.generationId).not.toBe(id);
    expect((await root.collection('onboardingNutritionState').doc('current').get()).get('latestGenerationId')).toBe(manual.generationId);
    expect((await root.collection('nutritionGenerationJobs').doc(manual.generationId).get()).get('initialOnboarding')).toBe(true);
    expect((await requestNutritionPlanGenerationHandler(request, db, async () => true)).generationId).toBe(id);
  });
  it('does not enroll legacy accounts or regenerate existing plans', async () => {
    const old = await fixture(false);
    expect(await requestNutritionPlanGenerationHandler(old.request, db, async () => true)).toMatchObject({ status: 'skipped' });
    const current = await fixture();
    await current.root.collection('nutritionPlans').doc('existing').set({ status: 'archived' });
    expect(await requestNutritionPlanGenerationHandler(current.request, db, async () => true)).toMatchObject({ status: 'skipped' });
    expect((await current.root.collection('nutritionGenerationJobs').get()).empty).toBe(true);
  });
  it('requires authoritative entitlement, a ready workout, and verified password email', async () => {
    const { root, request } = await fixture();
    await expect(requestNutritionPlanGenerationHandler(request, db, async () => false)).rejects.toThrow('NUTRITION_NOT_ENTITLED');
    await root.collection('workoutProgramState').doc('scheduleConfig').delete();
    await expect(requestNutritionPlanGenerationHandler(request, db, async () => true)).rejects.toThrow('NUTRITION_CONTEXT_PENDING');
    const password = { ...request, auth: { uid: request.auth!.uid, token: { firebase: { identities: { email: ['test@example.test'] } }, email_verified: false } } } as unknown as CallableRequest;
    await expect(requestNutritionPlanGenerationHandler(password, db, async () => true)).rejects.toThrow('email_verification_required');
    expect((await root.collection('nutritionGenerationJobs').get()).empty).toBe(true);
  });
  it('joins a racing explicit request instead of creating a second first diet', async () => {
    const { request, root } = await fixture();
    const [automatic, manual] = await Promise.all([
      requestNutritionPlanGenerationHandler(request, db, async () => true),
      requestNutritionPlanGenerationHandler({ ...request, data: { requestId: 'manual-race-0001' } } as CallableRequest, db),
    ]);
    expect(automatic.generationId).toBe(manual.generationId);
    const jobs = await root.collection('nutritionGenerationJobs').get();
    expect(jobs.size).toBe(1);
    expect(jobs.docs[0].get('initialOnboarding')).toBe(true);
  });

});
