import { NUTRITION_MEAL_SLOTS } from '../../types/nutrition';
import type { NutritionLoggedMeal, NutritionMeal, NutritionMealOption, NutritionPlanFoodItem, NutritionPlanPayload } from '../../types/nutrition';
import { nextUnloggedSlot } from './diaryModel';

/** The recommended option of a meal — `recommendedOptionId` always references one of `options[].id`. */
export function recommendedOption(meal: NutritionMeal): NutritionMealOption {
  const option = meal.options.find((item) => item.id === meal.recommendedOptionId);
  if (!option) throw new Error('NUTRITION_PLAN_RECOMMENDED_OPTION_MISSING');
  return option;
}

/**
 * Plan items are free-form AI names (diet-quality-v3), never resolved
 * against the catalog — `formatFoodDisplayName`'s TACO/TBCA comma-chain
 * reordering doesn't apply here; the AI's own name is rendered as-is.
 */
export function foodNames(meal: NutritionMeal): string {
  return recommendedOption(meal).foods.map((item) => item.name).join(', ');
}

/**
 * `estimatedNutrition` is only missing for an item persisted before
 * diet-quality-v3 (the old catalog architecture never stored a per-item
 * snapshot — it resolved live against `nutritionFoods`, a code path that no
 * longer exists, so there is nothing left to recompute it from). `null`
 * here means exactly that: "unknown for this historical item", which every
 * caller must render as absent info, never as `0`.
 */
export function planItemKcal(item: NutritionPlanFoodItem): number | null {
  return item.estimatedNutrition?.kcal ?? null;
}

/**
 * "Next meal" = the first meal (in canonical `NUTRITION_MEAL_SLOTS` order —
 * `plan.meals` itself just tracks the profile's `mealSlots` selection order,
 * not necessarily breakfast-first) whose slot has nothing logged in `day`
 * yet. Shares `nextUnloggedSlot`'s predicate with `NutritionDiaryScreen` so
 * the Home card and the Diário never disagree on what's next. `day: null`
 * (no Diary doc yet) means nothing is logged, so the first slot wins, same
 * as the old plan-only behavior. Returns `null` once every meal is logged —
 * never falls back to breakfast.
 */
export function nextPlanMeal<T>(
  plan: Pick<NutritionPlanPayload, 'meals'>, day: { meals: NutritionLoggedMeal<T>[] } | null,
): NutritionMeal | null {
  const orderedSlots = [...plan.meals]
    .sort((a, b) => NUTRITION_MEAL_SLOTS.indexOf(a.slot) - NUTRITION_MEAL_SLOTS.indexOf(b.slot))
    .map((meal) => meal.slot);
  const slot = nextUnloggedSlot(orderedSlots, day);
  return plan.meals.find((meal) => meal.slot === slot) ?? null;
}

export function remainingPlanMeals(plan: Pick<NutritionPlanPayload, 'meals'>): NutritionMeal[] {
  return plan.meals.slice(1);
}

export type MacroStatus = 'below' | 'near' | 'above';

/**
 * Non-punitive macro comparison (`08_frontend/components.md` §2 — "a
 * linguagem visual não deve punir"): "near" covers a generous band around
 * the goal so small, normal variance never reads as a miss.
 */
const NEAR_BAND = 0.1;

export function macroStatus(value: number, goal: number): MacroStatus {
  if (goal <= 0) return 'near';
  const ratio = value / goal;
  if (ratio < 1 - NEAR_BAND) return 'below';
  if (ratio > 1 + NEAR_BAND) return 'above';
  return 'near';
}
