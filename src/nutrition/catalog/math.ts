import type { NutritionFoodNutritionValues, NutritionRecipeIngredient } from '../../types/nutrition';

const MAX_VALUE = 100000;
const KEYS = ['kcal', 'proteinG', 'carbsG', 'fatG'] as const;

export function validateNutritionValues(value: unknown): asserts value is NutritionFoodNutritionValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_NUTRITION_VALUES');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => ![...KEYS, 'fiberG'].includes(key as typeof KEYS[number]))
    || KEYS.some((key) => typeof v[key] !== 'number' || !Number.isFinite(v[key]) || (v[key] as number) < 0 || (v[key] as number) > MAX_VALUE)
    || ('fiberG' in v && v.fiberG !== null
      && (typeof v.fiberG !== 'number' || !Number.isFinite(v.fiberG) || v.fiberG < 0 || v.fiberG > MAX_VALUE))) {
    throw new Error('INVALID_NUTRITION_VALUES');
  }
}

export function roundNutrition(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_NUTRITION_NUMBER');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Missing fiber remains unknown; calculations retain full precision until the final result. */
export function nutrientsForGrams(values: NutritionFoodNutritionValues, grams: number): NutritionFoodNutritionValues {
  validateNutritionValues(values);
  if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) throw new Error('INVALID_GRAMS');
  const scale = grams / 100;
  return { kcal: values.kcal * scale, proteinG: values.proteinG * scale,
    carbsG: values.carbsG * scale, fatG: values.fatG * scale,
    fiberG: values.fiberG == null ? null : values.fiberG * scale };
}

export function sumNutritionValues(values: readonly NutritionFoodNutritionValues[]): NutritionFoodNutritionValues {
  for (const value of values) validateNutritionValues(value);
  return { kcal: values.reduce((sum, v) => sum + v.kcal, 0),
    proteinG: values.reduce((sum, v) => sum + v.proteinG, 0),
    carbsG: values.reduce((sum, v) => sum + v.carbsG, 0),
    fatG: values.reduce((sum, v) => sum + v.fatG, 0),
    fiberG: values.some((v) => v.fiberG == null) ? null : values.reduce((sum, v) => sum + (v.fiberG ?? 0), 0) };
}

export function roundNutritionValues(values: NutritionFoodNutritionValues): NutritionFoodNutritionValues {
  validateNutritionValues(values);
  return { kcal: roundNutrition(values.kcal), proteinG: roundNutrition(values.proteinG),
    carbsG: roundNutrition(values.carbsG), fatG: roundNutrition(values.fatG),
    fiberG: values.fiberG == null ? null : roundNutrition(values.fiberG) };
}

export function calculateRecipeNutrition(
  ingredients: readonly NutritionRecipeIngredient[],
  foods: ReadonlyMap<string, NutritionFoodNutritionValues>,
): NutritionFoodNutritionValues {
  if (ingredients.length < 1 || ingredients.length > 6) throw new Error('INVALID_RECIPE_INGREDIENTS');
  const portions = ingredients.map(({ foodId, grams }) => {
    const values = foods.get(foodId);
    if (!values) throw new Error(`MISSING_RECIPE_FOOD:${foodId}`);
    return nutrientsForGrams(values, grams);
  });
  return roundNutritionValues(sumNutritionValues(portions));
}

export function totalIngredientWeightG(ingredients: readonly NutritionRecipeIngredient[]): number {
  return ingredients.reduce((sum, ingredient) => sum + ingredient.grams, 0);
}

/**
 * `total` divided by an arbitrary positive number — the one operation
 * both "per 100 g" (`divisor = finalWeightG / 100`) and "per serving"
 * (`divisor = servings`) reduce to. Missing fiber stays `null` through
 * division, same convention as `nutrientsForGrams`/`sumNutritionValues`.
 */
export function divideNutritionValues(total: NutritionFoodNutritionValues, divisor: number): NutritionFoodNutritionValues {
  validateNutritionValues(total);
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('INVALID_DIVISOR');
  return { kcal: total.kcal / divisor, proteinG: total.proteinG / divisor,
    carbsG: total.carbsG / divisor, fatG: total.fatG / divisor,
    fiberG: total.fiberG == null ? null : total.fiberG / divisor };
}

export interface RecipeNutritionBreakdown {
  /** Sum of every ingredient's grams — always shown, independent of `finalWeightG`. */
  totalIngredientWeightG: number;
  /** `finalWeightG` when the user filled it in, else `totalIngredientWeightG` — the denominator actually used for `per100g`. */
  resolvedWeightG: number;
  /** True when no `finalWeightG` was provided, i.e. `resolvedWeightG` is the ingredient-sum fallback (round brief §5: "deixar isso claro na UI"). */
  usedIngredientWeightFallback: boolean;
  total: NutritionFoodNutritionValues;
  per100g: NutritionFoodNutritionValues;
  /** `null` whenever `servings` is absent/invalid — never a fabricated per-serving value. */
  perServing: NutritionFoodNutritionValues | null;
}

/**
 * The full "Criar receita" derivation (round brief §4-§7): totals are
 * always `calculateRecipeNutrition` over the real ingredients — never
 * client-typed. `per100g`/`perServing` are pure arithmetic over that same
 * total, never a second, independently-entered set of macros.
 */
export function calculateRecipeBreakdown(
  recipe: { ingredients: readonly NutritionRecipeIngredient[]; finalWeightG?: number | null; servings?: number | null },
  foods: ReadonlyMap<string, NutritionFoodNutritionValues>,
): RecipeNutritionBreakdown {
  const total = calculateRecipeNutrition(recipe.ingredients, foods);
  const ingredientWeightG = totalIngredientWeightG(recipe.ingredients);
  const usedIngredientWeightFallback = !(typeof recipe.finalWeightG === 'number' && recipe.finalWeightG > 0);
  const resolvedWeightG = usedIngredientWeightFallback ? ingredientWeightG : recipe.finalWeightG as number;
  const per100g = roundNutritionValues(divideNutritionValues(total, resolvedWeightG / 100));
  const perServing = typeof recipe.servings === 'number' && Number.isInteger(recipe.servings) && recipe.servings > 0
    ? roundNutritionValues(divideNutritionValues(total, recipe.servings)) : null;
  return { totalIngredientWeightG: ingredientWeightG, resolvedWeightG, usedIngredientWeightFallback, total, per100g, perServing };
}

/** Grams for `portions` servings of a recipe — round brief §9: registering a recipe "por porção" in the diary. `null` when `servings` is missing/invalid. */
export function recipePortionToGrams(
  recipe: { ingredients: readonly NutritionRecipeIngredient[]; finalWeightG?: number | null; servings?: number | null },
  portions: number,
): number | null {
  if (!(typeof recipe.servings === 'number' && Number.isInteger(recipe.servings) && recipe.servings > 0)) return null;
  if (!Number.isFinite(portions) || portions <= 0) return null;
  const resolvedWeightG = typeof recipe.finalWeightG === 'number' && recipe.finalWeightG > 0
    ? recipe.finalWeightG : totalIngredientWeightG(recipe.ingredients);
  return (resolvedWeightG / recipe.servings) * portions;
}
