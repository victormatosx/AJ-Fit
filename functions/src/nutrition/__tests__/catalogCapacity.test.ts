import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import capacity from './fixtures/catalogCapacity.json';
import type { NutritionFood, NutritionProfile, NutritionEngineOutput } from '../shared/types/nutrition';
import { catalogItemNutrition } from '../shared/nutrition/catalog/binding';
import { linkAndValidatePlan } from '../catalogLinking/pipeline';
import { CatalogSearchSession, type CatalogReader } from '../catalogLinking/search';
import type { RawAiFoodItem } from '../generation/domain';

const foods = (JSON.parse(readFileSync(resolve(__dirname, '../../../../scripts/nutrition/sources/taco-4a-edicao-2011-prepared.json'), 'utf8')) as { foods: NutritionFood[] }).foods;
const reader: CatalogReader = {
  async page(collection, term, cursor, size) {
    if (collection !== 'nutritionFoods') return { candidates: [], nextCursor: null };
    const pool = foods.filter(f => f.searchPrefixes.includes(term) && (!cursor || f.id > cursor)).sort((a, b) => a.id < b.id ? -1 : 1);
    const selected = pool.slice(0, size);
    return { candidates: selected.map(food => ({ collection, food })), nextCursor: pool.length >= size ? selected.at(-1)!.id : null };
  },
  async get(collection, id) { const food = foods.find(f => f.id === id); return food ? { collection, food } : null; },
};
function origin(food: NutritionFood): RawAiFoodItem['ingredients'][number]['origin'] {
  if (food.allergens?.includes('milk')) return 'dairy';
  if (food.allergens?.includes('egg')) return 'egg';
  if (food.allergens?.includes('fish')) return 'fish';
  if (food.allergens?.includes('shellfish')) return 'shellfish';
  return food.dietaryFlags.vegetarian ? 'plant' : 'terrestrial_animal';
}
describe('capacity with public catalog and synthetic targets from Audit 2', () => {
  it.each(['A', 'B', 'C', 'D', 'F', 'G', 'H'] as const)('profile %s links with catalog nutrition or fails closed for critical evidence/practicality', async key => {
    const entry = capacity[key];
    const profile = { mealSlots: entry.meals.map(m => m.slot), dietaryPattern: ['D', 'H'].includes(key) ? 'vegetarian' : 'omnivore',
      excludedFoodIds: [], excludedAllergens: [], supplements: [], ...(key === 'G' ? { excludedSubstances: ['gluten'] } : {}) } as unknown as NutritionProfile;
    const engine = { mealTargets: entry.scenario.targets, energy: { targetKcal: entry.scenario.kcal }, macros: entry.scenario.macros } as NutritionEngineOutput;
    const raw = { meals: entry.meals.map(m => ({ slot: m.slot, foods: m.foods.map(f => {
      const food = foods.find(x => x.source.sourceId === f.id)!;
      return { name: food.name, quantity: f.g, unit: 'g', preparationNote: '', allergens: food.allergens ?? [],
        ingredients: [{ name: food.name, origin: origin(food) }], estimatedNutrition: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 1 } };
    }) })) };
    const pending = linkAndValidatePlan(raw, new CatalogSearchSession(reader), profile, engine,
      { preferred: [], usual: [], excluded: key === 'F' ? ['Leite'] : key === 'H' ? ['Leite', 'Soja'] : [] });
    if (key === 'G') { await expect(pending).rejects.toMatchObject({ code: 'AI_CATALOG_RESOLUTION_FAILED' }); return; }
    const result = await pending;
    expect(result.diagnostics.daily.status).toBe('passed');
    for (const meal of result.meals) for (const food of meal.options[0].foods) expect(food.estimatedNutrition).toEqual(catalogItemNutrition(food.catalogBinding!));
  });
  it('does not manufacture a solution for the vegan high-protein profile', async () => {
    const vegan = foods.find(f => f.source.sourceId === '561')!;
    const n = vegan.nutritionPer100g;
    const profile = { dietaryPattern: 'vegan', mealSlots: ['breakfast', 'lunch'], excludedFoodIds: [], supplements: [] } as unknown as NutritionProfile;
    const target = { min: 54, target: 60, max: 66 };
    const engine = { energy: { targetKcal: 2400 }, macros: { proteinG: 120, carbsG: 330, fatG: 66.67, fiberG: 33.6 }, mealTargets: profile.mealSlots.map(slot => ({ slot, kcal: { min: 1140, target: 1200, max: 1260 }, proteinG: target,
      carbsG: { min: 148.5, target: 165, max: 181.5 }, fatG: { min: 30, target: 33.33, max: 36.67 }, fiberG: { min: 13.44, target: 16.8, max: 20.16 } })) } as NutritionEngineOutput;
    const raw = { meals: profile.mealSlots.map(slot => ({ slot, foods: [{ name: vegan.name, quantity: 200, unit: 'g', preparationNote: '',
      allergens: [], ingredients: [{ name: vegan.name, origin: 'plant' }], estimatedNutrition: n }] })) };
    await expect(linkAndValidatePlan(raw, new CatalogSearchSession(reader), profile, engine, { preferred: [], usual: [], excluded: [] }))
      .rejects.toMatchObject({ code: 'AI_MACRO_VALIDATION_FAILED' });
  });
});
