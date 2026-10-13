import type { FoodLogServingUnit, NutritionFoodNutritionValues } from '../../types/nutrition';
import { nutrientsForGrams } from './math';

/**
 * Fase C6 ("serving units") — deterministic unit -> grams -> macros
 * conversion. `nutritionPer100g` stays the ONE canonical nutrition basis
 * for every food (round brief: "não alterar os macros canônicos"); a
 * `FoodLogServingUnit` only supplies the gram equivalence this module uses
 * to scale it. Never guesses a g/ml density: a unit with only
 * `mlEquivalent` and no `gramEquivalent` resolves to `null` here rather
 * than assuming water-like density.
 */

/** Grams for `count` repeats of `unit` — `null` when `unit` has no gram basis to scale from. */
export function servingGrams(unit: FoodLogServingUnit, count = 1): number | null {
  if (unit.gramEquivalent == null || !Number.isFinite(unit.gramEquivalent) || unit.gramEquivalent <= 0) return null;
  if (!Number.isFinite(unit.quantity) || unit.quantity <= 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  return (unit.gramEquivalent / unit.quantity) * count;
}

/** `null` whenever `servingGrams` would be `null` — never a fabricated macro value for a unit without a confident gram basis. */
export function nutrientsForServing(
  nutritionPer100g: NutritionFoodNutritionValues, unit: FoodLogServingUnit, count = 1,
): NutritionFoodNutritionValues | null {
  const grams = servingGrams(unit, count);
  return grams == null ? null : nutrientsForGrams(nutritionPer100g, grams);
}

/** The pre-selected unit (`defaultServingId`) when it both exists and has a usable gram basis; otherwise the first servable unit; `null` when none qualify (grams-only food). */
export function resolveDefaultServingUnit(
  servings: readonly FoodLogServingUnit[] | undefined, defaultServingId: string | null | undefined,
): FoodLogServingUnit | null {
  if (!servings || servings.length === 0) return null;
  const servable = servings.filter((unit) => servingGrams(unit) != null);
  if (servable.length === 0) return null;
  const preferred = defaultServingId ? servable.find((unit) => unit.id === defaultServingId) : undefined;
  return preferred ?? servable[0];
}
