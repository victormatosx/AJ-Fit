import { describe, expect, it } from 'vitest';
import { dedupeFoodLogSearchResults, rankFoodLogResults } from '../rank';
import type { FoodLogEntry } from '../../../types/nutrition';


function entry(overrides: Partial<FoodLogEntry>): FoodLogEntry {
  return {
    id: overrides.id ?? 'flc_taco_x', name: overrides.name ?? 'Arroz', aliases: overrides.aliases ?? [],
    source: overrides.source ?? { type: 'taco', sourceId: '1', sourceName: 'TACO' },
    locale: 'pt-BR', category: 'cereal',
    nutritionPer100g: { kcal: 100, proteinG: 1, carbsG: 20, fatG: 1, fiberG: null },
    status: 'active', provenance: { license: 'public_domain', attributionRequired: false },
    catalogVersion: 'v1', searchPrefixes: [], createdAt: null, updatedAt: null,
    ...overrides,
  } as FoodLogEntry;
}

describe('rankFoodLogResults', () => {
  it('ranks an exact normalized match before a prefix match before a contains match', () => {
    const exact = entry({ id: 'a', name: 'Frango' });
    const prefix = entry({ id: 'b', name: 'Frango grelhado' });
    const contains = entry({ id: 'c', name: 'Peito de frango' });
    const ranked = rankFoodLogResults([contains, prefix, exact], 'frango');
    expect(ranked.map((food) => food.id)).toEqual(['a', 'b', 'c']);
  });

  it('is accent-insensitive on both the query and the stored name', () => {
    const food = entry({ id: 'a', name: 'Muçarela' });
    expect(rankFoodLogResults([food], 'mucarela')[0].id).toBe('a');
    expect(rankFoodLogResults([food], 'MUÇARELA')[0].id).toBe('a');
  });

  it('matches via alias before falling back to a generic contains match', () => {
    const aliasMatch = entry({ id: 'a', name: 'Mandioca', aliases: ['Aipim'] });
    const containsMatch = entry({ id: 'b', name: 'Farofa de aipim' });
    const ranked = rankFoodLogResults([containsMatch, aliasMatch], 'aipim');
    expect(ranked.map((food) => food.id)).toEqual(['a', 'b']);
  });

  it('prefers TACO/TBCA (generic) over OFF (branded) at the same relevance tier', () => {
    const branded = entry({ id: 'off1', name: 'Frango a passarinho', source: { type: 'off', sourceId: '123', sourceName: 'Open Food Facts' } });
    const generic = entry({ id: 'taco1', name: 'Frango assado', source: { type: 'taco', sourceId: '1', sourceName: 'TACO' } });
    const ranked = rankFoodLogResults([branded, generic], 'frango');
    expect(ranked.map((food) => food.id)).toEqual(['taco1', 'off1']);
  });

  it('falls back to alphabetical order within the same tier and source rank', () => {
    const b = entry({ id: 'b', name: 'Frango b' });
    const a = entry({ id: 'a', name: 'Frango a' });
    const ranked = rankFoodLogResults([b, a], 'frango');
    expect(ranked.map((food) => food.id)).toEqual(['a', 'b']);
  });

  it('never lets a weak favorite beat an exact semantic match', () => {
    const exact = entry({ id: 'exact', name: 'Frango' });
    const favorited = entry({ id: 'fav', name: 'Frango a passarinho industrializado' });
    const ranked = rankFoodLogResults([exact, favorited], 'frango', { favoriteIds: new Set(['fav']) });
    expect(ranked[0].id).toBe('exact');
  });

  it('uses favorite then recent only as tie-breakers inside one relevance tier', () => {
    const plain = entry({ id: 'plain', name: 'Frango assado' });
    const recent = entry({ id: 'recent', name: 'Frango cozido' });
    const favorited = entry({ id: 'fav', name: 'Frango grelhado' });
    const ranked = rankFoodLogResults([plain, recent, favorited], 'frango',
      { favoriteIds: new Set(['fav']), recentIds: new Set(['recent']) });
    expect(ranked.map((food) => food.id)).toEqual(['fav', 'recent', 'plain']);
  });

  it('ranks a whole-word token match above a mid-word/buried substring match', () => {
    const token = entry({ id: 'token', name: 'Ovo, de galinha, cru' });
    const buried = entry({ id: 'buried', name: 'Sovoro, petisco' }); // 'ovo' is buried inside 'Sovoro', not a standalone token
    const ranked = rankFoodLogResults([buried, token], 'ovo');
    expect(ranked.map((food) => food.id)).toEqual(['token', 'buried']);
  });

  it.each(['ovo', 'frango'])('keeps a real whole-word %s result above a buried substring', (query) => {
    const real = entry({ id: 'real', name: query === 'ovo' ? 'Ovo, de galinha, cru' : 'Frango, peito, cru' });
    const buried = entry({ id: 'buried', name: query === 'ovo' ? 'Sovoro snack' : 'Afrangolado produto' });
    expect(rankFoodLogResults([buried, real], query)[0].id).toBe('real');
  });

  it('expands the query through its synonym group when ranking (Fase C3)', () => {
    const food = entry({ id: 'a', name: 'Queijo mussarela fatiado' });
    expect(rankFoodLogResults([food], 'muçarela')[0].id).toBe('a');
  });

  it('prefers a whole apple token over the coincidental macarrão prefix', () => {
    const apple = entry({ id: 'apple', name: 'Maçã, crua' });
    const pasta = entry({ id: 'pasta', name: 'Macarrão instantâneo' });
    expect(rankFoodLogResults([pasta, apple], 'maçã')[0].id).toBe('apple');
  });

  it('prefers a name beginning with the food over an incidental later token', () => {
    const direct = entry({ id: 'direct', name: 'Frango, peito, cru' });
    const preparation = entry({ id: 'prepared', name: 'Empada de frango' });
    expect(rankFoodLogResults([preparation, direct], 'frango')[0].id).toBe('direct');
  });

  it('prefers a food named sopa over a product whose brand alone is Sopa', () => {
    const real = entry({ id: 'real', name: 'Sopa de legumes' });
    const branded = entry({ id: 'brand', name: 'Vono', aliases: ['Sopa'], brand: { name: 'Sopa' },
      source: { type: 'off', sourceId: '2', sourceName: 'Open Food Facts' } });
    expect(rankFoodLogResults([branded, real], 'sopa')[0].id).toBe('real');
  });

  it('keeps a specific brand query above otherwise generic source preference', () => {
    const generic = entry({ id: 'generic', name: 'Iogurte natural Nestlé-like' });
    const branded = entry({ id: 'brand', name: 'Iogurte natural', aliases: ['Nestlé'], brand: { name: 'Nestlé' },
      source: { type: 'off', sourceId: '2', sourceName: 'Open Food Facts' } });
    const secondBranded = entry({ id: 'brand2', name: 'Cereal infantil', aliases: ['Nestlé'], brand: { name: 'Nestlé' },
      source: { type: 'off', sourceId: '3', sourceName: 'Open Food Facts' } });
    expect(rankFoodLogResults([generic, secondBranded, branded], 'nestlé')[0].id).toBe('brand2');
  });
});

describe('dedupeFoodLogSearchResults', () => {
  it('collapses duplicate source ids and barcodes without changing the winning macros', () => {
    const winner = entry({ id: 'a', name: 'Granola', barcode: '7891234567890',
      nutritionPer100g: { kcal: 400, proteinG: 10, carbsG: 60, fatG: 12, fiberG: 7 } });
    const duplicate = entry({ id: 'b', name: 'Granola duplicada', barcode: '7891234567890',
      nutritionPer100g: { kcal: 999, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null } });
    const result = dedupeFoodLogSearchResults([winner, duplicate]);
    expect(result).toHaveLength(1);
    expect(result[0].nutritionPer100g.kcal).toBe(400);
  });

  it('collapses exact normalized name+brand duplicates but preserves different brands', () => {
    const first = entry({ id: 'a', name: 'Whey Protein', brand: { name: 'Dux' }, source: { type: 'off', sourceId: '1', sourceName: 'OFF' } });
    const duplicate = entry({ id: 'b', name: 'WHEY  PROTEIN', brand: { name: 'Dux' }, source: { type: 'off', sourceId: '2', sourceName: 'OFF' } });
    const otherBrand = entry({ id: 'c', name: 'Whey Protein', brand: { name: 'Outra' }, source: { type: 'off', sourceId: '3', sourceName: 'OFF' } });
    expect(dedupeFoodLogSearchResults([first, duplicate, otherBrand]).map((food) => food.id)).toEqual(['a', 'c']);
  });
});
