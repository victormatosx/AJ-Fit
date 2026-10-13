import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../nutritionFoods', () => ({
  loadCatalogFood: vi.fn(async (id: string) => (id === 'nf_taco_known'
    ? { id, name: 'Arroz, integral, cozido', nutritionPer100g: { kcal: 124, proteinG: 2.6, carbsG: 25.8, fatG: 1, fiberG: 2.7 } } : null)),
  loadCustomFood: vi.fn(async (_uid: string, id: string) => (id === 'custom_known'
    ? { id, name: 'Minha vitamina', nutritionPer100g: { kcal: 200, proteinG: 10, carbsG: 20, fatG: 5, fiberG: null } } : null)),
}));
vi.mock('../foodLogCatalog', () => ({
  loadFoodLogEntry: vi.fn(async (id: string) => (id === 'flc_off_known'
    ? { id, name: 'Achocolatado em po', status: 'active', nutritionPer100g: { kcal: 86, proteinG: 3.5, carbsG: 13, fatG: 2.1, fiberG: 0.4 } }
    : id === 'flc_off_hidden' ? { id, name: 'Produto retirado', status: 'hidden',
      nutritionPer100g: { kcal: 999, proteinG: 99, carbsG: 99, fatG: 99, fiberG: null } } : null)),
}));
vi.mock('../nutritionRecipes', () => ({ calculateStoredRecipeBreakdown: vi.fn(), loadNutritionRecipe: vi.fn() }));

import { loadFavoriteFoods } from '../nutritionFavorites';

describe('loadFavoriteFoods — id-prefix dispatch across all three food namespaces', () => {
  it('resolves a custom_ id from the user\'s own custom foods', async () => {
    const [view] = await loadFavoriteFoods('uid1', ['custom_known']);
    expect(view).toMatchObject({ foodId: 'custom_known', origin: 'custom', name: 'Minha vitamina' });
  });

  it('resolves an flc_ id from the Fase C2 food-log catalog, not nutritionFoods', async () => {
    const [view] = await loadFavoriteFoods('uid1', ['flc_off_known']);
    expect(view).toMatchObject({ foodId: 'flc_off_known', origin: 'food_log', name: 'Achocolatado em po' });
  });

  it('falls back to the generation catalog for any other id shape (nf_ prefix)', async () => {
    const [view] = await loadFavoriteFoods('uid1', ['nf_taco_known']);
    expect(view).toMatchObject({ foodId: 'nf_taco_known', origin: 'catalog', name: 'Arroz, integral, cozido' });
  });

  it('keeps unresolved ids visible as unavailable so the user can remove them', async () => {
    const resolved = await loadFavoriteFoods('uid1', ['custom_gone', 'flc_off_gone', 'nf_gone']);
    expect(resolved).toHaveLength(3);
    expect(resolved.every((item) => !item.available && item.nutritionPer100g == null)).toBe(true);
  });

  it('marks hidden/deprecated logging foods unavailable and does not expose their macros', async () => {
    const [view] = await loadFavoriteFoods('uid1', ['flc_off_hidden']);
    expect(view).toMatchObject({ foodId: 'flc_off_hidden', available: false, nutritionPer100g: null });
  });

  it('resolves a mixed list correctly, each id in its own namespace', async () => {
    const resolved = await loadFavoriteFoods('uid1', ['custom_known', 'flc_off_known', 'nf_taco_known']);
    expect(resolved.map((view) => view.origin)).toEqual(['custom', 'food_log', 'catalog']);
  });
});
