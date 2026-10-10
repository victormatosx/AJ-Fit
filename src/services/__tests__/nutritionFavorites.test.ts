import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadNutritionPreferences,
  toggleFavoriteFoodId,
  toggleFavoriteRecipeId,
} from '../nutritionFavorites';

const fake = vi.hoisted(() => ({
  preferences: null as Record<string, unknown> | null,
  mealFavorites: [{
    id: 'meal-favorite-1', source: 'plan', planId: 'plan-1', slot: 'lunch', foods: [],
    totals: { kcal: 100, proteinG: 10, carbsG: 10, fatG: 2, fiberG: 1 }, createdAt: { seconds: 1 },
  }],
}));

vi.mock('../../lib/firebase', () => ({ db: { kind: 'db' } }));
vi.mock('../nutritionFoods', () => ({ loadCatalogFood: vi.fn(), loadCustomFood: vi.fn() }));
vi.mock('../nutritionRecipes', () => ({ calculateStoredRecipeBreakdown: vi.fn(), loadNutritionRecipe: vi.fn() }));
vi.mock('firebase/firestore', () => {
  const ref = (...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) });
  const snapshot = () => ({
    exists: () => fake.preferences != null,
    data: () => fake.preferences,
  });
  return {
    collection: (_parent: unknown, ...parts: string[]) => ref(...parts),
    doc: (parent: { path?: string }, ...parts: string[]) => {
      if (parent?.path) return ref(parent.path, ...(parts.length > 0 ? parts : ['generated-id']));
      return ref(...parts);
    },
    getDoc: vi.fn(async () => snapshot()),
    getDocs: vi.fn(async () => ({
      empty: fake.mealFavorites.length === 0,
      docs: fake.mealFavorites.map((favorite) => ({ data: () => favorite, ref: ref('meal', favorite.id) })),
    })),
    runTransaction: vi.fn(async (_db: unknown, action: (transaction: unknown) => Promise<void>) => action({
      get: vi.fn(async () => snapshot()),
      set: vi.fn((_ref: unknown, value: Record<string, unknown>) => { fake.preferences = { ...value }; }),
      update: vi.fn((_ref: unknown, value: Record<string, unknown>) => {
        fake.preferences = { ...(fake.preferences ?? {}), ...value };
      }),
    })),
    serverTimestamp: () => ({ serverTimestamp: true }),
    query: (value: unknown) => value,
    orderBy: () => ({}),
    limit: () => ({}),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
  };
});

describe('nutrition favorite ids', () => {
  beforeEach(() => {
    fake.preferences = null;
  });

  it('creates the preferences document with both independent arrays on the first food favorite', async () => {
    await toggleFavoriteFoodId('user-1', 'nf_rice');
    expect(fake.preferences).toMatchObject({ favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: [] });
  });

  it('unfavorites a food by toggling the same stable id', async () => {
    fake.preferences = { favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: [], updatedAt: {} };
    await toggleFavoriteFoodId('user-1', 'nf_rice');
    expect(fake.preferences?.favoriteFoodIds).toEqual([]);
  });

  it('favorites a recipe without placing its id in the food array', async () => {
    fake.preferences = { favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: [], updatedAt: {} };
    await toggleFavoriteRecipeId('user-1', 'recipe_1');
    expect(fake.preferences).toMatchObject({ favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: ['recipe_1'] });
  });

  it('unfavorites a recipe without changing foods', async () => {
    fake.preferences = { favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: ['recipe_1'], updatedAt: {} };
    await toggleFavoriteRecipeId('user-1', 'recipe_1');
    expect(fake.preferences).toMatchObject({ favoriteFoodIds: ['nf_rice'], favoriteRecipeIds: [] });
  });

  it('keeps food and recipe toggles independent in both directions', async () => {
    await toggleFavoriteFoodId('user-1', 'nf_rice');
    await toggleFavoriteRecipeId('user-1', 'recipe_1');
    await toggleFavoriteFoodId('user-1', 'nf_rice');
    expect(fake.preferences).toMatchObject({ favoriteFoodIds: [], favoriteRecipeIds: ['recipe_1'] });
  });

  it('rejects a twenty-first id instead of silently dropping an older favorite', async () => {
    const existing = Array.from({ length: 20 }, (_, index) => `nf_${index}`);
    fake.preferences = { favoriteFoodIds: existing, favoriteRecipeIds: [], updatedAt: {} };
    await expect(toggleFavoriteRecipeId('user-1', 'recipe_1')).rejects.toThrow('NUTRITION_FAVORITES_LIMIT');
    expect(fake.preferences).toMatchObject({ favoriteFoodIds: existing, favoriteRecipeIds: [] });
  });

  it('preserves legacy meal-option favorites in their separate subcollection', async () => {
    await toggleFavoriteFoodId('user-1', 'custom_1');
    const loaded = await loadNutritionPreferences('user-1');
    expect(loaded?.favoriteFoodIds).toEqual(['custom_1']);
    expect(loaded?.favoriteRecipeIds).toEqual([]);
    expect(loaded?.favoriteMealOptions?.map((favorite) => favorite.id)).toEqual(['meal-favorite-1']);
  });
});
