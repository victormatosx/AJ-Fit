import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase', () => ({ db: {} }));
vi.mock('../../../lib/firebaseFunctions', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

import { createFatSecretSearchProvider } from '../fatsecretProvider';

describe('createFatSecretSearchProvider', () => {
  it('maps a successful raw FatSecret response into normalized FoodLogEntry results', async () => {
    const provider = createFatSecretSearchProvider({
      callExternalSearch: async () => ({
        provider: 'fatsecret',
        response: { foods: { food: [
          { food_id: '1', food_name: 'YoPRO Morango', brand_name: 'YoPRO', food_description: 'Per 250g - Calories: 200kcal | Fat: 5g | Carbs: 20g | Protein: 25g' },
        ] } },
      }),
    });
    const result = await provider.search('yopro morango');
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0]).toMatchObject({ name: 'YoPRO Morango', source: { type: 'fatsecret', sourceId: '1' }, brand: { name: 'YoPRO' } });
    expect(result.nextCursor).toBeNull();
  });

  it('silently drops items it cannot normalize (non-gram serving) without failing the whole search', async () => {
    const provider = createFatSecretSearchProvider({
      callExternalSearch: async () => ({
        provider: 'fatsecret',
        response: { foods: { food: [
          { food_id: '1', food_name: 'Coca-Cola Zero', food_description: 'Per 1 lata (350ml) - Calories: 0kcal | Fat: 0g | Carbs: 0g | Protein: 0g' },
          { food_id: '2', food_name: 'Big Mac', food_description: 'Per 100g - Calories: 257kcal | Fat: 12g | Carbs: 30g | Protein: 10g' },
        ] } },
      }),
    });
    const result = await provider.search('big mac');
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe('Big Mac');
  });

  it('never throws when the backend call fails (rate limit, unavailable, missing credentials) — returns an empty result', async () => {
    const provider = createFatSecretSearchProvider({ callExternalSearch: async () => { throw new Error('EXTERNAL_FOOD_PROVIDER_UNAVAILABLE'); } });
    const result = await provider.search('del valle');
    expect(result).toEqual({ foods: [], nextCursor: null });
  });

  it('handles a single-food response (not wrapped in an array, per FatSecret quirk) the same as a list', async () => {
    const provider = createFatSecretSearchProvider({
      callExternalSearch: async () => ({
        provider: 'fatsecret',
        response: { foods: { food: { food_id: '1', food_name: 'Del Valle Suco de Uva', food_description: 'Per 100g - Calories: 45kcal | Fat: 0g | Carbs: 11g | Protein: 0g' } } },
      }),
    });
    const result = await provider.search('del valle');
    expect(result.foods).toHaveLength(1);
  });
});
