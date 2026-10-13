import { describe, expect, it } from 'vitest';
import { nutrientsForGrams } from '../math';
import { nutrientsForServing, resolveDefaultServingUnit, servingGrams } from '../servings';
import type { FoodLogServingUnit } from '../../../types/nutrition';

const unidade: FoodLogServingUnit = { id: 'unidade', label: '1 unidade (50 g)', quantity: 1, gramEquivalent: 50, provenance: 'reviewed_generic' };
const mlOnly: FoodLogServingUnit = { id: 'lata', label: '1 lata (350 ml)', quantity: 1, mlEquivalent: 350, provenance: 'provider_official' };
const perTwoSlices: FoodLogServingUnit = { id: 'fatias', label: '2 fatias (40 g)', quantity: 2, gramEquivalent: 40, provenance: 'reviewed_generic' };

describe('servingGrams', () => {
  it('resolves a 1:1 unit', () => expect(servingGrams(unidade)).toBe(50));
  it('scales by count', () => expect(servingGrams(unidade, 3)).toBe(150));
  it('divides out a multi-quantity unit before scaling by count', () => expect(servingGrams(perTwoSlices, 1)).toBe(20));
  it('returns null for an ml-only unit with no gram basis — never guesses a density', () => expect(servingGrams(mlOnly)).toBeNull());
  it('returns null for a non-positive count', () => expect(servingGrams(unidade, 0)).toBeNull());
});

describe('nutrientsForServing', () => {
  const per100g = { kcal: 100, proteinG: 10, carbsG: 10, fatG: 10, fiberG: 2 };

  it('scales canonical per-100g values to the unit\'s grams', () => {
    expect(nutrientsForServing(per100g, unidade)).toEqual({ kcal: 50, proteinG: 5, carbsG: 5, fatG: 5, fiberG: 1 });
  });

  it('returns null when the unit has no gram basis', () => expect(nutrientsForServing(per100g, mlOnly)).toBeNull());

  it('is exactly equivalent to logging the same amount in grams — one formula, two entry points', () => {
    const viaUnit = nutrientsForServing(per100g, unidade);
    const viaGrams = nutrientsForGrams(per100g, 50);
    expect(viaUnit).toEqual(viaGrams);
  });
});

describe('resolveDefaultServingUnit', () => {
  it('returns null when there are no servings', () => expect(resolveDefaultServingUnit(undefined, null)).toBeNull());
  it('returns null when every serving lacks a gram basis', () => expect(resolveDefaultServingUnit([mlOnly], null)).toBeNull());
  it('prefers the matching defaultServingId among servable units', () => {
    expect(resolveDefaultServingUnit([unidade, perTwoSlices], 'fatias')).toEqual(perTwoSlices);
  });
  it('falls back to the first servable unit when defaultServingId is absent/unmatched', () => {
    expect(resolveDefaultServingUnit([mlOnly, unidade], 'nope')).toEqual(unidade);
  });
});
