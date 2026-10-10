import { describe, expect, it, vi } from 'vitest';
import { validateCustomFoodInput } from '../nutritionFoods';
import { validateRecipeInput } from '../nutritionRecipes';

vi.mock('../../lib/firebase', () => ({ db: {} }));

describe('custom food and recipe input', () => {
  const food = () => ({ name: ' Arroz ', nutritionPer100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: null } });
  it('accepts canonical custom food and rejects invalid nutrition or extra authority', () => {
    expect(() => validateCustomFoodInput(food())).not.toThrow();
    expect(() => validateCustomFoodInput({ ...food(), nutritionPer100g: { ...food().nutritionPer100g, kcal: -1 } })).toThrow();
    expect(() => validateCustomFoodInput({ ...food(), nutritionPer100g: { ...food().nutritionPer100g, proteinG: NaN } })).toThrow();
    expect(() => validateCustomFoodInput({ ...food(), nutritionPer100g: { ...food().nutritionPer100g, fatG: Infinity } })).toThrow();
    expect(() => validateCustomFoodInput({ ...food(), generationStatus: 'approved' })).toThrow();
  });
  it('accepts ingredient references and refuses client-calculated macros', () => {
    expect(() => validateRecipeInput({ name: 'Arroz', ingredients: [{ foodId: 'nf_tbca_rice_123', grams: 100 }] })).not.toThrow();
    expect(() => validateRecipeInput({ name: 'Arroz', ingredients: [{ foodId: 'rice', grams: -1 }] })).toThrow();
    expect(() => validateRecipeInput({ name: 'Arroz', ingredients: [{ foodId: 'rice', grams: 100 }], calculatedNutrition: { kcal: 0 } })).toThrow();
  });

  it('accepts a valid optional finalWeightG/servings', () => {
    const base = { name: 'Sopa', ingredients: [{ foodId: 'rice', grams: 300 }] };
    expect(() => validateRecipeInput({ ...base, finalWeightG: 250 })).not.toThrow();
    expect(() => validateRecipeInput({ ...base, servings: 4 })).not.toThrow();
    expect(() => validateRecipeInput({ ...base, finalWeightG: 250, servings: 4 })).not.toThrow();
    expect(() => validateRecipeInput(base)).not.toThrow(); // both are optional
  });

  it('rejects an out-of-range or wrongly-typed finalWeightG', () => {
    const base = { name: 'Sopa', ingredients: [{ foodId: 'rice', grams: 300 }] };
    expect(() => validateRecipeInput({ ...base, finalWeightG: 0 })).toThrow();
    expect(() => validateRecipeInput({ ...base, finalWeightG: -10 })).toThrow();
    expect(() => validateRecipeInput({ ...base, finalWeightG: 10001 })).toThrow();
    expect(() => validateRecipeInput({ ...base, finalWeightG: NaN })).toThrow();
    expect(() => validateRecipeInput({ ...base, finalWeightG: '250' })).toThrow();
  });

  it('rejects a non-integer, non-positive or too-large servings', () => {
    const base = { name: 'Sopa', ingredients: [{ foodId: 'rice', grams: 300 }] };
    expect(() => validateRecipeInput({ ...base, servings: 0 })).toThrow();
    expect(() => validateRecipeInput({ ...base, servings: -2 })).toThrow();
    expect(() => validateRecipeInput({ ...base, servings: 2.5 })).toThrow();
    expect(() => validateRecipeInput({ ...base, servings: 101 })).toThrow();
  });
});
