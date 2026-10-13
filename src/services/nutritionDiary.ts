import {
  collection, doc, documentId, endAt, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAt, Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { nutrientsForGrams, roundNutritionValues } from '../nutrition/catalog/math';
import { deviceTimeZone, todayLocalDate } from '../nutrition/ui/localDate';
import { emptyTotals, sumItemTotals } from '../nutrition/ui/diaryModel';
import { loadCatalogFood, loadCustomFood } from './nutritionFoods';
import { loadFoodLogEntry } from './foodLogCatalog';
import { loadNutritionRecipe, calculateStoredRecipeBreakdown } from './nutritionRecipes';
import type {
  NutritionDailyLog, NutritionFoodNutritionValues, NutritionLoggedFoodItem, NutritionLoggedFoodSource,
  NutritionLoggedMeal, NutritionMealSlot, NutritionTotals,
} from '../types/nutrition';

export type NutritionDailyLogDoc = NutritionDailyLog<Timestamp>;
type LoggedItemDoc = NutritionLoggedFoodItem<Timestamp>;

/**
 * A day's meals live one-per-document (`meals/{slot}`), each meal's foods
 * one-per-document (`meals/{slot}/items/{itemId}`) — NOT as nested arrays
 * on the day doc. Six meals x six items each, revalidated in full on every
 * write, blew past Firestore Rules' 1000-expression-per-write budget when
 * the whole day was one document (round brief part 1 §6); splitting bounds
 * every write to one item (or one meal's aggregate), regardless of how much
 * else is logged that day. `loadDiaryDay`/`subscribeToDiaryDay` recompose
 * the same `NutritionDailyLogDoc` shape callers always had, so the rest of
 * the app (weekly summary, NutritionHome, diary UI) is unaffected.
 */
function dayRef(uid: string, localDate: string) { return doc(db, 'users', uid, 'nutritionDailyLogs', localDate); }
function mealsColl(uid: string, localDate: string) { return collection(db, 'users', uid, 'nutritionDailyLogs', localDate, 'meals'); }
function mealRef(uid: string, localDate: string, slot: NutritionMealSlot) { return doc(mealsColl(uid, localDate), slot); }
function itemsColl(uid: string, localDate: string, slot: NutritionMealSlot) {
  return collection(db, 'users', uid, 'nutritionDailyLogs', localDate, 'meals', slot, 'items');
}
function itemRef(uid: string, localDate: string, slot: NutritionMealSlot, itemId: string) {
  return doc(itemsColl(uid, localDate, slot), itemId);
}
function newItemId() { return doc(collection(db, 'users')).id; }

async function loadMealItems(uid: string, localDate: string, slot: NutritionMealSlot): Promise<LoggedItemDoc[]> {
  const snap = await getDocs(itemsColl(uid, localDate, slot));
  return snap.docs.map((item) => item.data() as LoggedItemDoc);
}

async function loadDayMeals(uid: string, localDate: string): Promise<NutritionLoggedMeal<Timestamp>[]> {
  const mealsSnap = await getDocs(mealsColl(uid, localDate));
  const meals = await Promise.all(mealsSnap.docs.map(async (mealDoc) => {
    const data = mealDoc.data() as { slot: NutritionMealSlot; totals: NutritionTotals; followedRecommendedOptionId?: string | null };
    const items = await loadMealItems(uid, localDate, data.slot);
    return { slot: data.slot, items, totals: data.totals, followedRecommendedOptionId: data.followedRecommendedOptionId ?? null };
  }));
  return meals.filter((meal) => meal.items.length > 0);
}

export async function loadDiaryDay(uid: string, localDate: string): Promise<NutritionDailyLogDoc | null> {
  const snap = await getDoc(dayRef(uid, localDate));
  if (!snap.exists()) return null;
  const meals = await loadDayMeals(uid, localDate);
  return { ...(snap.data() as Omit<NutritionDailyLogDoc, 'meals'>), meals };
}

/**
 * Live for the one focused day (bounded to <= 6 meals, each with its own
 * item listener) — multi-device edits to the day being actively viewed
 * reflect immediately. `subscribeToDiaryWeek` below deliberately does NOT
 * hold this many nested listeners for 7 days at once; see its own comment.
 */
export function subscribeToDiaryDay(
  uid: string, localDate: string, onDay: (day: NutritionDailyLogDoc | null) => void, onError?: (error: unknown) => void,
): Unsubscribe {
  let dayData: Omit<NutritionDailyLogDoc, 'meals'> | null = null;
  const mealMeta = new Map<string, { totals: NutritionTotals; followedRecommendedOptionId: string | null }>();
  const mealItems = new Map<string, LoggedItemDoc[]>();
  const itemUnsubs = new Map<string, Unsubscribe>();

  function emit() {
    if (!dayData) { onDay(null); return; }
    const meals = [...mealMeta.entries()]
      .map(([slot, meta]) => ({ slot: slot as NutritionMealSlot, items: mealItems.get(slot) ?? [], ...meta }))
      .filter((meal) => meal.items.length > 0);
    onDay({ ...dayData, meals });
  }

  const unsubDay = onSnapshot(dayRef(uid, localDate), (snap) => {
    dayData = snap.exists() ? (snap.data() as Omit<NutritionDailyLogDoc, 'meals'>) : null;
    emit();
  }, onError);

  const unsubMeals = onSnapshot(mealsColl(uid, localDate), (snap) => {
    const seenSlots = new Set<string>();
    for (const mealDoc of snap.docs) {
      const slot = mealDoc.id;
      seenSlots.add(slot);
      const data = mealDoc.data() as { totals: NutritionTotals; followedRecommendedOptionId?: string | null };
      mealMeta.set(slot, { totals: data.totals, followedRecommendedOptionId: data.followedRecommendedOptionId ?? null });
      if (!itemUnsubs.has(slot)) {
        itemUnsubs.set(slot, onSnapshot(itemsColl(uid, localDate, slot as NutritionMealSlot), (itemsSnap) => {
          mealItems.set(slot, itemsSnap.docs.map((item) => item.data() as LoggedItemDoc));
          emit();
        }, onError));
      }
    }
    for (const slot of [...itemUnsubs.keys()]) {
      if (!seenSlots.has(slot)) {
        itemUnsubs.get(slot)!();
        itemUnsubs.delete(slot);
        mealMeta.delete(slot);
        mealItems.delete(slot);
      }
    }
    emit();
  }, onError);

  return () => {
    unsubDay();
    unsubMeals();
    for (const unsub of itemUnsubs.values()) unsub();
  };
}

/**
 * One listener for the day-range query — stays live for the day docs'
 * aggregate totals — but re-fetches each changed day's meal/item detail
 * with one-shot reads rather than keeping up to 7 days x 6 meals of nested
 * listeners open at once (the live, deep-nested version is reserved for
 * the single focused day in `subscribeToDiaryDay` above).
 */
export function subscribeToDiaryWeek(
  uid: string, weekStartLocalDate: string, weekEndLocalDate: string,
  onDays: (days: NutritionDailyLogDoc[]) => void, onError?: (error: unknown) => void,
): Unsubscribe {
  let cancelled = false;
  const unsubscribe = onSnapshot(
    query(
      collection(db, 'users', uid, 'nutritionDailyLogs'),
      orderBy(documentId()),
      startAt(weekStartLocalDate),
      endAt(weekEndLocalDate),
    ),
    (snapshot) => {
      void Promise.all(snapshot.docs.map(async (dayDoc) => {
        const meals = await loadDayMeals(uid, dayDoc.id);
        return { ...(dayDoc.data() as Omit<NutritionDailyLogDoc, 'meals'>), meals };
      })).then((days) => { if (!cancelled) onDays(days); })
        .catch((error) => { if (!cancelled) onError?.(error); });
    },
    (error) => { if (!cancelled) onError?.(error); },
  );
  return () => { cancelled = true; unsubscribe(); };
}

/**
 * The ONLY source of nutrient values for a logged item — always re-read
 * from the live, authoritative document (global catalog food, the user's
 * own current custom food, or a fresh recipe recalculation), never from a
 * client-held number (round brief part 1 §3). Mirrors the same pattern
 * `calculateStoredRecipeBreakdown` already uses for Recipes
 * (`07_backend/firestore_schema.md` §6: Rules can't prove a derived sum,
 * shared trusted computation is the authority instead).
 */
export async function resolveAuthoritativeFoodNutrition(
  uid: string, source: NutritionLoggedFoodSource, foodId: string,
): Promise<{ name: string; nutritionPer100g: NutritionFoodNutritionValues }> {
  if (source === 'catalog_food') {
    const food = await loadCatalogFood(foodId);
    if (!food) throw new Error('DIARY_FOOD_NOT_FOUND');
    return { name: food.name, nutritionPer100g: food.nutritionPer100g };
  }
  if (source === 'custom_food') {
    const food = await loadCustomFood(uid, foodId);
    if (!food) throw new Error('DIARY_FOOD_NOT_FOUND');
    return { name: food.name, nutritionPer100g: food.nutritionPer100g };
  }
  if (source === 'food_log_catalog') {
    const food = await loadFoodLogEntry(foodId);
    if (!food) throw new Error('DIARY_FOOD_NOT_FOUND');
    return { name: food.name, nutritionPer100g: food.nutritionPer100g };
  }
  const recipe = await loadNutritionRecipe(uid, foodId);
  if (!recipe) throw new Error('DIARY_FOOD_NOT_FOUND');
  // `per100g` honors `finalWeightG` when the recipe has one — logging the
  // SAME recipe by grams must use the cooked weight, not the raw
  // ingredient sum, whenever the user told us they differ (water loss/gain
  // during preparation, round brief §5).
  const { per100g } = await calculateStoredRecipeBreakdown(uid, foodId);
  return { name: recipe.name, nutritionPer100g: per100g };
}

async function buildLoggedItem(
  uid: string, source: NutritionLoggedFoodSource, foodId: string, grams: number, id?: string,
): Promise<LoggedItemDoc> {
  const { name, nutritionPer100g } = await resolveAuthoritativeFoodNutrition(uid, source, foodId);
  const rounded = roundNutritionValues(nutrientsForGrams(nutritionPer100g, grams));
  return {
    id: id ?? newItemId(), foodId, grams, source,
    snapshot: { name, kcal: rounded.kcal, proteinG: rounded.proteinG, carbsG: rounded.carbsG, fatG: rounded.fatG,
      ...(rounded.fiberG != null ? { fiberG: rounded.fiberG } : {}) },
    loggedAt: Timestamp.now(),
  };
}

function subtractTotals(a: NutritionTotals, b: NutritionTotals): NutritionTotals {
  return { kcal: a.kcal - b.kcal, proteinG: a.proteinG - b.proteinG, carbsG: a.carbsG - b.carbsG, fatG: a.fatG - b.fatG, fiberG: a.fiberG - b.fiberG };
}
function addTotals(a: NutritionTotals, b: NutritionTotals): NutritionTotals {
  return { kcal: a.kcal + b.kcal, proteinG: a.proteinG + b.proteinG, carbsG: a.carbsG + b.carbsG, fatG: a.fatG + b.fatG, fiberG: a.fiberG + b.fiberG };
}

/**
 * Replaces one meal's full item list (used by every write below — add,
 * edit-grams, remove and log-a-recommended-option are all "here is the
 * meal's new item set"). Reads the meal's CURRENT items with a one-shot
 * query (Firestore transactions can't run queries, only get-by-reference),
 * then commits the item/meal/day-aggregate writes together so the day's
 * running totals stay correct even though the item enumeration itself
 * wasn't inside the transaction — acceptable for a single user's own diary
 * (no cross-user contention), the same tradeoff favorites already makes.
 * Always resets `followedRecommendedOptionId` to null unless the caller
 * passes one explicitly — any manual edit stops counting as "followed"
 * (round brief §7).
 */
async function replaceMealItemsOnMeal(
  uid: string, localDate: string, slot: NutritionMealSlot,
  computeNewItems: (oldItems: readonly LoggedItemDoc[]) => LoggedItemDoc[],
  followedRecommendedOptionId: string | null = null,
): Promise<void> {
  const oldItems = await loadMealItems(uid, localDate, slot);
  const newItems = computeNewItems(oldItems);
  const oldIds = new Set(oldItems.map((item) => item.id));
  const newIds = new Set(newItems.map((item) => item.id));
  const removedIds = [...oldIds].filter((id) => !newIds.has(id));
  const newTotals = sumItemTotals(newItems);
  const ref = dayRef(uid, localDate);
  const meal = mealRef(uid, localDate, slot);

  await runTransaction(db, async (transaction) => {
    const [daySnap, mealSnap] = await Promise.all([transaction.get(ref), transaction.get(meal)]);
    const dayData = daySnap.exists() ? daySnap.data() as Omit<NutritionDailyLogDoc, 'meals'> : null;
    const oldMealTotals = mealSnap.exists() ? (mealSnap.data() as { totals: NutritionTotals }).totals : emptyTotals();
    const newDayTotals = addTotals(subtractTotals(dayData?.totals ?? emptyTotals(), oldMealTotals), newTotals);
    const newDayCount = (dayData?.loggedItemCount ?? 0) - oldItems.length + newItems.length;

    for (const id of removedIds) transaction.delete(itemRef(uid, localDate, slot, id));
    for (const item of newItems) transaction.set(itemRef(uid, localDate, slot, item.id), item);

    if (newItems.length === 0) transaction.delete(meal);
    else transaction.set(meal, { slot, totals: newTotals, followedRecommendedOptionId });

    if (dayData) {
      transaction.update(ref, { totals: newDayTotals, loggedItemCount: newDayCount, updatedAt: serverTimestamp() });
    } else {
      transaction.set(ref, {
        localDate, timezone: deviceTimeZone(), totals: newDayTotals, loggedItemCount: newDayCount,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function addDiaryFood(
  uid: string, localDate: string, slot: NutritionMealSlot, source: NutritionLoggedFoodSource, foodId: string, grams: number,
): Promise<void> {
  const item = await buildLoggedItem(uid, source, foodId, grams);
  await replaceMealItemsOnMeal(uid, localDate, slot, (oldItems) => [...oldItems, item]);
}

export async function updateDiaryEntryGrams(
  uid: string, localDate: string, slot: NutritionMealSlot, itemId: string, source: NutritionLoggedFoodSource,
  foodId: string, grams: number,
): Promise<void> {
  const item = await buildLoggedItem(uid, source, foodId, grams, itemId);
  await replaceMealItemsOnMeal(uid, localDate, slot, (oldItems) => {
    const existingIndex = oldItems.findIndex((existing) => existing.id === itemId);
    return existingIndex === -1 ? [...oldItems, item]
      : oldItems.map((existing, index) => (index === existingIndex ? item : existing));
  });
}

export async function removeDiaryEntry(uid: string, localDate: string, slot: NutritionMealSlot, itemId: string): Promise<void> {
  await replaceMealItemsOnMeal(uid, localDate, slot, (oldItems) => oldItems.filter((item) => item.id !== itemId));
}

export async function moveDiaryEntry(
  uid: string, localDate: string, fromSlot: NutritionMealSlot, toSlot: NutritionMealSlot, itemId: string,
): Promise<void> {
  if (fromSlot === toSlot) return;
  const fromItems = await loadMealItems(uid, localDate, fromSlot);
  const moved = fromItems.find((item) => item.id === itemId);
  if (!moved) return;
  const toItems = await loadMealItems(uid, localDate, toSlot);
  const newFromItems = fromItems.filter((item) => item.id !== itemId);
  const newToItems = [...toItems, moved];
  const newFromTotals = sumItemTotals(newFromItems);
  const newToTotals = sumItemTotals(newToItems);
  const fromMeal = mealRef(uid, localDate, fromSlot);
  const toMeal = mealRef(uid, localDate, toSlot);

  // Total logged items/kcal for the day don't change on a move (the item
  // just moves between two meals), so the day-level aggregate is untouched.
  await runTransaction(db, async (transaction) => {
    transaction.delete(itemRef(uid, localDate, fromSlot, itemId));
    transaction.set(itemRef(uid, localDate, toSlot, itemId), moved);
    if (newFromItems.length === 0) transaction.delete(fromMeal);
    else transaction.set(fromMeal, { slot: fromSlot, totals: newFromTotals, followedRecommendedOptionId: null });
    transaction.set(toMeal, { slot: toSlot, totals: newToTotals, followedRecommendedOptionId: null });
  });
}

// Diet-quality-v3 (2026-10-10, "PLANO RECOMENDADO != CONSUMO REGISTRADO"):
// `logMealOption` used to persist a plan/alternative/favorite option's
// foods directly into the diary as if they were real catalog entries —
// removed entirely. A recommended option's items have no catalog id at
// all now (free-form AI estimates), so there is nothing left to resolve.
// Registering a recommended meal now opens `RegisterMealScreen` with the
// slot pre-selected and the option shown only as a text reference; the
// user searches/adds the REAL food they ate through the existing
// `addDiaryFood` path below, unchanged.
export { todayLocalDate };
