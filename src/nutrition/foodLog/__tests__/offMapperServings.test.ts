import { describe, expect, it } from 'vitest';
import { toOffFoodLogRecord } from '../offMapper';
import type { RawOffProduct } from '../offQualityFilter';

function baseProduct(overrides: Partial<RawOffProduct> = {}): RawOffProduct {
  return {
    code: '7891000412855', product_name: 'Achocolatado em po', brands: 'Nestle',
    categories_tags: ['en:beverages'], countries_tags: ['en:brazil'],
    nutriments: { 'energy-kcal_100g': 86, proteins_100g: 3.5, carbohydrates_100g: 13, fat_100g: 2.1, fiber_100g: 0.4 },
    ...overrides,
  };
}

describe('toOffFoodLogRecord — serving units (Fase C6)', () => {
  it('captures serving_quantity (already grams, OFF-normalized) as a provider_official unit, labeled with serving_size text', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: '30 g', serving_quantity: 30 }), 'v1');
    expect(record.servings).toEqual([{ id: 'porcao', label: '30 g', quantity: 1, gramEquivalent: 30, provenance: 'provider_official' }]);
  });

  it('accepts a string serving_quantity (CSV pipeline) the same way', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: '1 copo (200 ml)', serving_quantity: '200' }), 'v1');
    expect(record.servings).toEqual([{ id: 'porcao', label: '1 copo (200 ml)', quantity: 1, gramEquivalent: 200, provenance: 'provider_official' }]);
  });

  it('omits servings entirely when OFF provides no serving_quantity — never fabricates one from serving_size text alone', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: '1 lata (350ml)' }), 'v1');
    expect(record.servings).toBeUndefined();
  });

  it('falls back to a plain gram label when serving_size text is too long for a display label', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: 'x'.repeat(100), serving_quantity: 50 }), 'v1');
    expect(record.servings).toEqual([{ id: 'porcao', label: '50 g', quantity: 1, gramEquivalent: 50, provenance: 'provider_official' }]);
  });

  it('rejects an implausible serving_quantity rather than passing it through', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_quantity: -5 }), 'v1');
    expect(record.servings).toBeUndefined();
  });

  it('accepts a serving_quantity at the plausible-serving ceiling (600 g, a confirmed single-tray meal)', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: '1 serving (600 g)', serving_quantity: 600 }), 'v1');
    expect(record.servings).toEqual([{ id: 'porcao', label: '1 serving (600 g)', quantity: 1, gramEquivalent: 600, provenance: 'provider_official' }]);
  });

  it('rejects a serving_quantity above the plausible-serving ceiling — bulk package weight mis-entered as serving size', () => {
    const record = toOffFoodLogRecord(baseProduct({ serving_size: '1000.0g', serving_quantity: 1000 }), 'v1');
    expect(record.servings).toBeUndefined();
  });
});
