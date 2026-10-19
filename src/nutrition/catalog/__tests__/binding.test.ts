import { describe, expect, it } from 'vitest';
import { catalogItemNutrition, catalogNutritionRevision, isCatalogLinkedOption, validCatalogBinding } from '../binding';
import type { NutritionCatalogBinding, NutritionPlanFoodItem } from '../../../types/nutrition';
const food = { id: 'nf_taco_test', name: 'Arroz', source: { type: 'taco', sourceId: '1' }, catalogVersion: 'v1',
  nutritionPer100g: { kcal: 124, proteinG: 2.6, carbsG: 25.8, fatG: 1, fiberG: 2.7 } };
const binding = (): NutritionCatalogBinding => ({ schemaVersion: 1, collection: 'nutritionFoods', foodId: food.id, grams: 100.25,
  source: { type: 'taco', sourceId: '1' }, catalogVersion: 'v1', nutritionRevision: catalogNutritionRevision(food),
  nutritionPer100g: food.nutritionPer100g, preparation: 'cooked' });
describe('catalog link contract shared by app/backend', () => {
  it('computes fractional quantity from the exact linked nutrition', () => {
    expect(catalogItemNutrition(binding())).toEqual({ kcal: 124.31, proteinG: 2.61, carbsG: 25.86, fatG: 1, fiberG: 2.71 });
  });
  it('does not classify legacy or partially linked options as fully linked', () => {
    const legacy: NutritionPlanFoodItem = { name: 'Livre', quantity: 1, unit: 'unidade', preparationNote: '' };
    expect(isCatalogLinkedOption([legacy])).toBe(false);
    expect(isCatalogLinkedOption([{ ...legacy, catalogBinding: binding() }, legacy])).toBe(false);
    expect(isCatalogLinkedOption([{ ...legacy, catalogBinding: binding() }])).toBe(true);
  });
  it('rejects wrong collection, unknown fiber and invalid grams', () => {
    expect(validCatalogBinding({ ...binding(), collection: 'foodLogCatalog' })).toBe(false);
    expect(validCatalogBinding({ ...binding(), nutritionPer100g: { ...food.nutritionPer100g, fiberG: null } })).toBe(false);
    expect(validCatalogBinding({ ...binding(), grams: Number.NaN })).toBe(false);
  });
  it('revision distinguishes fiber enrichment, source and catalog updates', () => {
    const current = catalogNutritionRevision(food);
    expect(catalogNutritionRevision({ ...food, nutritionPer100g: { ...food.nutritionPer100g, fiberG: null } })).not.toBe(current);
    expect(catalogNutritionRevision({ ...food, catalogVersion: 'v2' })).not.toBe(current);
    expect(catalogNutritionRevision({ ...food, id: 'flc_taco_test' })).not.toBe(current);
  });
});
