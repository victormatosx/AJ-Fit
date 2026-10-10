import type { NutritionMeal, NutritionMealOption, NutritionPlanFoodItem, NutritionPlanPayload } from '../../types/nutrition';

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
 * Without a Diary yet (this round's explicit scope), "next meal" / "today's
 * meals" cannot be derived from real consumption — only from the plan's own
 * structure. The first `mealSlots`-ordered meal is surfaced as "next", the
 * rest as the day's list; this never claims anything about what was
 * actually eaten (`08_frontend/screens.md` §1, `states_and_loading.md` §2).
 */
export function nextPlanMeal(plan: Pick<NutritionPlanPayload, 'meals'>): NutritionMeal | null {
  return plan.meals[0] ?? null;
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
