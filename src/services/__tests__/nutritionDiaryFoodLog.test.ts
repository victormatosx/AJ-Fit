import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../foodLogCatalog', () => ({
  loadFoodLogEntry: vi.fn(async (foodId: string) => (foodId === 'flc_taco_known'
    ? { id: foodId, name: 'Frango, peito, sem pele, grelhado', nutritionPer100g: { kcal: 159, proteinG: 32, carbsG: 0, fatG: 3, fiberG: null } }
    : null)),
}));
vi.mock('../nutritionFoods', () => ({ loadCatalogFood: vi.fn(async () => null), loadCustomFood: vi.fn(async () => null) }));
vi.mock('../nutritionRecipes', () => ({ loadNutritionRecipe: vi.fn(async () => null), calculateStoredRecipeBreakdown: vi.fn() }));

import { resolveAuthoritativeFoodNutrition } from '../nutritionDiary';

describe('resolveAuthoritativeFoodNutrition — food_log_catalog source (Fase C2)', () => {
  it('resolves nutrition from the food-log catalog, independent of nutritionFoods/custom foods', async () => {
    const resolved = await resolveAuthoritativeFoodNutrition('uid1', 'food_log_catalog', 'flc_taco_known');
    expect(resolved).toEqual({ name: 'Frango, peito, sem pele, grelhado', nutritionPer100g: { kcal: 159, proteinG: 32, carbsG: 0, fatG: 3, fiberG: null } });
  });

  it('throws DIARY_FOOD_NOT_FOUND when the food-log entry does not exist', async () => {
    await expect(resolveAuthoritativeFoodNutrition('uid1', 'food_log_catalog', 'flc_off_missing')).rejects.toThrow('DIARY_FOOD_NOT_FOUND');
  });
});
