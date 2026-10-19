import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import { searchNutritionCatalog } from '../src/services/nutritionFoods';
import { searchFoodLogCatalog } from '../src/services/foodLogCatalog';

vi.mock('../src/lib/firebase', () => ({ db: {} }));

let env: RulesTestEnvironment;
const path = (uid: string, collection: string, id: string) => `users/${uid}/${collection}/${id}`;
const db = (uid: string) => env.authenticatedContext(uid).firestore();
const profile = () => ({ questionnaireVersion: 1, nonTrainingActivityLevel: 'active',
  mealSlots: ['breakfast', 'lunch', 'dinner'], dietaryPattern: 'omnivore',
  preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: [], supplements: [],
  pregnant: false, breastfeeding: false, varietyPreference: 'variety', updatedAt: serverTimestamp() });
const totals = () => ({ kcal: 100, proteinG: 10, carbsG: 10, fatG: 2, fiberG: 1 });
const loggedItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item1', foodId: 'rice', grams: 100, source: 'catalog_food',
  snapshot: { name: 'Rice', kcal: 100, proteinG: 2, carbsG: 20, fatG: 1 }, loggedAt: Timestamp.now(), ...overrides,
});
const favoriteFoodItem = (overrides: Record<string, unknown> = {}) => ({
  foodId: 'rice', grams: 100,
  snapshot: { name: 'Rice', kcal: 100, proteinG: 2, carbsG: 20, fatG: 1,
    source: { type: 'manual', sourceId: 'rice', sourceName: 'test' }, catalogVersion: 'v1' },
  ...overrides,
});
const favoriteMealOption = (overrides: Record<string, unknown> = {}) => ({
  id: 'fav1', source: 'plan', planId: 'plan1', slot: 'lunch', foods: [favoriteFoodItem()], totals: totals(),
  createdAt: Timestamp.now(), ...overrides,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'ajfit-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

describe('Nutrition Rules', () => {
  it('keeps the onboarding automatic rollout authenticated and backend-write-only without changing active', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'nutritionRolloutConfig', 'onboardingAutomatic'), { schemaVersion: 1, enabled: false, percentage: 0 });
    });
    await assertSucceeds(getDoc(doc(db('alice'), 'nutritionRolloutConfig', 'onboardingAutomatic')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'nutritionRolloutConfig', 'onboardingAutomatic')));
    await assertFails(setDoc(doc(db('alice'), 'nutritionRolloutConfig', 'onboardingAutomatic'), { schemaVersion: 1, enabled: true, percentage: 100 }));
    await assertFails(getDoc(doc(db('alice'), 'nutritionRolloutConfig', 'unknown')));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks/alice'), { status: 'REQUESTED' }));
    await assertFails(getDoc(doc(db('alice'), 'nutritionRolloutConfig', 'onboardingAutomatic')));
  });

  it('allows owner profile create, read and update and rejects cross-user access', async () => {
    const ref = doc(db('alice'), path('alice', 'nutritionProfile', 'current'));
    await assertSucceeds(setDoc(ref, profile()));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { pregnant: true, updatedAt: serverTimestamp() }));
    const intruder = doc(db('mallory'), path('alice', 'nutritionProfile', 'current'));
    await assertFails(getDoc(intruder));
    await assertFails(setDoc(intruder, profile()));
    await assertFails(updateDoc(intruder, { pregnant: false, updatedAt: serverTimestamp() }));
  });

  it('rejects malformed profiles and account deletion locks', async () => {
    const ref = doc(db('alice'), path('alice', 'nutritionProfile', 'current'));
    await assertFails(setDoc(ref, { ...profile(), extra: true }));
    await assertFails(setDoc(ref, { ...profile(), dietaryPattern: 'carnivore' }));
    await assertFails(setDoc(ref, { ...profile(), mealSlots: ['lunch'] }));
    await assertFails(setDoc(ref, { ...profile(), mealSlots: [...Array(7)].map((_, i) => `slot${i}`) }));
    await assertFails(setDoc(ref, { ...profile(), preferredFoodIds: [...Array(11)].map((_, i) => `food${i}`) }));
    await assertSucceeds(setDoc(ref, { ...profile(), excludedAllergens: ['milk', 'peanut'] }));
    await assertFails(updateDoc(ref, { excludedAllergens: ['milk', 'milk'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { excludedAllergens: ['imaginary'], updatedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks/alice'), { status: 'REQUESTED' }));
    await assertFails(setDoc(ref, profile()));
    await assertFails(getDoc(ref));
  });

  it('validates daily logs, recipes and private foods', async () => {
    const log = doc(db('alice'), path('alice', 'nutritionDailyLogs', '2026-10-08'));
    const meal = (ownerUid: string, localDate: string, slot: string, asUid: string = ownerUid) =>
      doc(db(asUid), `users/${ownerUid}/nutritionDailyLogs/${localDate}/meals/${slot}`);
    const item = (ownerUid: string, localDate: string, slot: string, itemId: string, asUid: string = ownerUid) =>
      doc(db(asUid), `users/${ownerUid}/nutritionDailyLogs/${localDate}/meals/${slot}/items/${itemId}`);
    await assertSucceeds(setDoc(log, { localDate: '2026-10-08', timezone: 'America/Sao_Paulo', totals: totals(), loggedItemCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(meal('alice', '2026-10-08', 'lunch'), { slot: 'lunch', totals: totals() }));
    await assertSucceeds(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), loggedItem()));
    await assertSucceeds(updateDoc(meal('alice', '2026-10-08', 'lunch'), { followedRecommendedOptionId: 'lunch-1', totals: totals() }));
    await assertFails(setDoc(meal('alice', '2026-10-08', 'lunch'), { slot: 'lunch', totals: totals(), itemsRevision: 0, extra: true }));
    await assertSucceeds(setDoc(meal('alice', '2026-10-08', 'breakfast'), { slot: 'breakfast', totals: totals() }));
    await assertSucceeds(setDoc(item('alice', '2026-10-08', 'breakfast', 'breakfast-item'), loggedItem({ id: 'breakfast-item' })));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionDailyLogs', '2026-10-09')), { localDate: '2026-10-08', timezone: 'UTC', totals: totals(), loggedItemCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionDailyLogs', '2026-13-40')), { localDate: '2026-13-40', timezone: 'UTC', totals: totals(), loggedItemCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionDailyLogs', '2026-10-09')), { localDate: '2026-10-09', timezone: '', totals: totals(), loggedItemCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    // Meal doc id must agree with its own `slot` field, and only the six canonical slots are valid doc ids.
    await assertFails(setDoc(meal('alice', '2026-10-08', 'lunch'), { slot: 'dinner', totals: totals() }));
    await assertFails(setDoc(meal('alice', '2026-10-08', 'brunch'), { slot: 'brunch', totals: totals() }));
    await assertFails(setDoc(meal('alice', '2026-10-08', 'lunch'), { slot: 'lunch', totals: { ...totals(), kcal: -1 } }));
    // An item doc id must agree with its own `id` field (round brief part 1 — addressable edit/move/remove).
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), loggedItem({ grams: -1 })));
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), loggedItem({ snapshot: { name: 'Rice', kcal: '100', proteinG: 2, carbsG: 20, fatG: 1 } })));
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), loggedItem({ snapshot: { name: 'Rice', kcal: 100001, proteinG: 2, carbsG: 20, fatG: 1 } })));
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), { foodId: 'rice', grams: 100, source: 'catalog_food', snapshot: { name: 'Rice', kcal: 100, proteinG: 2, carbsG: 20, fatG: 1 } }));
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'item1'), loggedItem({ loggedAt: 'not-a-timestamp' })));
    await assertFails(setDoc(item('alice', '2026-10-08', 'lunch', 'mismatch'), loggedItem({ id: 'item1' })));
    await assertFails(getDoc(meal('alice', '2026-10-08', 'lunch', 'mallory')));
    await assertFails(getDoc(item('alice', '2026-10-08', 'lunch', 'item1', 'mallory')));
    await assertFails(setDoc(meal('alice', '2026-10-08', 'dinner', 'mallory'), { slot: 'dinner', totals: totals() }));
    await assertFails(setDoc(item('alice', '2026-10-08', 'dinner', 'intruder', 'mallory'), loggedItem({ id: 'intruder' })));
    await assertFails(deleteDoc(meal('alice', '2026-10-08', 'lunch', 'mallory')));
    await assertFails(deleteDoc(item('alice', '2026-10-08', 'lunch', 'item1', 'mallory')));
    await assertSucceeds(deleteDoc(item('alice', '2026-10-08', 'breakfast', 'breakfast-item')));
    await assertSucceeds(deleteDoc(meal('alice', '2026-10-08', 'breakfast')));
    const recipe = doc(db('alice'), path('alice', 'nutritionRecipes', 'r1'));
    await assertSucceeds(setDoc(recipe, { id: 'r1', name: 'Rice', ingredients: [{ foodId: 'rice', grams: 100 }], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    const longId = 'r'.repeat(121);
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionRecipes', longId)), { id: longId, name: 'Rice', ingredients: [{ foodId: 'rice', grams: 100 }], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(recipe, { name: 'Cooked rice', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(recipe, { calculatedNutrition: totals(), updatedAt: serverTimestamp() }));
    const food = doc(db('alice'), path('alice', 'nutritionFoods', 'f1'));
    await assertSucceeds(setDoc(food, { id: 'f1', name: 'Rice', nutritionPer100g: { kcal: 100, proteinG: 2, carbsG: 20, fatG: 1 }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(food, { name: 'White rice', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(food, { generationStatus: 'approved', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db('mallory'), path('alice', 'nutritionFoods', 'f1'))));
    await assertFails(getDoc(doc(db('mallory'), path('alice', 'nutritionDailyLogs', '2026-10-08'))));
    await assertFails(setDoc(doc(db('mallory'), path('alice', 'nutritionRecipes', 'r2')), { id: 'r2' }));
    await assertFails(updateDoc(doc(db('mallory'), path('alice', 'nutritionRecipes', 'r1')), { name: 'Tampered' }));
    await assertFails(deleteDoc(doc(db('mallory'), path('alice', 'nutritionRecipes', 'r1'))));
    await assertSucceeds(deleteDoc(recipe));
    await assertSucceeds(deleteDoc(food));
  });

  it('enforces the itemsRevision optimistic-concurrency counter on meal docs (production audit P2-01 fix)', async () => {
    const meal = (slot: string) => doc(db('alice'), `users/alice/nutritionDailyLogs/2026-10-10/meals/${slot}`);

    // A meal doc never touched by a revision-aware client behaves exactly as before: any owner
    // can create/update/delete it freely, and bounds on itemsRevision only apply if present.
    await assertSucceeds(setDoc(meal('dinner'), { slot: 'dinner', totals: totals() }));
    await assertSucceeds(updateDoc(meal('dinner'), { totals: totals() }));
    await assertSucceeds(deleteDoc(meal('dinner')));

    // Bootstrap: the FIRST write that introduces itemsRevision accepts any bounded, correctly
    // typed value — there is no prior revision to increment from yet.
    await assertSucceeds(setDoc(meal('lunch'), { slot: 'lunch', totals: totals(), itemsRevision: 1 }));
    // Once tracked, every further write must increment by exactly 1 — anything else fails closed,
    // INCLUDING a legacy (pre-fix) client's blind write that omits the field entirely. This is the
    // exact scenario that used to silently corrupt the aggregate (P2-01): now it is denied outright.
    await assertFails(updateDoc(meal('lunch'), { totals: totals() })); // stale client's payload shape — no itemsRevision at all
    await assertFails(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 1 })); // not incremented
    await assertFails(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 3 })); // skips ahead
    await assertFails(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 0 })); // goes backward
    await assertSucceeds(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 2 })); // exactly +1
    await assertSucceeds(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 3 })); // exactly +1 again
    // Type/bounds are still enforced once tracked, independent of the increment check.
    await assertFails(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 4.5 }));
    await assertFails(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: '4' }));
    // Once tracked, the doc can never be deleted outright — clearing to zero items must go through
    // an `update` with an incremented revision (what `nutritionDiary.ts` now does), never a raw delete.
    await assertFails(deleteDoc(meal('lunch')));
    await assertSucceeds(updateDoc(meal('lunch'), { totals: totals(), itemsRevision: 4 })); // "clearing" via update still succeeds

    // Bounds are enforced on a fresh (untracked) doc's bootstrap write too.
    await assertFails(setDoc(meal('supper'), { slot: 'supper', totals: totals(), itemsRevision: 1000000001 }));
    await assertFails(setDoc(meal('supper'), { slot: 'supper', totals: totals(), itemsRevision: -1 }));
    await assertSucceeds(setDoc(meal('supper'), { slot: 'supper', totals: totals(), itemsRevision: 1000000000 }));
  });

  it('accepts a recipe\'s optional finalWeightG/servings within range and rejects invalid ones', async () => {
    const recipeRef = (id: string) => doc(db('alice'), path('alice', 'nutritionRecipes', id));
    await assertSucceeds(setDoc(recipeRef('r-fw1'), {
      id: 'r-fw1', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      finalWeightG: 250, servings: 2, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(recipeRef('r-fw1'), { finalWeightG: 260, servings: 3, updatedAt: serverTimestamp() }));
    // Clearing both back out (recipe with no finalWeightG/servings) must still be a valid shape.
    await assertSucceeds(updateDoc(recipeRef('r-fw1'), {
      finalWeightG: deleteField(), servings: deleteField(), updatedAt: serverTimestamp(),
    }));

    await assertFails(setDoc(recipeRef('r-fw2'), {
      id: 'r-fw2', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      finalWeightG: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(recipeRef('r-fw3'), {
      id: 'r-fw3', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      finalWeightG: 10001, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(recipeRef('r-fw4'), {
      id: 'r-fw4', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      servings: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(recipeRef('r-fw5'), {
      id: 'r-fw5', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      servings: 2.5, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(recipeRef('r-fw6'), {
      id: 'r-fw6', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      servings: 101, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    // Not an allow-listed field at all.
    await assertFails(setDoc(recipeRef('r-fw7'), {
      id: 'r-fw7', name: 'Soup', ingredients: [{ foodId: 'rice', grams: 300 }],
      caloriesPerGram: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));

    await assertSucceeds(deleteDoc(recipeRef('r-fw1')));
  });

  it('writes a full day (6 meals x 6 items each) one item doc at a time without exceeding the Rules expression budget', async () => {
    const allSlots = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'supper'] as const;
    const localDate = '2026-10-10';
    const dayRef = doc(db('alice'), path('alice', 'nutritionDailyLogs', localDate));
    await assertSucceeds(setDoc(dayRef, {
      localDate, timezone: 'America/Sao_Paulo', totals: totals(), loggedItemCount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    for (const slot of allSlots) {
      const mealRef = doc(db('alice'), `users/alice/nutritionDailyLogs/${localDate}/meals/${slot}`);
      await assertSucceeds(setDoc(mealRef, { slot, totals: totals() }));
      for (let itemIndex = 0; itemIndex < 6; itemIndex++) {
        const itemId = `${slot}-i${itemIndex}`;
        const itemRef = doc(db('alice'), `users/alice/nutritionDailyLogs/${localDate}/meals/${slot}/items/${itemId}`);
        await assertSucceeds(setDoc(itemRef, loggedItem({ id: itemId })));
      }
    }
    await assertSucceeds(updateDoc(dayRef, { totals: totals(), loggedItemCount: 36, updatedAt: serverTimestamp() }));
    const breakfastItems = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      getDoc(doc(db('alice'), `users/alice/nutritionDailyLogs/${localDate}/meals/breakfast/items/breakfast-i${i}`))));
    expect(breakfastItems.every((snap) => snap.exists())).toBe(true);
    await assertFails(getDoc(doc(db('mallory'), `users/alice/nutritionDailyLogs/${localDate}/meals/breakfast/items/breakfast-i0`)));
    await assertFails(setDoc(
      doc(db('mallory'), `users/alice/nutritionDailyLogs/${localDate}/meals/breakfast/items/intruder`),
      loggedItem({ id: 'intruder' }),
    ));
  });

  it('creates the exact first food favorite payload and later adds/removes food and recipe ids', async () => {
    const ref = doc(db('alice'), path('alice', 'nutritionPreferences', 'current'));
    const tacoId = 'nf_taco_86_e5e89fec636fa808';

    await assertSucceeds(setDoc(ref, {
      favoriteFoodIds: [tacoId],
      favoriteRecipeIds: [],
      updatedAt: serverTimestamp(),
    }));
    expect((await getDoc(ref)).data()).toMatchObject({ favoriteFoodIds: [tacoId], favoriteRecipeIds: [] });

    await assertSucceeds(updateDoc(ref, {
      favoriteFoodIds: [tacoId, 'nf_beans'],
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(ref, {
      favoriteFoodIds: ['nf_beans'],
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(ref, {
      favoriteRecipeIds: ['recipe_user_1'],
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(ref, {
      favoriteRecipeIds: [],
      updatedAt: serverTimestamp(),
    }));

    expect((await getDoc(ref)).data()).toMatchObject({ favoriteFoodIds: ['nf_beans'], favoriteRecipeIds: [] });
  });

  it('allows only explicit client-owned favorites in preferences', async () => {
    const ref = doc(db('alice'), path('alice', 'nutritionPreferences', 'current'));
    await assertSucceeds(setDoc(ref, { favoriteFoodIds: ['rice'], favoriteRecipeIds: [], updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { favoriteFoodIds: ['beans'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { learnedPreference: 'beans', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db('mallory'), path('alice', 'nutritionPreferences', 'current'))));

    // favoriteFoodIds and favoriteRecipeIds are independent fields — a recipe is never mixed into the food list or vice versa.
    await assertSucceeds(updateDoc(ref, { favoriteRecipeIds: ['recipe_abc'], updatedAt: serverTimestamp() }));
    await assertSucceeds(getDoc(ref).then(async (snap) => {
      expect(snap.data()?.favoriteFoodIds).toEqual(['beans']);
      expect(snap.data()?.favoriteRecipeIds).toEqual(['recipe_abc']);
    }));
    await assertSucceeds(updateDoc(ref, {
      favoriteFoodIds: Array.from({ length: 10 }, (_, i) => `food_${i}`),
      favoriteRecipeIds: Array.from({ length: 10 }, (_, i) => `recipe_${i}`),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(ref, {
      favoriteFoodIds: Array.from({ length: 20 }, (_, i) => `food_${i}`),
      favoriteRecipeIds: [],
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ref, {
      favoriteFoodIds: Array.from({ length: 11 }, (_, i) => `food_${i}`),
      favoriteRecipeIds: Array.from({ length: 10 }, (_, i) => `recipe_${i}`),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(ref, { favoriteFoodIds: Array.from({ length: 21 }, (_, i) => `food_${i}`), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { favoriteRecipeIds: [1, 2, 3], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { favoriteRecipeIds: Array.from({ length: 21 }, (_, i) => `recipe_${i}`), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { favoriteRecipeIds: ['duplicate', 'duplicate'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { favoriteRecipeIds: deleteField(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('bob'), path('bob', 'nutritionPreferences', 'current')), {
      favoriteFoodIds: [], updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db('bob'), path('bob', 'nutritionPreferences', 'current')), {
      favoriteFoodIds: [], favoriteRecipeIds: [], extra: true, updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db('mallory'), path('alice', 'nutritionPreferences', 'current')), { favoriteRecipeIds: ['stolen'], favoriteFoodIds: [], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('mallory'), path('alice', 'nutritionPreferences', 'current')), { favoriteRecipeIds: ['stolen'], updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db('mallory'), path('alice', 'nutritionPreferences', 'current'))));

    await assertFails(updateDoc(ref, { favoriteMealOptions: [favoriteMealOption()], updatedAt: serverTimestamp() }));
    const recommendedRef = doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'fav1'));
    await assertSucceeds(setDoc(recommendedRef, favoriteMealOption({ createdAt: serverTimestamp() })));
    await assertSucceeds(getDoc(recommendedRef));
    const alternativeFavorite = favoriteMealOption({ id: 'fav2', source: 'alternative', alternativeId: 'alt1', createdAt: serverTimestamp() }) as Record<string, unknown>;
    delete alternativeFavorite.planId;
    await assertSucceeds(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'fav2')), alternativeFavorite));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'bad-source')), favoriteMealOption({ id: 'bad-source', source: 'invented', createdAt: serverTimestamp() })));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'bad-ref')), favoriteMealOption({ id: 'bad-ref', alternativeId: 'alt1', createdAt: serverTimestamp() })));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'bad-brand')), favoriteMealOption({ id: 'bad-brand', foods: [favoriteFoodItem({ snapshot: {
      ...favoriteFoodItem().snapshot, brand: { name: 'brand', productName: 'x'.repeat(201) },
    } })], createdAt: serverTimestamp() })));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'empty')), favoriteMealOption({ id: 'empty', foods: [], createdAt: serverTimestamp() })));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'extra')), { ...favoriteMealOption({ id: 'extra', createdAt: serverTimestamp() }), extra: true }));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'mismatch')), favoriteMealOption({ id: 'different', createdAt: serverTimestamp() })));
    await assertFails(getDoc(doc(db('mallory'), path('alice', 'nutritionFavoriteMealOptions', 'fav1'))));
    await assertFails(deleteDoc(doc(db('mallory'), path('alice', 'nutritionFavoriteMealOptions', 'fav1'))));
    await assertSucceeds(deleteDoc(recommendedRef));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks/alice'), { status: 'REQUESTED' }));
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { favoriteFoodIds: [], updatedAt: serverTimestamp() }));
  });

  it('keeps plans, jobs, alternatives, global catalog and backend operations server-owned', async () => {
    for (const collection of ['nutritionPlans', 'nutritionGenerationJobs', 'nutritionMealAlternatives']) {
      const ref = doc(db('alice'), path('alice', collection, 'one'));
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), path('alice', collection, 'one')), { status: 'queued' }));
      await assertSucceeds(getDoc(ref));
      await assertFails(setDoc(doc(db('alice'), path('alice', collection, 'two')), { status: 'queued' }));
      await assertFails(updateDoc(ref, { status: 'completed' }));
      await assertFails(getDoc(doc(db('mallory'), path('alice', collection, 'one'))));
    }
    await assertFails(setDoc(doc(db('alice'), 'nutritionFoods/global'), { name: 'Rice' }));
    await assertFails(setDoc(doc(db('alice'), 'nutritionCatalogMeta/current'), { version: 1 }));
    await assertFails(getDoc(doc(db('alice'), 'nutritionAiOperations/op')));
    await assertFails(setDoc(doc(db('alice'), 'nutritionAiOperations/op'), {}));
    await assertFails(getDoc(doc(db('alice'), 'nutritionRateLimits/limit')));
    await assertFails(setDoc(doc(db('alice'), 'nutritionRateLimits/limit'), {}));
  });

  it('searches approved global foods by PT-BR name/alias with bounded cursor pages', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [id, status] of [['a', 'approved'], ['b', 'approved'], ['c', 'pending_review']] as const) {
        await setDoc(doc(ctx.firestore(), 'nutritionFoods', id), {
          id, name: 'Mandioca', aliases: ['Aipim'], generationStatus: status,
          searchPrefixes: ['ai', 'aip', 'aipi', 'aipim', 'ma', 'man'],
        });
      }
    });
    const first = await searchNutritionCatalog('aíp', { pageSize: 1, firestore: db('alice') as unknown as Firestore });
    expect(first.foods.map((food) => food.name)).toEqual(['Mandioca']);
    expect(first.nextCursor).toBe('a');
    const second = await searchNutritionCatalog('aíp', { pageSize: 1, cursor: first.nextCursor!, firestore: db('alice') as unknown as Firestore });
    expect(second.foods.map((food) => food.id)).toEqual(['b']);
    expect(second.nextCursor).toBe('b');
    const third = await searchNutritionCatalog('aíp', { pageSize: 1, cursor: second.nextCursor!, firestore: db('alice') as unknown as Firestore });
    expect(third.foods).toHaveLength(0);
    await assertFails(setDoc(doc(db('alice'), 'nutritionFoods/a'), { generationStatus: 'approved' }));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks/alice'), { status: 'REQUESTED' }));
    await assertFails(getDoc(doc(db('alice'), 'nutritionFoods/a')));
    await assertFails(getDoc(doc(db('alice'), 'nutritionCatalogMeta/current')));
    await assertFails(getDoc(doc(db('alice'), 'nutritionRolloutConfig/active')));
  });

  // Fase C2 — amplo catálogo de registro alimentar (`foodLogCatalog`),
  // separado de `nutritionFoods`. Same read-authenticated/write-false
  // pattern as the generation catalog, verified independently so a future
  // change to one block can never silently affect the other.
  it('keeps the Fase C2 food-log catalog read-authenticated and backend-write-only, separate from nutritionFoods', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodLogCatalog', 'flc_taco_1'), {
        id: 'flc_taco_1', name: 'Frango, peito, sem pele, grelhado', aliases: [], status: 'active',
        searchPrefixes: ['fr', 'fra', 'fran', 'frang', 'frango'],
      });
      await setDoc(doc(ctx.firestore(), 'foodLogCatalogMeta', 'current'), { schemaVersion: 1, importedRecordCount: 1 });
    });
    await assertSucceeds(getDoc(doc(db('alice'), 'foodLogCatalog/flc_taco_1')));
    await assertSucceeds(getDoc(doc(db('alice'), 'foodLogCatalogMeta/current')));
    await assertFails(setDoc(doc(db('alice'), 'foodLogCatalog/flc_taco_1'), { name: 'Tampered' }));
    await assertFails(setDoc(doc(db('alice'), 'foodLogCatalog/new'), { name: 'Injected' }));
    await assertFails(setDoc(doc(db('alice'), 'foodLogCatalogMeta/current'), { importedRecordCount: 999 }));
    await assertFails(getDoc(doc(db('alice'), 'foodLogCatalogMeta/not-current')));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'accountDeletionLocks/alice'), { status: 'REQUESTED' }));
    await assertFails(getDoc(doc(db('alice'), 'foodLogCatalog/flc_taco_1')));
  });

  it('searches active food-log entries by PT-BR name/alias with bounded cursor pages, independent of generationStatus', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [id, status] of [['a', 'active'], ['b', 'active'], ['c', 'hidden']] as const) {
        await setDoc(doc(ctx.firestore(), 'foodLogCatalog', id), {
          id, name: 'Mandioca', aliases: ['Aipim'], status,
          source: { type: 'taco', sourceId: id, sourceName: 'TACO' },
          searchSourcePriority: 0,
          searchPrefixes: ['ai', 'aip', 'aipi', 'aipim', 'ma', 'man'],
        });
      }
    });
    const first = await searchFoodLogCatalog('aíp', { pageSize: 1, firestore: db('alice') as unknown as Firestore });
    expect(first.foods.map((food) => food.name)).toEqual(['Mandioca']);
    const all = await searchFoodLogCatalog('aíp', { pageSize: 10, firestore: db('alice') as unknown as Firestore });
    expect(all.foods.map((food) => food.id).sort()).toEqual(['a', 'b']);
  });

  it('allows logging a diary item with the Fase C2 food_log_catalog source', async () => {
    const itemPath = (itemId: string) => `users/alice/nutritionDailyLogs/2026-10-08/meals/lunch/items/${itemId}`;
    const item = loggedItem({ id: 'flc-item', source: 'food_log_catalog', foodId: 'flc_taco_1' });
    await assertSucceeds(setDoc(doc(db('alice'), itemPath('flc-item')), item));
    await assertFails(setDoc(doc(db('alice'), itemPath('bad-source')), loggedItem({ id: 'bad-source', source: 'not_a_real_source' })));
  });
});

describe('catalog linked plan bookmarks and critical absence profile', () => {
  it('keeps linked bookmarks backend-owned without granting write access to plans, catalog or consumption receipts', async () => {
    const foods = Array.from({ length: 8 }, () => ({ name: 'Arroz', quantity: 100, unit: 'g', preparationNote: '', estimatedNutrition: totals(),
      catalogBinding: { schemaVersion: 1, collection: 'nutritionFoods', foodId: 'nf_taco_test' } }));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'fav1')), favoriteMealOption({ foods })));
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path('alice', 'nutritionFavoriteMealOptions', 'fav1')), favoriteMealOption({ foods })));
    await assertSucceeds(getDoc(doc(db('alice'), path('alice', 'nutritionFavoriteMealOptions', 'fav1'))));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionPlans', 'p')), { foods }));
    await assertFails(setDoc(doc(db('alice'), path('alice', 'nutritionCatalogLogReceipts', 'r')), { requestKey: 'forged' }));
    await assertFails(setDoc(doc(db('alice'), 'nutritionFoods/nf_taco_test'), { name: 'Forged' }));
  });
  it('validates lactose/gluten absences on profile create and update without changing old profiles', async () => {
    const ref = doc(db('alice'), path('alice', 'nutritionProfile', 'current'));
    await assertSucceeds(setDoc(ref, { ...profile(), excludedSubstances: ['lactose'] }));
    await assertSucceeds(updateDoc(ref, { excludedSubstances: ['gluten'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { excludedSubstances: ['unknown'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { excludedSubstances: ['gluten', 'gluten'], updatedAt: serverTimestamp() }));
  });
});

describe('transactional diary cutover — old writers fail closed selectively', () => {
  const day = 'users/alice/nutritionDailyLogs/2026-10-18';
  const meal = `${day}/meals/breakfast`;
  const item = `${meal}/items/item1`;
  async function seed(enrolled: boolean) {
    await env.withSecurityRulesDisabled(async ctx => {
      const f = ctx.firestore();
      await setDoc(doc(f, day), { localDate: '2026-10-18', timezone: 'UTC', totals: totals(), loggedItemCount: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      await setDoc(doc(f, meal), { slot: 'breakfast', totals: totals() });
      await setDoc(doc(f, item), loggedItem());
      if (enrolled) await setDoc(doc(f, 'users/alice/nutritionDiaryProtocol/current'), { version: 1, enrolledAt: Timestamp.now() });
    });
  }
  it('preserves legacy manual writes before enrollment', async () => {
    await seed(false);
    await assertSucceeds(updateDoc(doc(db('alice'), item), { grams: 150 }));
    await assertSucceeds(deleteDoc(doc(db('alice'), item)));
  });
  it('denies stale direct add/edit/remove/move and aggregate/day deletion after enrollment', async () => {
    await seed(true);
    await assertFails(setDoc(doc(db('alice'), `${meal}/items/item2`), loggedItem({ id: 'item2' })));
    await assertFails(updateDoc(doc(db('alice'), item), { grams: 150 }));
    await assertFails(deleteDoc(doc(db('alice'), item)));
    await assertFails(setDoc(doc(db('alice'), `${day}/meals/lunch/items/item1`), loggedItem()));
    await assertFails(updateDoc(doc(db('alice'), meal), { totals: totals() }));
    await assertFails(deleteDoc(doc(db('alice'), meal)));
    await assertFails(updateDoc(doc(db('alice'), day), { loggedItemCount: 2, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db('alice'), day)));
    await assertSucceeds(getDoc(doc(db('alice'), item)));
    await assertSucceeds(getDoc(doc(db('alice'), day)));
  });
  it('does not allow clients to enroll, reset the protocol, forge snapshots or manipulate receipts', async () => {
    await seed(true);
    await assertFails(setDoc(doc(db('alice'), 'users/alice/nutritionDiaryProtocol/current'), { version: 1 }));
    await assertFails(deleteDoc(doc(db('alice'), 'users/alice/nutritionDiaryProtocol/current')));
    await assertFails(getDoc(doc(db('mallory'), 'users/alice/nutritionDiaryProtocol/current')));
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/nutritionDiaryProtocol/current')));
    const receipt = doc(db('alice'), 'users/alice/nutritionDiaryOperationReceipts/request-fake');
    await assertFails(setDoc(receipt, { result: {} })); await assertFails(getDoc(receipt));
    await assertFails(setDoc(doc(db('alice'), item), { id: 'item1', source: 'plan_snapshot', quantity: 100, unit: 'g', snapshot: { name: 'Fake', ...totals() } }));
  });
  it('rejects the new source on an unenrolled client without inventing a foodId', async () => {
    await seed(false);
    await assertFails(setDoc(doc(db('alice'), item), { id: 'item1', source: 'plan_snapshot', quantity: 100, unit: 'g', snapshot: { name: 'Fake', ...totals() }, loggedAt: Timestamp.now() }));
  });
});
