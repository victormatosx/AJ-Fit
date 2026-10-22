import { describe, expect, it } from 'vitest';
import { normalizeFoodLogRecord } from '../shared/nutrition/foodLog/normalize';
import type { CatalogCandidate } from '../catalogLinking/search';
import { hasExplicitZeroLactoseClaim } from '../catalogLinking/lactoseClaims';

const n = { kcal: 100, proteinG: 80, carbsG: 5, fatG: 2, fiberG: 0 };
function off(name: string, brand = 'Marca'): CatalogCandidate {
  return { collection: 'foodLogCatalog', food: normalizeFoodLogRecord({ source: { type: 'off', sourceId: '12345678', sourceName: 'OFF' },
    name, brand: { name: brand }, category: 'supplement', status: 'active', nutritionPer100g: n,
    provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'test' } }, 'test-v1') as CatalogCandidate['food'] };
}

describe('hasExplicitZeroLactoseClaim', () => {
  it.each([
    'Whey Crush, Zero Lactose, Strawberry',
    'suplemento Whey Protein sabor Leite sem Lactose Chef Whey 907 g',
    'Whey protein lactose free',
    'Whey protein livre de lactose',
  ])('accepts an unqualified explicit claim: %s', (name) => {
    expect(hasExplicitZeroLactoseClaim(off(name))).toBe(true);
  });

  it.each([
    'Whey protein isolado',
    'Whey protein hidrolisado',
    'Whey protein concentrado',
    'PROSTAR 100% WHEY PROTEIN',
  ])('never infers lactose-free from a generic/variant name alone: %s', (name) => {
    expect(hasExplicitZeroLactoseClaim(off(name))).toBe(false);
  });

  it.each([
    'Whey protein sem adição de lactose',
    'Whey protein baixo teor de lactose',
    'Whey protein reduzido em lactose',
    'Whey protein, pode conter leite',
    'Whey protein, traços de leite',
  ])('never treats a weaker/ambiguous qualifier as an absence claim: %s', (name) => {
    expect(hasExplicitZeroLactoseClaim(off(name))).toBe(false);
  });

  it('an ambiguous qualifier wins even when the unqualified phrase also appears in the same text', () => {
    // Pathological label text some sources may contain — the weaker claim
    // must still block, never averaged/ORed with the stronger one.
    expect(hasExplicitZeroLactoseClaim(off('Whey sem lactose, mas pode conter leite'))).toBe(false);
  });

  it('reads the catalog brand/product name, not just the base name', () => {
    const c = off('Whey Protein', 'Zero Lactose Nutrition');
    expect(hasExplicitZeroLactoseClaim(c)).toBe(true);
  });

  it('is never satisfied by an empty or unrelated name', () => {
    expect(hasExplicitZeroLactoseClaim(off('Arroz, integral, cozido'))).toBe(false);
  });
});
