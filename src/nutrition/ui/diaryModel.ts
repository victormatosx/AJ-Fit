import type {
  NutritionLoggedFoodItem, NutritionLoggedFoodSource, NutritionLoggedMeal, NutritionMealSlot,
  NutritionTotals,
} from '../../types/nutrition';

export function emptyTotals(): NutritionTotals {
  return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
}

/** Sums a meal's/day's items — plain addition, the snapshot values are already the authoritative per-item nutrients. */
export function sumItemTotals(items: readonly { snapshot: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number | null } }[]): NutritionTotals {
  return items.reduce((acc, item) => ({
    kcal: acc.kcal + item.snapshot.kcal,
    proteinG: acc.proteinG + item.snapshot.proteinG,
    carbsG: acc.carbsG + item.snapshot.carbsG,
    fatG: acc.fatG + item.snapshot.fatG,
    fiberG: acc.fiberG + (item.snapshot.fiberG ?? 0),
  }), emptyTotals());
}

export function sumMealTotals(meals: readonly { totals: NutritionTotals }[]): NutritionTotals {
  return meals.reduce((acc, meal) => ({
    kcal: acc.kcal + meal.totals.kcal, proteinG: acc.proteinG + meal.totals.proteinG,
    carbsG: acc.carbsG + meal.totals.carbsG, fatG: acc.fatG + meal.totals.fatG, fiberG: acc.fiberG + meal.totals.fiberG,
  }), emptyTotals());
}

function findMeal<T>(meals: readonly NutritionLoggedMeal<T>[], slot: NutritionMealSlot): NutritionLoggedMeal<T> | undefined {
  return meals.find((meal) => meal.slot === slot);
}

/** Pure array-rebuild — replaces (or creates) one meal's item list, clears `followedRecommendedOptionId` unless told otherwise (round brief §7: any manual edit stops counting as "followed"). */
export function replaceMealItems<T>(
  meals: readonly NutritionLoggedMeal<T>[], slot: NutritionMealSlot,
  items: readonly NutritionLoggedFoodItem<T>[], followedRecommendedOptionId: string | null = null,
): NutritionLoggedMeal<T>[] {
  const totals = sumItemTotals(items);
  const next: NutritionLoggedMeal<T> = { slot, items: [...items], totals, followedRecommendedOptionId };
  const existingIndex = meals.findIndex((meal) => meal.slot === slot);
  if (items.length === 0) return meals.filter((meal) => meal.slot !== slot);
  if (existingIndex === -1) return [...meals, next];
  return meals.map((meal, index) => (index === existingIndex ? next : meal));
}

export function upsertMealItem<T>(
  meals: readonly NutritionLoggedMeal<T>[], slot: NutritionMealSlot, item: NutritionLoggedFoodItem<T>,
): NutritionLoggedMeal<T>[] {
  const current = findMeal(meals, slot)?.items ?? [];
  const existingIndex = current.findIndex((existing) => existing.id === item.id);
  const nextItems = existingIndex === -1 ? [...current, item]
    : current.map((existing, index) => (index === existingIndex ? item : existing));
  return replaceMealItems(meals, slot, nextItems);
}

export function removeMealItem<T>(
  meals: readonly NutritionLoggedMeal<T>[], slot: NutritionMealSlot, itemId: string,
): NutritionLoggedMeal<T>[] {
  const current = findMeal(meals, slot)?.items ?? [];
  return replaceMealItems(meals, slot, current.filter((item) => item.id !== itemId));
}

export function moveMealItem<T>(
  meals: readonly NutritionLoggedMeal<T>[], fromSlot: NutritionMealSlot, toSlot: NutritionMealSlot, itemId: string,
): NutritionLoggedMeal<T>[] {
  if (fromSlot === toSlot) return [...meals];
  const fromItems = findMeal(meals, fromSlot)?.items ?? [];
  const moved = fromItems.find((item) => item.id === itemId);
  if (!moved) return [...meals];
  const afterRemoval = replaceMealItems(meals, fromSlot, fromItems.filter((item) => item.id !== itemId));
  const toItems = findMeal(afterRemoval, toSlot)?.items ?? [];
  return replaceMealItems(afterRemoval, toSlot, [...toItems, moved]);
}

export interface DiarySlotSummary { kcal: number; itemCount: number }

/** Null means "nothing logged yet" — NutritionHome's per-slot summary (round brief §6) must show that distinctly from a zero-kcal entry. */
export function diarySlotSummary<T>(day: { meals: NutritionLoggedMeal<T>[] } | null, slot: NutritionMealSlot): DiarySlotSummary | null {
  const meal = day?.meals.find((item) => item.slot === slot);
  if (!meal || meal.items.length === 0) return null;
  return { kcal: meal.totals.kcal, itemCount: meal.items.length };
}

/**
 * First slot (in the given order) with nothing logged — the single source of
 * truth for "next meal," shared by `planView.nextPlanMeal` (Dieta Home) and
 * `NutritionDiaryScreen` (Diário), so the two screens never diverge on which
 * meal counts as next.
 */
export function nextUnloggedSlot<T>(
  orderedSlots: readonly NutritionMealSlot[], day: { meals: NutritionLoggedMeal<T>[] } | null,
): NutritionMealSlot | undefined {
  return orderedSlots.find((slot) => diarySlotSummary(day, slot) == null);
}

/** `FoodSearchScreen`'s `NutritionFoodPick.origin` -> the diary's own `NutritionLoggedFoodSource` vocabulary. */
export function foodPickOriginToDiarySource(origin: 'catalog' | 'custom' | 'recipe' | 'food_log'): NutritionLoggedFoodSource {
  if (origin === 'recipe') return 'recipe';
  if (origin === 'custom') return 'custom_food';
  if (origin === 'food_log') return 'food_log_catalog';
  return 'catalog_food';
}

/**
 * `nutrientsForGrams` itself throws on an invalid amount — this lets UI
 * check validity (to disable a CTA, say) without a try/catch. Any grams
 * `>0` is accepted (round brief: "não limitar quantidade a opções
 * pré-definidas" — Register Meal never offers fixed serving presets).
 */
export function isPositiveGrams(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 10000;
}

export interface DiaryFollowedCount { logged: number; followed: number }

/** Today's "seguiu o plano X/Y" tally — X = logged meals whose items came from `followedRecommendedOptionId`, Y = all logged meals. Purely a read of already-fetched `NutritionDailyLogDoc` data, no new field. */
export function diaryFollowedCount<T>(day: { meals: NutritionLoggedMeal<T>[] } | null): DiaryFollowedCount {
  const logged = day?.meals.filter((meal) => meal.items.length > 0) ?? [];
  return { logged: logged.length, followed: logged.filter((meal) => meal.followedRecommendedOptionId != null).length };
}
