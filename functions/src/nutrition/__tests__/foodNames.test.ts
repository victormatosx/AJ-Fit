import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { resolvePromptFoodNames } from '../generation/foodNames';

function database(names: Record<string, string>) {
  return { collection: vi.fn(() => ({ doc: (id: string) => ({ get: async () => ({ id, data: () => names[id] ? { name: names[id] } : undefined }) }) })) } as unknown as Firestore;
}
describe('food names for hard restrictions', () => {
  it('does not silently drop unresolved exclusions', async () => {
    await expect(resolvePromptFoodNames(database({}), { preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: ['missing'] }))
      .rejects.toThrow('INVALID_NUTRITION_PROFILE');
  });
  it('resolves manually added foods only inside the authenticated user collection', async () => {
    const privateFood = vi.fn(async () => ({ id: 'custom_1', data: () => ({ name: 'Jiló' }) }));
    const owner = vi.fn(() => ({ collection: (name: string) => {
      expect(name).toBe('nutritionFoods');
      return { doc: () => ({ get: privateFood }) };
    } }));
    const db = { collection: (name: string) => { expect(name).toBe('users'); return { doc: owner }; } } as unknown as Firestore;
    expect(await resolvePromptFoodNames(db, { preferredFoodIds: [], usualFoodIds: [], excludedFoodIds: ['custom_1'] }, 'owner-uid'))
      .toEqual({ preferred: [], usual: [], excluded: ['Jiló'] });
    expect(owner).toHaveBeenCalledWith('owner-uid');
  });
  it('preserves historical usual foods and combines global-pattern-independent exclusions', async () => {
    expect(await resolvePromptFoodNames(database({ rice: 'Arroz', beans: 'Feijão', milk: 'Leite' }), {
      preferredFoodIds: ['rice', 'missing'], usualFoodIds: ['beans'], excludedFoodIds: ['milk'],
    })).toEqual({ preferred: ['Arroz'], usual: ['Feijão'], excluded: ['Leite'] });
  });
});
