import { describe, expect, it, vi } from 'vitest';
import type { Timestamp } from 'firebase/firestore';
import { createFederatedFoodLogSearchProvider, isLocalResultSufficient } from '../federatedSearchProvider';
import type { FoodLogEntry } from '../../../types/nutrition';
import type { FoodSearchProvider } from '../searchProvider';

function food(partial: Partial<FoodLogEntry<Timestamp>>): FoodLogEntry<Timestamp> {
  return {
    id: 'flc_taco_x', source: { type: 'taco', sourceId: 'x', sourceName: 'TACO' }, name: 'Frango, peito, grelhado',
    aliases: [], locale: 'pt-BR', category: 'protein_source', nutritionPer100g: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
    status: 'active', provenance: { license: 'public_domain', attributionRequired: false }, catalogVersion: 'v1',
    searchPrefixes: [], searchSourcePriority: 0, createdAt: {} as Timestamp, updatedAt: {} as Timestamp,
    ...partial,
  };
}

function stubProvider(foods: FoodLogEntry<Timestamp>[], name = 'stub'): FoodSearchProvider<Timestamp> & { calls: number } {
  const provider = { providerName: name, calls: 0, search: async () => { provider.calls += 1; return { foods, nextCursor: null }; } };
  return provider;
}

describe('isLocalResultSufficient', () => {
  it('is false for an empty result', () => expect(isLocalResultSufficient([], 'yopro morango')).toBe(false));

  it('is true when a top result textually covers every query token', () => {
    expect(isLocalResultSufficient([food({ name: 'Frango, peito, grelhado' })], 'frango grelhado')).toBe(true);
  });

  it('is false when no top result covers the query tokens (branded item absent from local)', () => {
    expect(isLocalResultSufficient([food({ name: 'Whey protein isolado' })], 'yopro morango')).toBe(false);
  });
});

describe('createFederatedFoodLogSearchProvider', () => {
  it('never calls the external provider when local results are already sufficient', async () => {
    const local = stubProvider([food({ name: 'Frango, peito, grelhado' })], 'local');
    const external = stubProvider([], 'external');
    const provider = createFederatedFoodLogSearchProvider({ localProvider: local, externalProvider: external });

    const result = await provider.search('frango grelhado');
    expect(external.calls).toBe(0);
    expect(result.foods).toHaveLength(1);
  });

  it('calls the external provider when local results are insufficient, and merges + reranks the combined set', async () => {
    const local = stubProvider([food({ name: 'Whey protein isolado', id: 'flc_taco_whey' })], 'local');
    const bigMac = food({
      id: 'flc_fatsecret_bigmac', name: 'Big Mac', source: { type: 'fatsecret', sourceId: 'bigmac-1', sourceName: 'FatSecret' },
      brand: { name: 'McDonald\'s' }, searchSourcePriority: 1,
    });
    const external = stubProvider([bigMac], 'external');
    const provider = createFederatedFoodLogSearchProvider({ localProvider: local, externalProvider: external });

    const result = await provider.search('big mac');
    expect(external.calls).toBe(1);
    expect(result.foods.map((f) => f.name)).toContain('Big Mac');
    // The exact textual match (Big Mac) should rank ahead of the unrelated local whey result.
    expect(result.foods[0].name).toBe('Big Mac');
  });

  it('degrades to local-only when the external provider throws or returns nothing, never failing the whole search', async () => {
    const local = stubProvider([food({ name: 'Whey protein isolado' })], 'local');
    const external: FoodSearchProvider<Timestamp> = { providerName: 'external', search: async () => { throw new Error('boom'); } };
    const provider = createFederatedFoodLogSearchProvider({
      localProvider: local, externalProvider: external,
      isLocalSufficient: () => false,
    });
    await expect(provider.search('yopro morango')).rejects.toThrow();
  });

  it('deduplicates a cross-provider barcode match, keeping the local row', async () => {
    const localItem = food({ id: 'flc_off_1', barcode: '7891000100103', source: { type: 'off', sourceId: 'off-1', sourceName: 'OFF' } });
    const local = stubProvider([localItem], 'local');
    const externalItem = food({
      id: 'flc_fatsecret_2', barcode: '7891000100103', name: 'Produto X', source: { type: 'fatsecret', sourceId: 'fs-2', sourceName: 'FatSecret' },
    });
    const external = stubProvider([externalItem], 'external');
    const provider = createFederatedFoodLogSearchProvider({
      localProvider: local, externalProvider: external, isLocalSufficient: () => false,
    });
    const result = await provider.search('produto x');
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].id).toBe('flc_off_1');
  });

  it('never calls the external leg on a "load more" page (cursor present)', async () => {
    const local = stubProvider([food({ name: 'Whey protein isolado' })], 'local');
    const external = stubProvider([], 'external');
    const provider = createFederatedFoodLogSearchProvider({ localProvider: local, externalProvider: external, isLocalSufficient: () => false });
    await provider.search('yopro morango', { cursor: 'v1:1:flc_taco_whey' });
    expect(external.calls).toBe(0);
  });
});
