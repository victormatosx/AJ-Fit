import { approveReview } from './reviewFixture';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { loadGenerationContext } from '../generation/context';
import { processNutritionGenerationJob } from '../generation/worker';
import { NutritionAiProviderError } from '../ai/provider';

async function validResult(uid: string) {
  const context = await loadGenerationContext(db, uid);
  return { model: 'mock', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    output: { meals: context.engine.mealTargets.map((target) => ({ slot: target.slot, foods: [{
      name: 'Arroz com feijão', ingredients: [{ name: 'Arroz', origin: 'plant' }],
      quantity: 100, unit: 'g', preparationNote: '', allergens: [],
      estimatedNutrition: { kcal: target.kcal.target, proteinG: target.proteinG.target,
        carbsG: target.carbsG.target, fatG: target.fatG.target, fiberG: target.fiberG?.target ?? 0 },
    }] })) } };
}

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

  it('recovers a lost callable response/reopen while running and after completion without a second job or plan', async () => {
    const { uid, root, request } = await fixture();
    const { generationId } = await requestNutritionPlanGenerationHandler(request, db, async () => true);
    const result = await validResult(uid);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const generatePlan = vi.fn(async () => { await blocked; return result; });
    const worker = processNutritionGenerationJob(uid, generationId, { reviewPlan: approveReview, generatePlan }, db);
    await vi.waitFor(() => expect(generatePlan).toHaveBeenCalledOnce());
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan: approveReview, generatePlan }, db)).toBe(false);
    const requests = await Promise.all(Array.from({ length: 5 }, () => requestNutritionPlanGenerationHandler(request, db, async () => true)));
    expect(requests.every((response) => response.generationId === generationId)).toBe(true);
    release(); expect(await worker).toBe(true);
    // A new app process has no local state; the enrollment still identifies the completed diet.
    expect(await requestNutritionPlanGenerationHandler(request, db, async () => true)).toEqual({ generationId });
    expect((await root.collection('onboardingNutritionState').doc('current').get()).get('autoGenerationId')).toBe(generationId);
    expect((await root.collection('nutritionGenerationJobs').get()).size).toBe(1);
    expect((await root.collection('nutritionPlans').get()).size).toBe(1);
    expect((await root.collection('nutritionPlans').doc(generationId).get()).get('status')).toBe('active');
    expect(generatePlan).toHaveBeenCalledOnce();
  });

  it('resumes an expired worker lease with the persisted attempt budget and transient provider retry', async () => {
    const { uid, root, request } = await fixture();
    const { generationId } = await requestNutritionPlanGenerationHandler(request, db, async () => true);
    const ref = root.collection('nutritionGenerationJobs').doc(generationId);
    await ref.update({ status: 'running', aiAttemptCount: 1, leaseUntil: Timestamp.fromMillis(0), nextAttemptAt: Timestamp.fromMillis(0) });
    const generatePlan = vi.fn().mockRejectedValueOnce(new NutritionAiProviderError('AI_RATE_LIMIT', true))
      .mockResolvedValueOnce(await validResult(uid));
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan: approveReview, generatePlan }, db)).toBe(true);
    expect(generatePlan.mock.calls.map(([input]) => input.trace.attempt)).toEqual([2, 3]);
    expect((await ref.get()).get('aiAttemptCount')).toBe(3);
    expect((await ref.get()).get('status')).toBe('completed');
    expect((await root.collection('nutritionPlans').get()).size).toBe(1);
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan: approveReview, generatePlan }, db)).toBe(false);
    expect(generatePlan).toHaveBeenCalledTimes(2);
  });

  it('never spends a fourth AI attempt after a crash and permits only one explicit recovery job', async () => {
    const { uid, root, request } = await fixture();
    const { generationId } = await requestNutritionPlanGenerationHandler(request, db, async () => true);
    const ref = root.collection('nutritionGenerationJobs').doc(generationId);
    await ref.update({ status: 'validating', aiAttemptCount: 3, lastFailureCode: 'AI_MACRO_VALIDATION_FAILED',
      leaseUntil: Timestamp.fromMillis(0), nextAttemptAt: Timestamp.fromMillis(0) });
    const generatePlan = vi.fn();
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan: approveReview, generatePlan }, db)).toBe(false);
    expect(generatePlan).not.toHaveBeenCalled();
    expect((await ref.get()).get('errorCode')).toBe('AI_RETRY_EXHAUSTED');
    expect((await ref.get()).get('lastFailureCode')).toBe('AI_MACRO_VALIDATION_FAILED');
    expect((await ref.get()).get('status')).toBe('failed');
    expect((await root.collection('nutritionPlans').get()).empty).toBe(true);
    expect((await requestNutritionPlanGenerationHandler(request, db, async () => true)).generationId).toBe(generationId);
    const retryRequest = { ...request, data: { requestId: 'explicit-crash-recovery' } } as CallableRequest;
    await expect(requestNutritionPlanGenerationHandler(retryRequest, db)).rejects.toThrow('NUTRITION_GENERATION_COOLDOWN');
    await db.collection('nutritionRateLimits').doc(uid).update({ lastRequestedAt: Timestamp.fromMillis(0) });
    const recovered = await Promise.all(Array.from({ length: 5 }, () => requestNutritionPlanGenerationHandler(retryRequest, db)));
    expect(new Set(recovered.map((response) => response.generationId)).size).toBe(1);
    expect((await root.collection('nutritionGenerationJobs').get()).size).toBe(2);
    expect((await root.collection('onboardingNutritionState').doc('current').get()).get('latestGenerationId')).toBe(recovered[0].generationId);
  });

  it('recovers a transient Firestore persistence failure using the same job after lease expiry', async () => {
    const { uid, root, request } = await fixture();
    const { generationId } = await requestNutritionPlanGenerationHandler(request, db, async () => true);
    const ref = root.collection('nutritionGenerationJobs').doc(generationId);
    const result = await validResult(uid);
    const generatePlan = vi.fn().mockResolvedValue(result);
    const originalTransaction = db.runTransaction.bind(db);
    const reviewPlan = vi.fn().mockImplementationOnce(async input => {
      // First record the review operation, then fail precisely the activation transaction.
      vi.spyOn(db, 'runTransaction').mockImplementationOnce(originalTransaction)
        .mockRejectedValueOnce(Object.assign(new Error('emulated unavailable'), { code: 14 }));
      return approveReview(input);
    }).mockImplementation(approveReview);
    try {
      expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan, generatePlan }, db)).toBe(false);
    } finally { vi.restoreAllMocks(); }
    expect((await ref.get()).get('status')).toBe('validating');
    expect((await root.collection('nutritionPlans').get()).empty).toBe(true);
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan, generatePlan }, db)).toBe(false);
    expect(generatePlan).toHaveBeenCalledOnce();
    await ref.update({ leaseUntil: Timestamp.fromMillis(0), nextAttemptAt: Timestamp.fromMillis(0) });
    expect(await processNutritionGenerationJob(uid, generationId, { reviewPlan, generatePlan }, db)).toBe(true);
    expect(generatePlan.mock.calls.map(([input]) => input.trace.attempt)).toEqual([1, 2]);
    expect((await root.collection('nutritionGenerationJobs').get()).size).toBe(1);
    expect((await root.collection('nutritionPlans').get()).size).toBe(1);
    expect((await ref.get()).get('status')).toBe('completed');
  });

});
