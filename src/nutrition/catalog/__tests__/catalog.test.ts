import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateRecipeBreakdown, calculateRecipeNutrition, divideNutritionValues, nutrientsForGrams,
  recipePortionToGrams, roundNutritionValues, sumNutritionValues, totalIngredientWeightG, validateNutritionValues } from '../math';
import { normalizeAliases, normalizeFoodCategory, normalizeFoodRecord, normalizeNutrientNumber,
  normalizeSearchText, nutritionFoodId, searchPrefixes, type RawFoodRecord } from '../normalize';
import { parseCatalogImportFile, prepareCatalogImport } from '../import';
import { NUTRITION_FOOD_ALLERGENS, NUTRITION_FOOD_CATEGORIES, NUTRITION_FOOD_GENERATION_STATUSES,
  type NutritionFoodNutritionValues } from '../../../types/nutrition';

const rice = { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: null };
const raw = (): RawFoodRecord => ({ source: { type: 'tbca', sourceId: 'BRC0001', sourceName: 'TBCA', sourceVersion: '7' },
  name: 'Arroz branco', aliases: ['Arroz cozido'], category: 'cereal', nutritionPer100g: rice,
  dietaryFlags: { vegetarian: true, vegan: true, pescatarian: true }, allergens: [],
  preparation: 'cooked', mealContexts: ['main_meal'], generationStatus: 'approved' });

describe('nutrition math', () => {
  it('scales 100, 50 and 150 g without early rounding', () => {
    expect(nutrientsForGrams(rice, 100).kcal).toBe(130);
    expect(nutrientsForGrams(rice, 50).proteinG).toBe(1.35);
    expect(nutrientsForGrams(rice, 150).carbsG).toBe(42);
  });
  it('sums several quantities, rounds only final recipe, preserves unknown fiber', () => {
    const foods = new Map<string, NutritionFoodNutritionValues>([['rice', rice], ['beans', { kcal: 80, proteinG: 5, carbsG: 14, fatG: 0.5, fiberG: 5 }]]);
    expect(calculateRecipeNutrition([{ foodId: 'rice', grams: 150 }], foods)).toMatchObject({ kcal: 195, proteinG: 4.05, fiberG: null });
    expect(calculateRecipeNutrition([{ foodId: 'rice', grams: 50 }, { foodId: 'beans', grams: 150 }], foods)).toMatchObject({ kcal: 185, proteinG: 8.85, fiberG: null });
    expect(roundNutritionValues(sumNutritionValues([nutrientsForGrams(foods.get('beans')!, 33.3)])).proteinG).toBe(1.67);
  });
  it('rejects invalid quantities, negative and non-finite nutrients', () => {
    expect(() => nutrientsForGrams(rice, -1)).toThrow();
    expect(() => validateNutritionValues({ ...rice, kcal: NaN })).toThrow();
    expect(() => validateNutritionValues({ ...rice, fatG: Infinity })).toThrow();
    expect(() => validateNutritionValues({ ...rice, proteinG: -1 })).toThrow();
    expect(() => calculateRecipeNutrition([{ foodId: 'missing', grams: 100 }], new Map())).toThrow();
  });
});

describe('divideNutritionValues', () => {
  const beans = { kcal: 160, proteinG: 10, carbsG: 28, fatG: 1, fiberG: 10 };
  it('divides every nutrient by the given divisor, keeping full precision', () => {
    expect(divideNutritionValues(beans, 2)).toEqual({ kcal: 80, proteinG: 5, carbsG: 14, fatG: 0.5, fiberG: 5 });
  });
  it('keeps fiber null through division when the total has no known fiber', () => {
    expect(divideNutritionValues({ ...beans, fiberG: null }, 4).fiberG).toBeNull();
  });
  it('rejects a zero, negative or non-finite divisor', () => {
    expect(() => divideNutritionValues(beans, 0)).toThrow('INVALID_DIVISOR');
    expect(() => divideNutritionValues(beans, -1)).toThrow('INVALID_DIVISOR');
    expect(() => divideNutritionValues(beans, NaN)).toThrow('INVALID_DIVISOR');
  });
});

describe('totalIngredientWeightG', () => {
  it('sums every ingredient\'s grams', () => {
    expect(totalIngredientWeightG([{ foodId: 'rice', grams: 150 }, { foodId: 'beans', grams: 100 }])).toBe(250);
  });
  it('returns 0 for no ingredients', () => {
    expect(totalIngredientWeightG([])).toBe(0);
  });
});

describe('calculateRecipeBreakdown', () => {
  const rice2 = { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: null };
  const beans = { kcal: 80, proteinG: 5, carbsG: 14, fatG: 0.5, fiberG: 5 };
  const foods = new Map<string, NutritionFoodNutritionValues>([['rice', rice2], ['beans', beans]]);
  const ingredients = [{ foodId: 'rice', grams: 150 }, { foodId: 'beans', grams: 150 }];
  // total = calculateRecipeNutrition(ingredients, foods)
  //   kcal: rice 130*1.5=195 + beans 80*1.5=120 = 315
  //   fiberG: null (rice has none, propagates through the whole sum)

  it('always reports the raw ingredient-weight sum, independent of finalWeightG', () => {
    const breakdown = calculateRecipeBreakdown({ ingredients, finalWeightG: 250 }, foods);
    expect(breakdown.totalIngredientWeightG).toBe(300);
  });

  it('falls back to the ingredient-weight sum for per100g when finalWeightG is absent, and says so', () => {
    const breakdown = calculateRecipeBreakdown({ ingredients }, foods);
    expect(breakdown.usedIngredientWeightFallback).toBe(true);
    expect(breakdown.resolvedWeightG).toBe(300);
    // total kcal 315 over 300g raw -> per100g kcal = 315 * 100/300 = 105
    expect(breakdown.per100g.kcal).toBe(105);
  });

  it('uses finalWeightG for per100g (cooked weight can differ from the raw ingredient sum) and flags it as non-fallback', () => {
    // Same ingredients, but the cooked dish lost water down to 250g.
    const breakdown = calculateRecipeBreakdown({ ingredients, finalWeightG: 250 }, foods);
    expect(breakdown.usedIngredientWeightFallback).toBe(false);
    expect(breakdown.resolvedWeightG).toBe(250);
    // total kcal 315 over 250g final -> per100g kcal = 315 * 100/250 = 126
    expect(breakdown.per100g.kcal).toBe(126);
    // Confirms it's genuinely different from the ingredient-sum-based calculation (105 above).
    const fallback = calculateRecipeBreakdown({ ingredients }, foods);
    expect(breakdown.per100g.kcal).not.toBe(fallback.per100g.kcal);
  });

  it('computes per-serving macros only when servings is a valid positive integer', () => {
    const withServings = calculateRecipeBreakdown({ ingredients, finalWeightG: 250, servings: 2 }, foods);
    expect(withServings.perServing).not.toBeNull();
    expect(withServings.perServing?.kcal).toBe(157.5); // 315 total / 2 servings

    expect(calculateRecipeBreakdown({ ingredients, servings: 0 }, foods).perServing).toBeNull();
    expect(calculateRecipeBreakdown({ ingredients, servings: 2.5 }, foods).perServing).toBeNull();
    expect(calculateRecipeBreakdown({ ingredients }, foods).perServing).toBeNull();
  });

  it('keeps fiber null through per100g/perServing when any ingredient has unknown fiber', () => {
    // `rice2.fiberG` is null, so the recipe total's fiber is null (sumNutritionValues' rule) —
    // division must preserve that null, never silently produce 0.
    const breakdown = calculateRecipeBreakdown({ ingredients, finalWeightG: 250, servings: 2 }, foods);
    expect(breakdown.total.fiberG).toBeNull();
    expect(breakdown.per100g.fiberG).toBeNull();
    expect(breakdown.perServing?.fiberG).toBeNull();
  });

  it('reports a known fiber value correctly when every ingredient has one', () => {
    const fiberFoods = new Map<string, NutritionFoodNutritionValues>([
      ['beans', beans], ['oats', { kcal: 100, proteinG: 4, carbsG: 20, fatG: 2, fiberG: 4 }],
    ]);
    const fiberIngredients = [{ foodId: 'beans', grams: 100 }, { foodId: 'oats', grams: 100 }];
    // total fiber = 5 + 4 = 9, over 200g raw -> per100g fiber = 4.5
    const breakdown = calculateRecipeBreakdown({ ingredients: fiberIngredients }, fiberFoods);
    expect(breakdown.total.fiberG).toBe(9);
    expect(breakdown.per100g.fiberG).toBe(4.5);
  });
});

describe('recipePortionToGrams', () => {
  const foodsIngredients = [{ foodId: 'rice', grams: 150 }, { foodId: 'beans', grams: 150 }];

  it('divides the resolved weight (finalWeightG when present) by servings, times the requested portions', () => {
    expect(recipePortionToGrams({ ingredients: foodsIngredients, finalWeightG: 250, servings: 2 }, 1)).toBe(125);
    expect(recipePortionToGrams({ ingredients: foodsIngredients, finalWeightG: 250, servings: 2 }, 2)).toBe(250);
  });

  it('falls back to the ingredient-weight sum when finalWeightG is absent', () => {
    expect(recipePortionToGrams({ ingredients: foodsIngredients, servings: 3 }, 1)).toBeCloseTo(100, 5);
  });

  it('returns null when servings is missing or invalid, or portions is non-positive', () => {
    expect(recipePortionToGrams({ ingredients: foodsIngredients }, 1)).toBeNull();
    expect(recipePortionToGrams({ ingredients: foodsIngredients, servings: 0 }, 1)).toBeNull();
    expect(recipePortionToGrams({ ingredients: foodsIngredients, servings: 2.5 }, 1)).toBeNull();
    expect(recipePortionToGrams({ ingredients: foodsIngredients, servings: 2 }, 0)).toBeNull();
    expect(recipePortionToGrams({ ingredients: foodsIngredients, servings: 2 }, -1)).toBeNull();
  });
});

describe('catalog normalization and ingestion', () => {
  it('keeps canonical schema enums aligned with TypeScript contracts', () => {
    const schema = JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/nutrition/canonical/food_catalog_schema.json'), 'utf8')) as {
      properties: { category: { enum: string[] }; allergens: { items: { enum: string[] } }; generationStatus: { enum: string[] } };
    };
    expect(schema.properties.category.enum).toEqual([...NUTRITION_FOOD_CATEGORIES]);
    expect(schema.properties.allergens.items.enum).toEqual([...NUTRITION_FOOD_ALLERGENS]);
    expect(schema.properties.generationStatus.enum).toEqual([...NUTRITION_FOOD_GENERATION_STATUSES]);
  });
  it('normalizes PT-BR aliases and produces name/alias search prefixes', () => {
    expect(normalizeSearchText('  AÍPIM  Cozido  ')).toBe('aipim cozido');
    expect(normalizeAliases([' Aipim ', 'aípim', 'Macaxeira'], 'Mandioca')).toEqual(['Aipim', 'Macaxeira']);
    expect(searchPrefixes('Mandioca', ['Aipim'])).toContain('aip');
    expect(normalizeFoodCategory(' Protein Source ')).toBe('protein_source');
  });
  it('keeps IDs stable by source and sourceId, not translated name', () => {
    const first = normalizeFoodRecord(raw(), 'v1');
    expect(first.id).toBe(nutritionFoodId('tbca', 'BRC0001'));
    expect(normalizeFoodRecord({ ...raw(), name: 'Rice' }, 'v1').id).toBe(first.id);
    expect(nutritionFoodId('taco', 'BRC0001')).not.toBe(first.id);
  });
  it('parses, deduplicates and rejects conflicting duplicate identities', () => {
    const file = parseCatalogImportFile(JSON.stringify({ schemaVersion: 1, catalogVersion: 'v1', records: [raw(), raw()] }));
    expect(prepareCatalogImport(file)).toHaveLength(1);
    expect(() => prepareCatalogImport({ ...file, records: [raw(), { ...raw(), name: 'Different' }] })).toThrow('CONFLICTING_DUPLICATE');
  });
  it('converts explicit units/servings and never turns missing fiber into zero', () => {
    expect(normalizeNutrientNumber('500', 'mg')).toBe(0.5);
    expect(normalizeNutrientNumber('418,4', 'kJ')).toBeCloseTo(100);
    const record = raw();
    delete record.nutritionPer100g;
    record.nutritionPerServing = { kcal: 65, proteinG: 1.35, carbsG: 14, fatG: 0.15 };
    record.servingGrams = 50;
    expect(normalizeFoodRecord(record, 'v1').nutritionPer100g).toMatchObject({ kcal: 130, proteinG: 2.7, fiberG: null });
    expect(normalizeNutrientNumber('  ', 'g', true)).toBeNull();
    expect(() => normalizeNutrientNumber('  ', 'g')).toThrow('MISSING_NUTRIENT');
  });
  it('keeps unknown safety metadata unapproved and validates statuses', () => {
    const pending = { ...raw(), dietaryFlags: undefined, allergens: undefined, generationStatus: 'pending_review' };
    expect(normalizeFoodRecord(pending, 'v1')).toMatchObject({ dietaryFlags: { vegan: null }, allergens: null });
    expect(() => normalizeFoodRecord({ ...pending, generationStatus: 'approved' }, 'v1')).toThrow('UNREVIEWED');
    expect(normalizeFoodRecord({ ...raw(), generationStatus: 'blocked' }, 'v1').generationStatus).toBe('blocked');
    expect(() => normalizeFoodRecord({ ...raw(), generationStatus: 'invalid' }, 'v1')).toThrow();
    expect(() => normalizeFoodRecord({ ...raw(), dietaryFlags: { vegetarian: false, vegan: true, pescatarian: true } }, 'v1')).toThrow('CONTRADICTORY');
    expect(() => normalizeFoodRecord({ ...raw(), source: { type: 'label', sourceId: 'sku-1', sourceName: 'Rótulo' } }, 'v1')).toThrow('LABEL_REQUIRES');
  });
  it('never approves a composite preparation (frango à milanesa and similar); mealContexts stays optional metadata (diet-quality-v2)', () => {
    expect(() => normalizeFoodRecord({ ...raw(), preparation: 'composite' }, 'v1')).toThrow('COMPOSITE_PREPARATION_CANNOT_BE_APPROVED');
    expect(normalizeFoodRecord({ ...raw(), preparation: 'composite', generationStatus: 'blocked' }, 'v1'))
      .toMatchObject({ preparation: 'composite', generationStatus: 'blocked' });
    expect(() => normalizeFoodRecord({ ...raw(), preparation: 'fried' }, 'v1')).toThrow('INVALID_FOOD_PREPARATION');
    expect(() => normalizeFoodRecord({ ...raw(), mealContexts: ['brunch'] }, 'v1')).toThrow('INVALID_MEAL_CONTEXTS');
    expect(() => normalizeFoodRecord({ ...raw(), preparation: undefined }, 'v1')).toThrow('UNREVIEWED_FOOD_CANNOT_BE_APPROVED');
    // mealContexts is no longer required for approval — generation never
    // consults it for slot eligibility anymore, only `preparation` is load-bearing.
    expect(normalizeFoodRecord({ ...raw(), mealContexts: [] }, 'v1')).toMatchObject({ mealContexts: [], generationStatus: 'approved' });
    expect(normalizeFoodRecord({ ...raw(), preparation: undefined, generationStatus: 'pending_review' }, 'v1').preparation).toBeNull();
  });
  it('fiberGProvenance: inferred_zero must match a literal 0, never a generic null-to-zero rule (catalog-widening round)', () => {
    const chicken = { ...raw(), name: 'Frango, peito, sem pele, grelhado', nutritionPer100g: { ...rice, fiberG: null } };
    expect(() => normalizeFoodRecord({ ...chicken, fiberGProvenance: 'inferred_zero' }, 'v1')).toThrow('INVALID_FIBER_PROVENANCE');
    const inferred = normalizeFoodRecord({ ...chicken, nutritionPer100g: { ...rice, fiberG: 0 }, fiberGProvenance: 'inferred_zero' }, 'v1');
    expect(inferred).toMatchObject({ fiberGProvenance: 'inferred_zero', nutritionPer100g: { fiberG: 0 } });
    expect(normalizeFoodRecord(raw(), 'v1')).not.toHaveProperty('fiberGProvenance');
    expect(() => normalizeFoodRecord({ ...raw(), fiberGProvenance: 'guessed' as never }, 'v1')).toThrow('INVALID_FIBER_PROVENANCE');
  });
});
