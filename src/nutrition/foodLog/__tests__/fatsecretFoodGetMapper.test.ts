import { describe, expect, it } from 'vitest';
import { mapFatSecretFoodGetToFoodLogRecord } from '../fatsecretFoodGetMapper';

describe('mapFatSecretFoodGetToFoodLogRecord', () => {
  it('derives per-100g from the default gram-based serving and exposes the full serving list', () => {
    const record = mapFatSecretFoodGetToFoodLogRecord({
      food_id: '33691', food_name: 'YoPRO Morango', brand_name: 'YoPRO',
      servings: { serving: [
        { serving_id: '1', serving_description: '1 garrafa (250g)', metric_serving_amount: '250', metric_serving_unit: 'g', is_default: '1', calories: '200', protein: '25', carbohydrate: '20', fat: '5' },
        { serving_id: '2', serving_description: '100g', metric_serving_amount: '100', metric_serving_unit: 'g', is_default: '0', calories: '80', protein: '10', carbohydrate: '8', fat: '2' },
      ] },
    }, 'v1');
    expect(record?.nutritionPer100g).toEqual({ kcal: 80, proteinG: 10, carbsG: 8, fatG: 2, fiberG: null });
    expect(record?.servings).toEqual([
      { id: 'fs-1', label: '1 garrafa (250g)', quantity: 1, gramEquivalent: 250, provenance: 'provider_official' },
      { id: 'fs-2', label: '100g', quantity: 1, gramEquivalent: 100, provenance: 'provider_official' },
    ]);
    expect(record?.defaultServingId).toBe('fs-1');
    expect(record?.brand).toEqual({ name: 'YoPRO' });
  });

  it('captures an ml-based serving (lata/garrafa) as mlEquivalent in the serving list, never fabricating a gram density', () => {
    const record = mapFatSecretFoodGetToFoodLogRecord({
      food_id: '1', food_name: 'Coca-Cola Zero',
      servings: { serving: [
        { serving_id: '1', serving_description: '1 lata (350ml)', metric_serving_amount: '350', metric_serving_unit: 'ml', is_default: '1', calories: '0', protein: '0', carbohydrate: '0', fat: '0' },
        { serving_id: '2', serving_description: '100ml', metric_serving_amount: '100', metric_serving_unit: 'ml', calories: '0', protein: '0', carbohydrate: '0', fat: '0' },
      ] },
    }, 'v1');
    // No gram-based serving at all -> cannot derive nutritionPer100g -> the whole record is rejected, never guessed.
    expect(record).toBeNull();
  });

  it('falls back to the first gram-based serving when none is flagged is_default', () => {
    const record = mapFatSecretFoodGetToFoodLogRecord({
      food_id: '1', food_name: 'Big Mac',
      servings: { serving: { serving_id: '1', serving_description: '1 unidade (215g)', metric_serving_amount: '215', metric_serving_unit: 'g', calories: '257', protein: '10', carbohydrate: '30', fat: '12' } },
    }, 'v1');
    expect(record?.defaultServingId).toBe('fs-1');
    expect(record?.nutritionPer100g.kcal).toBeCloseTo(257 * (100 / 215));
  });

  it('returns null when there are no servings at all', () => {
    expect(mapFatSecretFoodGetToFoodLogRecord({ food_id: '1', food_name: 'Mystery Food' }, 'v1')).toBeNull();
  });

  it('returns null when the food has no name or no food_id', () => {
    expect(mapFatSecretFoodGetToFoodLogRecord({ food_id: '1', food_name: '  ' }, 'v1')).toBeNull();
    expect(mapFatSecretFoodGetToFoodLogRecord({ food_name: 'No id' }, 'v1')).toBeNull();
  });

  it('skips a serving with an implausible/missing metric amount when picking the default, but still lists valid ones', () => {
    const record = mapFatSecretFoodGetToFoodLogRecord({
      food_id: '1', food_name: 'Produto X',
      servings: { serving: [
        { serving_id: '1', serving_description: 'bad', metric_serving_amount: '0', metric_serving_unit: 'g', calories: '1', protein: '1', carbohydrate: '1', fat: '1' },
        { serving_id: '2', serving_description: '100g', metric_serving_amount: '100', metric_serving_unit: 'g', is_default: '1', calories: '50', protein: '5', carbohydrate: '5', fat: '5' },
      ] },
    }, 'v1');
    expect(record?.nutritionPer100g).toEqual({ kcal: 50, proteinG: 5, carbsG: 5, fatG: 5, fiberG: null });
    expect(record?.servings?.map((s) => s.id)).toEqual(['fs-2']);
  });
});
