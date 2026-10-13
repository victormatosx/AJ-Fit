import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildNutritionWeeklySummary,
  buildNutritionWeeklyWeightSummary,
} from '../../nutrition/weekly';
import type { NutritionMealOption } from '../../types/nutrition';
import type { NutritionProfileAnswers } from '../nutritionProfile';

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!enabled)('Nutrition client journey (Firestore Emulator + Rules)', () => {
  let env: RulesTestEnvironment;
  let clientDb: Firestore;
  const uid = 'nutrition-client-e2e';
  const otherUid = 'nutrition-client-other';
  let profileService: typeof import('../nutritionProfile');
  let diaryService: typeof import('../nutritionDiary');
  let foodsService: typeof import('../nutritionFoods');
  let recipesService: typeof import('../nutritionRecipes');
  let favoritesService: typeof import('../nutritionFavorites');

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'ajfit-rules-test',
      firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
    });
    clientDb = env.authenticatedContext(uid).firestore() as unknown as Firestore;
    vi.doMock('../../lib/firebase', () => ({ db: clientDb }));
    profileService = await import('../nutritionProfile');
    diaryService = await import('../nutritionDiary');
    foodsService = await import('../nutritionFoods');
    recipesService = await import('../nutritionRecipes');
    favoritesService = await import('../nutritionFavorites');

    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', uid), { marker: 'owner' });
      await setDoc(doc(adminDb, 'users', otherUid), { marker: 'other' });
      await setDoc(doc(adminDb, 'nutritionFoods', 'nf_e2e_rice'), {
        id: 'nf_e2e_rice',
        name: 'Arroz E2E',
        aliases: [],
        category: 'cereal',
        source: { type: 'manual', sourceId: 'nf_e2e_rice', sourceName: 'E2E fixture' },
        nutritionPer100g: { kcal: 100, proteinG: 4, carbsG: 20, fatG: 1, fiberG: 2 },
        dietaryFlags: { vegetarian: true, vegan: true, pescatarian: true },
        allergens: [],
        generationStatus: 'approved',
        catalogVersion: 'client-e2e-v1',
        searchPrefixes: ['ar', 'arr', 'arro', 'arroz'],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
  });

  afterAll(async () => {
    vi.doUnmock('../../lib/firebase');
    await env.cleanup();
  });

  it('persists profile, actual intake and favorites independently from the recommended plan', async () => {
    const answers: NutritionProfileAnswers = {
      questionnaireVersion: 1,
      progressionPace: 'moderate' as const,
      nutritionGoalCategory: 'maintenance' as const,
      targetWeightKg: 68,
      nonTrainingActivityLevel: 'active' as const,
      mealSlots: ['breakfast', 'lunch'],
      dietaryPattern: 'omnivore' as const,
      preferredFoodIds: [],
      usualFoodIds: [],
      excludedFoodIds: [],
      excludedAllergens: [],
      supplements: [],
      pregnant: false,
      breastfeeding: false,
      varietyPreference: 'indifferent' as const,
    };
    await profileService.createNutritionProfile(uid, answers);
    await expect(profileService.loadNutritionProfile(uid)).resolves.toMatchObject({ targetWeightKg: 68 });
    await profileService.updateNutritionProfile(uid, { ...answers, targetWeightKg: 67 });
    await expect(profileService.loadNutritionProfile(uid)).resolves.toMatchObject({ targetWeightKg: 67 });
    expect(() => profileService.validateNutritionProfileAnswers({ ...answers, extra: true }))
      .toThrow('INVALID_NUTRITION_PROFILE');
    await assertFails(setDoc(doc(clientDb, 'users', uid, 'nutritionProfile', 'extra'), {
      ...answers,
      extra: true,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(getDoc(doc(clientDb, 'users', otherUid, 'nutritionProfile', 'current')));

    const planOption: NutritionMealOption = {
      id: 'lunch-1',
      foods: [{
        name: 'Arroz E2E', quantity: 100, unit: 'g', preparationNote: '',
        estimatedNutrition: { kcal: 100, proteinG: 4, carbsG: 20, fatG: 1, fiberG: 2 },
        allergens: [],
      }],
      totals: { kcal: 100, proteinG: 4, carbsG: 20, fatG: 1, fiberG: 2 },
    };
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', uid, 'nutritionPlans', 'plan-client-e2e'), {
        planId: 'plan-client-e2e',
        generationId: 'plan-client-e2e',
        status: 'active',
        meals: [{ slot: 'lunch', recommendedOptionId: planOption.id, options: [planOption] }],
        dailyTotals: planOption.totals,
        createdAt: Timestamp.now(),
        activatedAt: Timestamp.now(),
        archivedAt: null,
      });
    });
    const planBefore = (await getDoc(doc(clientDb, 'users', uid, 'nutritionPlans', 'plan-client-e2e'))).data();

    // Diet-quality-v3: "Registrar esta opção" never persists the recommended
    // plan item as-is — the user picks the real catalog food they ate, so
    // this always lands as a manual entry (`followedRecommendedOptionId`
    // stays null, `recommendedPlan != actualIntake`).
    await diaryService.addDiaryFood(uid, '2026-10-05', 'lunch', 'catalog_food', 'nf_e2e_rice', 100);
    let day = await diaryService.loadDiaryDay(uid, '2026-10-05');
    expect(day?.meals[0]).toMatchObject({ followedRecommendedOptionId: null });
    expect(day?.meals[0].items[0].snapshot).toMatchObject({ name: 'Arroz E2E', kcal: 100 });
    const itemId = day!.meals[0].items[0].id;

    await Promise.all([
      diaryService.updateDiaryEntryGrams(uid, '2026-10-05', 'lunch', itemId, 'catalog_food', 'nf_e2e_rice', 120),
      diaryService.updateDiaryEntryGrams(uid, '2026-10-05', 'lunch', itemId, 'catalog_food', 'nf_e2e_rice', 150),
    ]);
    day = await diaryService.loadDiaryDay(uid, '2026-10-05');
    expect([120, 150]).toContain(day?.meals[0].items[0].grams);
    expect(day?.meals[0].followedRecommendedOptionId).toBeNull();
    expect(day?.totals.kcal).toBe(day!.meals[0].items[0].snapshot.kcal);

    await diaryService.removeDiaryEntry(uid, '2026-10-05', 'lunch', itemId);
    expect((await diaryService.loadDiaryDay(uid, '2026-10-05'))?.meals).toEqual([]);

    const customId = await foodsService.createCustomFood(uid, {
      name: 'Comida própria',
      nutritionPer100g: { kcal: 200, proteinG: 10, carbsG: 25, fatG: 6, fiberG: 3 },
    });
    await diaryService.addDiaryFood(uid, '2026-10-05', 'lunch', 'custom_food', customId, 50);
    const recipeId = await recipesService.createNutritionRecipe(uid, {
      name: 'Receita E2E',
      ingredients: [{ foodId: 'nf_e2e_rice', grams: 200 }],
    });
    await diaryService.addDiaryFood(uid, '2026-10-05', 'breakfast', 'recipe', recipeId, 100);
    day = await diaryService.loadDiaryDay(uid, '2026-10-05');
    expect(day?.meals.flatMap((meal) => meal.items).map((item) => item.source).sort())
      .toEqual(['custom_food', 'recipe']);
    expect((await getDoc(doc(clientDb, 'users', uid, 'nutritionPlans', 'plan-client-e2e'))).data())
      .toEqual(planBefore);

    const recommendedFavoriteId = await favoritesService.addFavoriteMealOption(uid, {
      source: 'plan',
      planId: 'plan-client-e2e',
      slot: 'lunch',
      foods: planOption.foods,
      totals: planOption.totals,
    });
    const alternativeFavoriteId = await favoritesService.addFavoriteMealOption(uid, {
      source: 'alternative',
      alternativeId: 'alternative-client-e2e',
      slot: 'lunch',
      foods: planOption.foods,
      totals: planOption.totals,
    });
    // The first id toggle creates the canonical preferences document with
    // both independent arrays. Neither id toggle may touch meal snapshots.
    await favoritesService.toggleFavoriteFoodId(uid, customId);
    await favoritesService.toggleFavoriteRecipeId(uid, recipeId);
    let preferences = await favoritesService.loadNutritionPreferences(uid);
    expect(preferences).toMatchObject({ favoriteFoodIds: [customId], favoriteRecipeIds: [recipeId] });
    expect(preferences?.favoriteMealOptions?.map((favorite) => favorite.id))
      .toEqual([recommendedFavoriteId, alternativeFavoriteId]);
    const favorite = preferences!.favoriteMealOptions![1];
    // Using a favorite is the same "reference only" flow — the favorite's
    // free-form items are shown for reference, the real catalog food is
    // what actually gets logged.
    await diaryService.addDiaryFood(uid, '2026-10-06', favorite.slot, 'catalog_food', 'nf_e2e_rice', 100);
    expect((await diaryService.loadDiaryDay(uid, '2026-10-06'))?.meals[0].items[0].snapshot.name)
      .toBe('Arroz E2E');
    await favoritesService.removeFavoriteMealOption(uid, recommendedFavoriteId);
    expect((await favoritesService.loadNutritionPreferences(uid))?.favoriteMealOptions?.map((item) => item.id))
      .toEqual([alternativeFavoriteId]);
    await favoritesService.toggleFavoriteFoodId(uid, customId);
    preferences = await favoritesService.loadNutritionPreferences(uid);
    expect(preferences?.favoriteFoodIds).toEqual([]);
    expect(preferences?.favoriteRecipeIds).toEqual([recipeId]);
    expect(preferences?.favoriteMealOptions?.map((item) => item.id)).toEqual([alternativeFavoriteId]);
    await favoritesService.toggleFavoriteRecipeId(uid, recipeId);
    preferences = await favoritesService.loadNutritionPreferences(uid);
    expect(preferences?.favoriteFoodIds).toEqual([]);
    expect(preferences?.favoriteRecipeIds).toEqual([]);
    expect(preferences?.favoriteMealOptions?.map((item) => item.id)).toEqual([alternativeFavoriteId]);
    await assertFails(getDoc(doc(clientDb, 'users', otherUid, 'nutritionPreferences', 'current')));
  }, 20_000);

  it('builds a weekly summary from local-date logs, historical plan targets and Assessments', async () => {
    const timestamp = (iso: string) => Timestamp.fromDate(new Date(iso));
    const totals = (kcal: number) => ({ kcal, proteinG: kcal / 10, carbsG: kcal / 5, fatG: kcal / 20, fiberG: kcal / 100 });
    const engineSnapshot = (kcal: number) => ({ output: {
      energy: { targetKcal: kcal },
      macros: { proteinG: kcal / 10, carbsG: kcal / 5, fatG: kcal / 20, fiberG: kcal / 100 },
    } });
    const planA = {
      planId: 'weekly-a', generationId: 'weekly-a', status: 'archived' as const,
      profileSnapshot: {} as never, physicalSnapshot: {} as never,
      engineSnapshot: engineSnapshot(2000) as never,
      meals: [], dailyTotals: totals(2000), versions: {} as never, generationMetadata: {} as never,
      createdAt: timestamp('2026-12-28T12:00:00-03:00'),
      activatedAt: timestamp('2026-12-28T12:00:00-03:00'),
      archivedAt: timestamp('2026-12-31T12:00:00-03:00'),
    };
    const planB = {
      ...planA,
      planId: 'weekly-b', generationId: 'weekly-b', status: 'active' as const,
      engineSnapshot: engineSnapshot(2200) as never, dailyTotals: totals(2200),
      createdAt: timestamp('2026-12-31T12:00:00-03:00'),
      activatedAt: timestamp('2026-12-31T12:00:00-03:00'), archivedAt: null,
    };
    const log = (localDate: string, kcal: number) => ({
      localDate,
      timezone: 'America/Sao_Paulo',
      meals: kcal === 0 ? [] : [{
        slot: 'lunch' as const,
        items: [{
          id: `item-${localDate}`, foodId: 'nf_e2e_rice', grams: kcal,
          source: 'catalog_food' as const,
          snapshot: { name: 'Arroz E2E', ...totals(kcal) },
          loggedAt: timestamp(`${localDate}T12:00:00-03:00`),
        }],
        totals: totals(kcal),
        followedRecommendedOptionId: localDate === '2026-12-28' ? 'lunch-1' : null,
      }],
      totals: totals(kcal),
      loggedItemCount: kcal === 0 ? 0 : 1,
      createdAt: timestamp(`${localDate}T12:00:00-03:00`),
      updatedAt: timestamp(`${localDate}T12:00:00-03:00`),
    });
    const summary = buildNutritionWeeklySummary({
      weekStartLocalDate: '2026-12-28',
      logs: [log('2026-12-28', 1800), log('2026-12-30', 0), log('2027-01-02', 2400)],
      plans: [planA, planB],
    });
    expect(summary.recordedDays).toBe(3);
    expect(summary.averageConsumed?.kcal).toBe(1400);
    expect(summary.days.find((day) => day.localDate === '2026-12-29')).toMatchObject({ hasLog: false, totals: null });
    expect(summary.days.find((day) => day.localDate === '2026-12-30')).toMatchObject({ hasLog: true, totals: totals(0) });
    expect(summary.days.find((day) => day.localDate === '2026-12-28')?.target?.kcal).toBe(2000);
    expect(summary.days.find((day) => day.localDate === '2027-01-02')?.target?.kcal).toBe(2200);
    expect(summary.planIds).toEqual(['weekly-a', 'weekly-b']);
    expect(summary).not.toHaveProperty('adherenceScore');
    expect(summary).not.toHaveProperty('autoAdjustment');

    const weight = buildNutritionWeeklyWeightSummary({
      weekEndLocalDate: '2027-01-03',
      assessments: [
        { id: 'a1', weight: 71, measuredAt: timestamp('2026-12-20T08:00:00-03:00') },
        { id: 'a2', weight: 70.5, measuredAt: timestamp('2026-12-29T08:00:00-03:00') },
        { id: 'a3', weight: 70, measuredAt: timestamp('2027-01-02T08:00:00-03:00') },
      ],
      targetWeightKg: 68,
    });
    expect(weight.latest).toMatchObject({ id: 'a3', weightKg: 70 });
    expect(weight.previous).toMatchObject({ id: 'a2', weightKg: 70.5 });
    expect(weight.deltaKg).toBe(-0.5);
    expect(weight.targetWeightKg).toBe(68);
  });
});
