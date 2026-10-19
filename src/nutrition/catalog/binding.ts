import type { NutritionCatalogBinding, NutritionFoodNutritionValues, NutritionPlanFoodItem } from '../../types/nutrition';
import { nutrientsForGrams, roundNutritionValues, validateNutritionValues } from './math';

/** Exact canonical revision, deliberately not a lossy name/hash match. */
export function catalogNutritionRevision(food: {
  id: string; name: string; source: { type: string; sourceId: string }; catalogVersion: string;
  nutritionPer100g: NutritionFoodNutritionValues;
  brand?: { name: string } | null;
  preparation?: string | null;
  allergens?: string[] | null;
  dietaryFlags?: { vegetarian: boolean | null; vegan: boolean | null; pescatarian: boolean | null };
}): string {
  const n = food.nutritionPer100g;
  return JSON.stringify([1, food.id, food.name, food.source.type, food.source.sourceId, food.catalogVersion,
    n.kcal, n.proteinG, n.carbsG, n.fatG, n.fiberG ?? null,
    food.brand?.name ?? null, food.preparation ?? null,
    food.allergens == null ? null : [...food.allergens].sort(),
    food.dietaryFlags ? [food.dietaryFlags.vegetarian, food.dietaryFlags.vegan, food.dietaryFlags.pescatarian] : null]);
}

export function validCatalogBinding(value: unknown): value is NutritionCatalogBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as NutritionCatalogBinding;
  if (b.schemaVersion !== 1 || !['nutritionFoods', 'foodLogCatalog'].includes(b.collection)
    || typeof b.foodId !== 'string' || !/^(nf_|flc_)[A-Za-z0-9_-]{1,116}$/.test(b.foodId)
    || (b.collection === 'nutritionFoods') !== b.foodId.startsWith('nf_')
    || !b.source || !['taco', 'off'].includes(b.source.type) || !b.source.sourceId
    || typeof b.catalogVersion !== 'string' || typeof b.nutritionRevision !== 'string'
    || b.nutritionRevision.length > 2000 || !Number.isFinite(b.grams) || b.grams <= 0 || b.grams > 600) return false;
  try { validateNutritionValues(b.nutritionPer100g); }
  catch { return false; }
  return typeof b.nutritionPer100g.fiberG === 'number';
}

export function isCatalogLinkedOption(foods: readonly NutritionPlanFoodItem[]): boolean {
  return foods.length > 0 && foods.every((item) => validCatalogBinding(item.catalogBinding));
}

export function catalogItemNutrition(binding: NutritionCatalogBinding): NutritionFoodNutritionValues {
  if (!validCatalogBinding(binding)) throw new Error('INVALID_CATALOG_BINDING');
  return roundNutritionValues(nutrientsForGrams(binding.nutritionPer100g, binding.grams));
}
