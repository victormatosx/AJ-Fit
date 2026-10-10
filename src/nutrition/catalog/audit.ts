import type { NutritionFood } from '../../types/nutrition';

export interface CatalogAuditReport {
  totalFoods: number;
  statusCounts: Record<string, number>;
  byCategory: Record<string, number>;
  approvedWithKnownAllergens: number;
  approvedWithFiberKnown: number;
  approvedMissingFiber: number;
  anyFoodWithKnownAllergens: number;
  anyFoodWithResolvedDietaryFlags: number;
}

/**
 * Diet-quality-v3 (2026-10-10): this used to also report candidate-pool
 * coverage per dietary-pattern/meal-count by reusing the real generation
 * candidate builder — that concept no longer exists (generation is
 * free-form, not catalog-bound), so this is now a plain composition
 * report: how much of the catalog is reviewed/approved, for the DIARY/
 * food-logging use of `nutritionFoods`, not for any generation gate.
 */
export function buildCatalogAuditReport(foods: readonly NutritionFood[]): CatalogAuditReport {
  const byCategory = foods.reduce<Record<string, number>>((acc, food) => {
    acc[food.category] = (acc[food.category] ?? 0) + 1;
    return acc;
  }, {});
  const statusCounts = foods.reduce<Record<string, number>>((acc, food) => {
    acc[food.generationStatus] = (acc[food.generationStatus] ?? 0) + 1;
    return acc;
  }, {});
  const approved = foods.filter((food) => food.generationStatus === 'approved');
  const approvedWithFiberKnown = approved.filter((food) => food.nutritionPer100g?.fiberG != null).length;

  return {
    totalFoods: foods.length,
    statusCounts,
    byCategory,
    approvedWithKnownAllergens: approved.filter((food) => food.allergens !== null).length,
    approvedWithFiberKnown,
    approvedMissingFiber: approved.length - approvedWithFiberKnown,
    anyFoodWithKnownAllergens: foods.filter((food) => food.allergens !== null).length,
    anyFoodWithResolvedDietaryFlags: foods.filter((food) => Object.values(food.dietaryFlags).every((v) => v !== null)).length,
  };
}
