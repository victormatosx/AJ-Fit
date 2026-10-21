import { approveReview } from './reviewFixture';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebaseAdmin';
import { loadGenerationContext } from '../generation/context';
import { requestNutritionMealAlternativeHandler, MEAL_ALTERNATIVE_COOLDOWN_MS } from '../generation/mealAlternativeRequest';
import { restoreNutritionPlanHandler } from '../plans/restore';
import type { NutritionAiProvider } from '../ai/provider';
import { deleteUserNutritionResources } from '../../accountDeletion/firestoreCleanup/resources';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('meal alternative + plan restore (emulator)', () => {
  it('generates a validated alternative without touching the original plan, and enforces cooldown/ownership', async () => {
    const uid = `nutrition-alt-${randomUUID()}`;
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
    const lunchTarget = context.engine.mealTargets[1];
    // Diet-quality-v3 (2026-10-10): no catalog seeding needed — the AI's
    // alternative is free-form, matched directly against the deterministic target.
    const altItem = (name: string) => ({ name, ingredients: [{ name, origin: 'plant' as const }], quantity: 150, unit: 'g', preparationNote: '',
      estimatedNutrition: { kcal: lunchTarget.kcal.target, proteinG: lunchTarget.proteinG.target,
        carbsG: lunchTarget.carbsG.target, fatG: lunchTarget.fatG.target, fiberG: lunchTarget.fiberG?.target ?? 0 },
      allergens: [] });

    const planId = randomUUID();
    const planRef = user.collection('nutritionPlans').doc(planId);
    await planRef.set({
      planId, generationId: planId, status: 'active',
      meals: [
        { slot: 'breakfast', recommendedOptionId: 'breakfast-1', options: [{ id: 'breakfast-1', foods: [], totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } }] },
        { slot: 'lunch', recommendedOptionId: 'lunch-1', options: [{ id: 'lunch-1',
          foods: [{ name: 'original-food', quantity: 100, unit: 'g', preparationNote: '',
            estimatedNutrition: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 0 }, allergens: [] }],
          totals: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 0 } }] },
      ],
      dailyTotals: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 0 },
      createdAt: now, activatedAt: now, archivedAt: null,
    });

    const output = { recommendedOptionIndex: 0, options: [
      { foods: [altItem('Frango grelhado com batata doce')] }, { foods: [altItem('Peixe assado com legumes')] },
    ] };
    const generateMealAlternative = vi.fn().mockResolvedValue({
      output, model: 'fake', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1,
    });
    const provider: NutritionAiProvider = { reviewPlan: approveReview, generatePlan: vi.fn(), generateMealAlternative };
    const request = (data: Record<string, unknown>) => ({
      auth: { uid }, data: { requestId: randomUUID(), ...data },
    } as unknown as CallableRequest);

    const firstRequestId = randomUUID();
    const result = await requestNutritionMealAlternativeHandler(
      request({ requestId: firstRequestId, planId, slot: 'lunch' }), db, provider,
    );
    expect(result.recommendedOptionId).toBeTruthy();
    const alternativeDoc = await user.collection('nutritionMealAlternatives').doc(result.alternativeId).get();
    expect(alternativeDoc.get('planId')).toBe(planId);
    expect(alternativeDoc.get('slot')).toBe('lunch');

    const replay = await requestNutritionMealAlternativeHandler(
      request({ requestId: firstRequestId, planId, slot: 'lunch' }), db, provider,
    );
    expect(replay).toEqual(result);
    expect(generateMealAlternative).toHaveBeenCalledTimes(1);

    // The original plan's lunch option is untouched.
    const planAfter = await planRef.get();
    expect(planAfter.get('meals')[1].options[0].foods[0].name).toBe('original-food');
    expect(planAfter.get('status')).toBe('active');

    // Cooldown blocks an immediate second request.
    await expect(requestNutritionMealAlternativeHandler(request({ planId, slot: 'lunch' }), db, provider))
      .rejects.toThrow('MEAL_ALTERNATIVE_COOLDOWN');

    // A different user can never read/target this user's plan.
    const otherUid = `nutrition-alt-other-${randomUUID()}`;
    await expect(requestNutritionMealAlternativeHandler(
      { auth: { uid: otherUid }, data: { requestId: randomUUID(), planId, slot: 'lunch' } } as unknown as CallableRequest, db, provider,
    )).rejects.toThrow('PLAN_NOT_FOUND');

    // An unknown meal slot on an otherwise valid plan is rejected before any AI call.
    await db.collection('nutritionRateLimits').doc(uid).update({ lastMealAlternativeAt: Timestamp.fromMillis(Date.now() - MEAL_ALTERNATIVE_COOLDOWN_MS - 1) });
    await expect(requestNutritionMealAlternativeHandler(request({ planId, slot: 'supper' }), db, provider))
      .rejects.toThrow('MEAL_SLOT_NOT_IN_PLAN');

    await db.collection('nutritionRateLimits').doc(uid).update({
      lastMealAlternativeAt: Timestamp.fromMillis(Date.now() - MEAL_ALTERNATIVE_COOLDOWN_MS - 1),
    });
    const deletionRaceRequestId = randomUUID();
    const deletionRaceProvider: NutritionAiProvider = { reviewPlan: approveReview,
      generatePlan: vi.fn(),
      generateMealAlternative: vi.fn().mockImplementation(async () => {
        await db.collection('accountDeletionLocks').doc(uid).set({ status: 'REQUESTED' });
        return { output, model: 'fake', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, latencyMs: 1 };
      }),
    };
    await expect(requestNutritionMealAlternativeHandler(
      request({ requestId: deletionRaceRequestId, planId, slot: 'lunch' }), db, deletionRaceProvider,
    )).rejects.toThrow('ACCOUNT_INACTIVE');
    expect((await user.collection('nutritionMealAlternatives').doc(deletionRaceRequestId).get()).exists).toBe(false);

    await deleteUserNutritionResources(uid, db);
    expect((await user.collection('nutritionMealAlternatives').get()).empty).toBe(true);
  });

  it('restores an archived plan without any AI call, archiving the current active plan, owner-only', async () => {
    const uid = `nutrition-restore-${randomUUID()}`;
    const user = db.collection('users').doc(uid);
    const now = Timestamp.now();
    const activeId = randomUUID();
    const archivedId = randomUUID();
    const basePlan = { meals: [], dailyTotals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 } };
    await db.collection('nutritionRolloutConfig').doc('active').set({
      nutritionEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
      nutritionPlanGenerationEnabled: { schemaVersion: 1, enabled: true, percentage: 100 },
    });
    await user.collection('nutritionPlans').doc(activeId).set({ ...basePlan, planId: activeId, generationId: activeId,
      status: 'active', createdAt: now, activatedAt: now, archivedAt: null });
    await user.collection('nutritionPlans').doc(archivedId).set({ ...basePlan, planId: archivedId, generationId: archivedId,
      status: 'archived', createdAt: Timestamp.fromMillis(now.toMillis() - 1000), activatedAt: now, archivedAt: now });
    await db.collection('nutritionRateLimits').doc(uid).set({ ownerUid: uid, activePlanId: activeId, updatedAt: now });

    const request = (planId: string, forUid = uid) => ({ auth: { uid: forUid }, data: { planId } } as unknown as CallableRequest);

    // Not the owner — never finds the plan.
    await expect(restoreNutritionPlanHandler(request(archivedId, 'someone-else'), db)).rejects.toThrow('PLAN_NOT_FOUND');
    // Restoring an already-active plan is rejected (nothing to restore).
    await expect(restoreNutritionPlanHandler(request(activeId), db)).rejects.toThrow('PLAN_NOT_ARCHIVED');

    const concurrent = await Promise.allSettled([
      restoreNutritionPlanHandler(request(archivedId), db),
      restoreNutritionPlanHandler(request(archivedId), db),
    ]);
    expect(concurrent.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect((concurrent.find((entry) => entry.status === 'fulfilled') as PromiseFulfilledResult<{ planId: string }>).value.planId)
      .toBe(archivedId);

    const restoredDoc = await user.collection('nutritionPlans').doc(archivedId).get();
    const previouslyActiveDoc = await user.collection('nutritionPlans').doc(activeId).get();
    expect(restoredDoc.get('status')).toBe('active');
    expect(restoredDoc.get('archivedAt')).toBeNull();
    expect(previouslyActiveDoc.get('status')).toBe('archived');

    // Exactly one active plan — the invariant restore must preserve.
    const activeQuery = await user.collection('nutritionPlans').where('status', '==', 'active').get();
    expect(activeQuery.size).toBe(1);
    expect(activeQuery.docs[0].id).toBe(archivedId);
    expect((await db.collection('nutritionRateLimits').doc(uid).get()).get('activePlanId')).toBe(archivedId);
  });
});
