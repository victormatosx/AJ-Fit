import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../nutritionFoods', () => ({
  loadCatalogFood: vi.fn(async () => null),
  loadCustomFood: vi.fn(async () => null),
}));
vi.mock('../foodLogCatalog', () => ({
  loadFoodLogEntry: vi.fn(async (id: string) => id === 'flc_off_whey'
    ? { id, nutritionPer100g: { kcal: 400, proteinG: 80, carbsG: 8, fatG: 4, fiberG: null } } : null),
}));

import { resolveRecipeFoodValues } from '../nutritionRecipes';

describe('recipe food-log catalog compatibility', () => {
  it('resolves an flc_ ingredient from the broad logging catalog', async () => {
    const values = await resolveRecipeFoodValues('uid', { ingredients: [{ foodId: 'flc_off_whey', grams: 30 }] });
    expect(values.get('flc_off_whey')).toEqual({ kcal: 400, proteinG: 80, carbsG: 8, fatG: 4, fiberG: null });
  });

  it('keeps missing catalog entries unresolved so recipe calculation fails safely instead of inventing macros', async () => {
    const values = await resolveRecipeFoodValues('uid', { ingredients: [{ foodId: 'flc_off_missing', grams: 30 }] });
    expect(values.has('flc_off_missing')).toBe(false);
  });
});
