import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionPlanGenerationHandler } from '../generation/request';
import { processNutritionGenerationJob } from '../generation/worker';
import { requestNutritionMealAlternativeHandler } from '../generation/mealAlternativeRequest';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';
import { normalizeFoodLogRecord } from '../shared/nutrition/foodLog/normalize';
import { catalogNutritionRevision } from '../shared/nutrition/catalog/binding';
import { equivalenceScore, nutritionFailure, restrictionFailure, verifiedEvidence } from '../catalogLinking/resolver';
import type { CatalogCandidate } from '../catalogLinking/search';
import type { RawAiFoodItem } from '../generation/domain';
import { approveReview, rejectReview } from './reviewFixture';

const callable = (uid: string, data: object) => ({ auth: { uid }, data } as CallableRequest);
const createdUsers: string[] = [];
const createdFoods: string[] = [];
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('independent review + durable budgets (Firestore Emulator)', () => {
  afterEach(async () => {
    vi.unstubAllEnvs(); vi.restoreAllMocks();
    for (const uid of createdUsers.splice(0)) {
      await deleteUserNutritionResources(uid, db); await db.recursiveDelete(db.collection('users').doc(uid));
      await db.collection('accountDeletionLocks').doc(uid).delete();
    }
    for (const id of createdFoods.splice(0)) await db.collection('foodLogCatalog').doc(id).delete();
  });
  async function seed(withPrior = false) {
    vi.stubEnv('NUTRITION_CATALOG_LINKING_ENABLED', 'false');
    const uid = `dual-ai-${randomUUID()}`; createdUsers.push(uid);
    const user = db.collection('users').doc(uid); const now = Timestamp.now();
    await user.set({ profile: { birthDate: Timestamp.fromDate(new Date('1995-01-01')), height: 175 } });
    await user.collection('questionnaires').doc('q').set({ createdAt: now, version: 1,
      answers: { sex: 'm', goal: 'health', weight: 70, days: 3 } });
    await user.collection('nutritionFoods').doc('custom_mandioca').set({ name: 'Mandioca cozida' });
    await user.collection('nutritionProfile').doc('current').set({ questionnaireVersion: 1,
      nonTrainingActivityLevel: 'active', mealSlots: ['breakfast', 'lunch'], dietaryPattern: 'vegetarian',
      preferredFoodIds: ['custom_mandioca'], usualFoodIds: [], excludedFoodIds: [], excludedAllergens: [],
      excludedSubstances: ['lactose'], supplements: ['whey_or_protein'], pregnant: false,
      breastfeeding: false, varietyPreference: 'indifferent', updatedAt: now });
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 } });
    if (withPrior) {
      await user.collection('nutritionPlans').doc('prior-plan').set({ planId: 'prior-plan', status: 'active', marker: 'preserve' });
      await db.collection('nutritionRateLimits').doc(uid).set({ ownerUid: uid, activePlanId: 'prior-plan' });
    }
    const context = await loadGenerationContext(db, uid);
    // Synthetic values exercise the engine tolerances, not a real cassava nutrient claim.
    const output = { meals: context.engine.mealTargets.map(t => ({ slot: t.slot, foods: [{
      name: 'Mandioca cozida', quantity: 300, unit: 'g', preparationNote: '',
      ingredients: [{ name: 'Mandioca cozida', origin: 'plant' }], allergens: [],
      estimatedNutrition: { kcal: t.kcal.target, proteinG: t.proteinG.target, carbsG: t.carbsG.target,
        fatG: t.fatG.target, fiberG: t.fiberG!.target },
    }] })) };
    const response = (value: unknown = output) => ({ output: value, model: 'mock-creator', latencyMs: 1,
      usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0 } });
    const provider = { generatePlan: vi.fn().mockResolvedValue(response()), reviewPlan: vi.fn(approveReview) };
    const { generationId } = await requestNutritionPlanGenerationHandler(callable(uid, { requestId: randomUUID() }), db);
    const job = user.collection('nutritionGenerationJobs').doc(generationId);
    const plan = user.collection('nutritionPlans').doc(generationId);
    return { uid, user, context, output, response, provider, generationId, job, plan };
  }

  it('creates a lactose-compatible vegetarian plan without catalog prerequisites, once across concurrent workers', async () => {
    const f = await seed();
    const results = await Promise.all(Array.from({ length: 4 }, () => processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(f.provider.generatePlan).toHaveBeenCalledTimes(1); expect(f.provider.reviewPlan).toHaveBeenCalledTimes(1);
    expect((await f.job.get()).get('aiCallCount')).toBe(2);
    expect((await f.job.get()).get('aiReservedUsd')).toBeLessThan(.03);
    expect(f.provider.generatePlan.mock.calls[0][0].foodNames.preferred).toEqual(['Mandioca cozida']);
    expect((await f.plan.get()).get('generationMetadata.review.calls')).toBe(2);
    const ops = await db.collection('nutritionAiOperations').where('generationId', '==', f.generationId).get();
    expect(ops.size).toBe(2); expect(ops.docs.map(d => d.get('agentRole')).sort()).toEqual(['creator', 'reviewer']);
    expect(ops.docs.find(d => d.get('agentRole') === 'reviewer')?.get('resultStatus')).toBe('validated');
    for (const op of ops.docs) { expect(op.get('inputTokens')).toBe(100); expect(op.get('output')).toBeUndefined(); }
  });
  it('corrects a rejected preference and activates only the independently approved second candidate', async () => {
    const f = await seed(true); const first = structuredClone(f.output);
    first.meals[0].foods[0].name = 'Banana'; first.meals[0].foods[0].ingredients[0].name = 'Banana';
    f.provider.generatePlan.mockResolvedValueOnce(f.response(first));
    f.provider.reviewPlan.mockImplementationOnce(rejectReview as typeof approveReview);
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(true);
    expect((await f.job.get()).get('aiCallCount')).toBe(4);
    expect((await f.plan.get()).get('meals')[0].options[0].foods[0].name).toBe('Mandioca cozida');
    expect((await f.user.collection('nutritionPlans').doc('prior-plan').get()).get('status')).toBe('archived');
    expect(f.provider.generatePlan.mock.calls[1][0].feedback).toContain('reviewer');
  });
  it('preserves the previous active plan after two rejected candidates and records closed rejection categories', async () => {
    const f = await seed(true); f.provider.reviewPlan.mockImplementation(rejectReview as typeof approveReview);
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(false);
    expect((await f.plan.get()).exists).toBe(false);
    expect((await f.user.collection('nutritionPlans').doc('prior-plan').get()).data()).toMatchObject({ status: 'active', marker: 'preserve' });
    expect((await f.job.get()).get('errorCode')).toBe('AI_RETRY_EXHAUSTED');
    expect((await f.job.get()).get('lastFailureCode')).toBe('AI_REVIEW_INSUFFICIENT_INFORMATION');
    expect((await f.job.get()).get('aiCallCount')).toBe(4);
    const op = await db.collection('nutritionAiOperations').doc(`${f.generationId}-reviewer-4`).get();
    expect(op.get('issueCategories')).toEqual(['insufficient_information']); expect(op.get('reason')).toBeUndefined();
  });
  it('recovers an invalid reviewer response without recreating the candidate or losing validating state', async () => {
    const f = await seed(); f.provider.reviewPlan.mockResolvedValueOnce(f.response({ status: 'approved' }) as never);
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(true);
    expect(f.provider.generatePlan).toHaveBeenCalledTimes(1); expect(f.provider.reviewPlan).toHaveBeenCalledTimes(2);
    expect((await f.job.get()).get('aiCallCount')).toBe(3);
  });
  it('never activates during reviewer unavailability and exhausts at four total calls', async () => {
    const f = await seed(true); f.provider.reviewPlan.mockRejectedValue(new Error('network unavailable'));
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(false);
    expect(f.provider.generatePlan).toHaveBeenCalledTimes(1); expect(f.provider.reviewPlan).toHaveBeenCalledTimes(3);
    expect((await f.plan.get()).exists).toBe(false); expect((await f.job.get()).get('aiCallCount')).toBe(4);
    expect((await f.job.get()).get('lastFailureCode')).toBe('AI_REVIEW_UNAVAILABLE');
    expect((await f.user.collection('nutritionPlans').doc('prior-plan').get()).get('status')).toBe('active');
  });
  it('retains a possibly paid call reservation after failure and reuses the same job within the remaining budget', async () => {
    const f = await seed(); f.provider.generatePlan.mockRejectedValueOnce(Object.assign(new Error('emulated transport interrupted'), { code: 14 }));
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(false);
    expect((await f.job.get()).get('aiCallCount')).toBe(1);
    await f.job.update({ leaseUntil: Timestamp.fromMillis(0), nextAttemptAt: Timestamp.fromMillis(0) });
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(true);
    expect((await f.job.get()).get('aiCallCount')).toBe(3);
    expect((await db.collection('nutritionAiOperations').doc(`${f.generationId}-creator-1`).get()).get('resultStatus')).toBe('pending');
  });
  it('fences an old worker after lease takeover, including during an in-flight review', async () => {
    const f = await seed(); let release!: () => void; let entered!: () => void;
    const arrived = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
    f.provider.reviewPlan.mockImplementationOnce(async req => { entered(); await gate; return approveReview(req); });
    const first = processNutritionGenerationJob(f.uid, f.generationId, f.provider, db); await arrived;
    await f.job.update({ leaseUntil: Timestamp.fromMillis(0), nextAttemptAt: Timestamp.fromMillis(0) });
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(true);
    release(); expect(await first).toBe(false);
    expect((await f.job.get()).get('status')).toBe('completed'); expect((await f.job.get()).get('aiCallCount')).toBe(4);
    expect((await f.user.collection('nutritionPlans').get()).size).toBe(1);
  });
  it('replays approved alternatives and never resets the call budget for a failed alternative request ID', async () => {
    const f = await seed(); await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db);
    const target = f.output.meals[0].foods;
    const provider = { ...f.provider, generateMealAlternative: vi.fn().mockResolvedValue(f.response({
      recommendedOptionIndex: 0, options: [{ foods: target }, { foods: target }] })) };
    const req = callable(f.uid, { requestId: randomUUID(), planId: f.generationId, slot: 'breakfast' });
    const first = await requestNutritionMealAlternativeHandler(req, db, provider);
    expect(await requestNutritionMealAlternativeHandler(req, db, provider)).toEqual(first);
    expect(provider.generateMealAlternative).toHaveBeenCalledTimes(1);
    await expect(requestNutritionMealAlternativeHandler({ ...req, data: { ...req.data, slot: 'lunch' } }, db, provider))
      .rejects.toThrow('INVALID_REQUEST');
    const other = await seed(); await processNutritionGenerationJob(other.uid, other.generationId, other.provider, db);
    const foreign = { ...other.provider, generateMealAlternative: vi.fn() };
    await expect(requestNutritionMealAlternativeHandler(callable(other.uid, { ...req.data, planId: other.generationId }), db, foreign))
      .rejects.toThrow('INVALID_REQUEST');
    expect(foreign.generateMealAlternative).not.toHaveBeenCalled();
    expect((await db.collection('nutritionAiOperations').doc(`${req.data.requestId}-budget`).get()).get('ownerUid')).toBe(f.uid);
    await db.collection('nutritionRateLimits').doc(f.uid).update({ lastMealAlternativeAt: Timestamp.fromMillis(0) });
    const badReq = callable(f.uid, { requestId: randomUUID(), planId: f.generationId, slot: 'breakfast' });
    provider.reviewPlan = vi.fn(rejectReview as typeof approveReview);
    await expect(requestNutritionMealAlternativeHandler(badReq, db, provider)).rejects.toThrow('AI_RETRY_EXHAUSTED');
    const usedCreators = provider.generateMealAlternative.mock.calls.length;
    await expect(requestNutritionMealAlternativeHandler(badReq, db, provider)).rejects.toThrow('AI_RETRY_EXHAUSTED');
    expect(provider.generateMealAlternative).toHaveBeenCalledTimes(usedCreators);
    expect((await db.collection('nutritionAiOperations').doc(`${badReq.data.requestId}-budget`).get()).get('aiCallCount')).toBe(4);
    expect((await f.plan.get()).get('status')).toBe('active');
  });
  it('rejects evidence revoked during review even though the reviewer approves the product', async () => {
    const f = await seed(true); const output = structuredClone(f.output); const now = Timestamp.now();
    for (let i = 0; i < output.meals.length; i++) {
      const item = output.meals[i].foods[0]; const name = `Whey sem lactose ${i}`;
      const food = normalizeFoodLogRecord({ source: { type: 'off', sourceId: `9988776${i}`, sourceName: 'Synthetic label' },
        name, brand: { name: 'Marca' }, status: 'active', category: 'other',
        nutritionPer100g: Object.fromEntries(Object.entries(item.estimatedNutrition).map(([k, v]) => [k, v / 3])) as typeof item.estimatedNutrition,
        provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'Synthetic' } }, 'test-review');
      food.safetyEvidence = { schemaVersion: 1, nutritionRevision: catalogNutritionRevision(food),
        reference: 'Synthetic reviewed label', absentSubstances: ['lactose'], dietaryPatterns: ['vegetarian'], compositionReviewed: true };
      createdFoods.push(food.id); await db.collection('foodLogCatalog').doc(food.id).set({ ...food, createdAt: now, updatedAt: now });
      item.name = `${name} Marca`; item.ingredients = [{ name: item.name, origin: 'dairy' }];
      const candidate = { collection: 'foodLogCatalog', food } as CatalogCandidate;
      expect(nutritionFailure(candidate)).toBeNull();
      expect(restrictionFailure(candidate, f.context.profile, { preferred: [], usual: [], excluded: [] })).toBeNull();
      expect(verifiedEvidence(candidate)).not.toBeNull();
      expect(equivalenceScore(item as RawAiFoodItem, candidate)).toBeGreaterThanOrEqual(100);
    }
    f.provider.generatePlan.mockResolvedValue(f.response(output));
    f.provider.reviewPlan.mockImplementation(async req => {
      expect((req.evidence as unknown[]).length).toBe(2);
      await db.collection('foodLogCatalog').doc(createdFoods[0]).update({ 'safetyEvidence.reference': 'revoked during review' });
      return approveReview(req);
    });
    expect(await processNutritionGenerationJob(f.uid, f.generationId, f.provider, db)).toBe(false);
    expect((await f.job.get()).get('errorCode')).toBe('AI_DETERMINISTIC_SAFETY_BLOCKED');
    expect((await f.job.get()).get('lastFailureCode')).toBe('AI_SAFETY_VALIDATION_FAILED');
    expect((await f.plan.get()).exists).toBe(false);
    expect((await db.collection('nutritionAiOperations').doc(`${f.generationId}-reviewer-2`).get()).get('resultStatus')).toBe('approved');
    expect((await f.user.collection('nutritionPlans').doc('prior-plan').get()).get('status')).toBe('active');
  });
});
