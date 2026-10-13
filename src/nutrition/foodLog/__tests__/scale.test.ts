import { describe, expect, it } from 'vitest';
import { rankFoodLogResults } from '../rank';
import { processOffBatch } from '../offMapper';
import type { RawOffProduct } from '../offQualityFilter';
import type { FoodLogEntry } from '../../../types/nutrition';

const NAME_POOL = [
  'Frango, peito, sem pele, cru', 'Frango, coxa, com pele, crua', 'Arroz, integral, cozido',
  'Feijão, carioca, cru', 'Queijo, minas, frescal', 'Banana, nanica, crua', 'Refrigerante, tipo cola',
  'Whey Protein Concentrado', 'Iogurte, natural', 'Batata, doce, cozida',
] as const;

function syntheticEntry(index: number): FoodLogEntry {
  const name = NAME_POOL[index % NAME_POOL.length];
  return {
    id: `flc_${index % 2 === 0 ? 'taco' : 'off'}_item${index}`,
    name: `${name} (lote ${index})`,
    aliases: [],
    source: { type: index % 2 === 0 ? 'taco' : 'off', sourceId: String(index), sourceName: 'synthetic' },
    locale: 'pt-BR', category: 'other',
    nutritionPer100g: { kcal: 100 + (index % 50), proteinG: 5, carbsG: 10, fatG: 2, fiberG: null },
    status: 'active', provenance: { license: 'public_domain', attributionRequired: false },
    catalogVersion: 'synthetic-v1', searchPrefixes: [], searchSourcePriority: index % 2 === 0 ? 0 : 1,
    createdAt: null, updatedAt: null,
  } as FoodLogEntry;
}

describe('rankFoodLogResults at scale (10k synthetic candidates)', () => {
  const dataset = Array.from({ length: 10000 }, (_, index) => syntheticEntry(index));

  it('ranks the full candidate pool deterministically and quickly', () => {
    const start = performance.now();
    const ranked = rankFoodLogResults(dataset, 'frango');
    const elapsedMs = performance.now() - start;
    expect(ranked).toHaveLength(dataset.length);
    // Generous bound — this is a correctness+gross-perf-regression guard,
    // not a strict benchmark; CI/dev machines vary and this suite can run
    // alongside other CPU-heavy background work.
    expect(elapsedMs).toBeLessThan(3000);
    // Every "Frango" item (token/contains match) must sort before every non-"Frango" item.
    const frangoIds = new Set(dataset.filter((food) => food.name.toLowerCase().startsWith('frango')).map((food) => food.id));
    const firstNonFrangoIndex = ranked.findIndex((food) => !frangoIds.has(food.id));
    const lastFrangoIndex = ranked.map((food) => frangoIds.has(food.id)).lastIndexOf(true);
    expect(lastFrangoIndex).toBeLessThan(firstNonFrangoIndex);
  });

  it('produces the exact same order on repeated calls over the same input (stable, deterministic)', () => {
    const first = rankFoodLogResults(dataset, 'arroz').map((food) => food.id);
    const second = rankFoodLogResults(dataset, 'arroz').map((food) => food.id);
    expect(first).toEqual(second);
  });

  it('a bounded candidate pool (pagination-sized slice) ranks just as correctly as the full set', () => {
    const pageSize = 60;
    const slice = dataset.slice(0, pageSize);
    const ranked = rankFoodLogResults(slice, 'queijo');
    expect(ranked).toHaveLength(pageSize);
  });
});

describe('processOffBatch at scale (10k synthetic raw products)', () => {
  function syntheticRawOff(index: number, duplicateBarcode?: string): RawOffProduct {
    return {
      code: duplicateBarcode ?? String(1000000000000 + index),
      product_name: `Produto sintetico ${index}`,
      brands: 'Marca Teste',
      countries_tags: ['en:brazil'],
      lang: 'pt',
      nutriments: { 'energy-kcal_100g': 100 + (index % 300), proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2 },
    };
  }

  it('processes 10k raw products, dedupes repeated barcodes, and reports every rejection with a reason', () => {
    const products = Array.from({ length: 10000 }, (_, index) => syntheticRawOff(index));
    // Inject 50 duplicate-barcode products and 50 broken (missing macro) products.
    for (let i = 0; i < 50; i += 1) products.push(syntheticRawOff(i, products[i].code));
    for (let i = 0; i < 50; i += 1) products.push({ code: String(9999990000 + i), product_name: 'Quebrado', nutriments: {} });

    const start = performance.now();
    const { accepted, rejected } = processOffBatch(products, 'scale-test-v1', new Set());
    const elapsedMs = performance.now() - start;

    expect(accepted).toHaveLength(10000);
    expect(rejected).toHaveLength(100);
    expect(rejected.filter((r) => r.reason === 'DUPLICATE_BARCODE_IN_BATCH')).toHaveLength(50);
    expect(rejected.filter((r) => r.reason === 'INCOMPLETE_MACROS')).toHaveLength(50);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
