import { describe, expect, it } from 'vitest';
import { mapFatSecretFoodToFoodLogRecord, parseFatSecretDescription } from '../fatsecretMapper';

describe('parseFatSecretDescription', () => {
  it('parses a standard per-100g generic description', () => {
    expect(parseFatSecretDescription('Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g'))
      .toEqual({ servingGrams: 100, kcal: 52, fatG: 0.17, carbsG: 13.81, proteinG: 0.26, fiberG: null });
  });

  it('scales a non-100g gram serving (branded product)', () => {
    expect(parseFatSecretDescription('Per 250g - Calories: 100kcal | Fat: 1g | Carbs: 10g | Protein: 10g'))
      .toEqual({ servingGrams: 250, kcal: 100, fatG: 1, carbsG: 10, proteinG: 10, fiberG: null });
  });

  it('parses fiber when present', () => {
    expect(parseFatSecretDescription('Per 100g - Calories: 50kcal | Fat: 0g | Carbs: 10g | Protein: 2g | Fiber: 3g')?.fiberG).toBe(3);
  });

  it('returns null for a non-gram serving (e.g. a can/volume) — never guesses a density conversion', () => {
    expect(parseFatSecretDescription('Per 1 lata (350ml) - Calories: 140kcal | Fat: 0g | Carbs: 39g | Protein: 0g')).toBeNull();
  });

  it('returns null for missing/malformed descriptions', () => {
    expect(parseFatSecretDescription(undefined)).toBeNull();
    expect(parseFatSecretDescription('garbage')).toBeNull();
  });
});

describe('mapFatSecretFoodToFoodLogRecord', () => {
  it('maps a generic 100g food to a RawFoodLogRecord with unscaled per-100g macros', () => {
    const record = mapFatSecretFoodToFoodLogRecord({
      food_id: '12345', food_name: 'Frango, peito, grelhado',
      food_description: 'Per 100g - Calories: 165kcal | Fat: 3.6g | Carbs: 0g | Protein: 31g',
    }, 'fatsecret-live-v1');
    expect(record).toMatchObject({
      source: { type: 'fatsecret', sourceId: '12345', sourceName: 'FatSecret Platform API' },
      name: 'Frango, peito, grelhado',
      nutritionPer100g: { kcal: 165, fatG: 3.6, carbsG: 0, proteinG: 31 },
      provenance: { license: 'proprietary_contract', attributionRequired: true },
    });
  });

  it('scales a branded 250g serving down to per-100g and keeps the brand + serving description', () => {
    const record = mapFatSecretFoodToFoodLogRecord({
      food_id: '99999', food_name: 'YoPRO Morango', brand_name: 'YoPRO',
      food_description: 'Per 250g - Calories: 200kcal | Fat: 5g | Carbs: 20g | Protein: 25g',
    }, 'fatsecret-live-v1');
    expect(record?.nutritionPer100g).toEqual({ kcal: 80, fatG: 2, carbsG: 8, proteinG: 10, fiberG: null });
    expect(record?.brand).toEqual({ name: 'YoPRO' });
    expect(record?.servingDescription).toBe('250g');
  });

  it('returns null for a non-gram branded serving instead of fabricating a conversion', () => {
    expect(mapFatSecretFoodToFoodLogRecord({
      food_id: '1', food_name: 'Coca-Cola Zero', brand_name: 'Coca-Cola',
      food_description: 'Per 1 lata (350ml) - Calories: 0kcal | Fat: 0g | Carbs: 0g | Protein: 0g',
    }, 'v1')).toBeNull();
  });

  it('exposes a non-100g reference serving as a provider_official unit (Fase C6)', () => {
    const record = mapFatSecretFoodToFoodLogRecord({
      food_id: '99999', food_name: 'YoPRO Morango', brand_name: 'YoPRO',
      food_description: 'Per 250g - Calories: 200kcal | Fat: 5g | Carbs: 20g | Protein: 25g',
    }, 'v1');
    expect(record?.servings).toEqual([{ id: 'porcao', label: '250 g', quantity: 1, gramEquivalent: 250, provenance: 'provider_official' }]);
  });

  it('never exposes a serving for the generic 100g basis itself — that is not a distinct unit', () => {
    const record = mapFatSecretFoodToFoodLogRecord({
      food_id: '12345', food_name: 'Frango, peito, grelhado',
      food_description: 'Per 100g - Calories: 165kcal | Fat: 3.6g | Carbs: 0g | Protein: 31g',
    }, 'v1');
    expect(record?.servings).toBeUndefined();
  });

  it('returns null when the name is blank', () => {
    expect(mapFatSecretFoodToFoodLogRecord({
      food_id: '1', food_name: '  ',
      food_description: 'Per 100g - Calories: 50kcal | Fat: 0g | Carbs: 10g | Protein: 2g',
    }, 'v1')).toBeNull();
  });
});
