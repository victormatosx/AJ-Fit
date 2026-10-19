import type { MealNutritionTarget, NutritionEngineOutput, NutritionMealSlot, NutritionProfile, NutritionTotals } from '../shared/types/nutrition';
import { nutrientsForGrams, roundNutritionValues } from '../shared/nutrition/catalog/math';
import { parseAiOutput, parseAiMealAlternativeOutput, PlanValidationError, validateAndBuildPlan,
  validateAndBuildMealAlternative, type RawAiFoodItem, type ValidatedPlan, type ValidatedMealAlternative } from '../generation/domain';
import { NUTRIENTS, withinNutritionRange } from '../generation/diagnostics';
import type { NutritionPromptFoodNames } from '../generation/foodNames';
import { CatalogResolutionError, CatalogSearchSession } from './search';
import { resolveIntent, nutritionFailure, restrictionFailure, type ResolvedIntent } from './resolver';
import { catalogNutritionRevision } from '../shared/nutrition/catalog/binding';

function nutrition(item: ResolvedIntent) {
  return roundNutritionValues(nutrientsForGrams(item.binding.nutritionPer100g, item.binding.grams)) as NutritionTotals;
}
function total(items: ResolvedIntent[]): NutritionTotals {
  const value = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const item of items) for (const key of NUTRIENTS) value[key] += nutrition(item)[key];
  return roundNutritionValues(value) as NutritionTotals;
}
function rawItem(item: ResolvedIntent): RawAiFoodItem {
  return { ...item.intent, name: item.candidate.food.name, quantity: item.binding.grams, unit: 'g',
    estimatedNutrition: nutrition(item),
    allergens: 'allergens' in item.candidate.food ? item.candidate.food.allergens ?? [] : [] };
}
const validTotals = (items: ResolvedIntent[], target: MealNutritionTarget) => NUTRIENTS.every(k => !target[k] || withinNutritionRange(total(items)[k], target[k]!));

/** Bounded coordinate optimization over exact catalog nutrients. No nutrient number is edited.
 * Each quantity remains in [0.5,2] of the proposed mass and inside practical caps. */
export function correctCatalogPortions(items: ResolvedIntent[], target: MealNutritionTarget): boolean {
  const initial = items.map(x => x.binding.grams);
  const limits = items.map((x, i) => ({ min: Math.max(1, initial[i] * .5),
    max: Math.min(x.candidate.food.category === 'fat_source' ? 60 : 600, initial[i] * 2) }));
  if (items.some((x, i) => x.binding.grams > limits[i].max)) throw new CatalogResolutionError('quantity');
  const objective = () => {
    const t = total(items);
    return NUTRIENTS.reduce((sum, k) => {
      const r = target[k]; if (!r) return sum;
      const deviation = t[k] < r.min ? t[k] - r.min : t[k] > r.max ? t[k] - r.max : 0;
      return sum + (deviation / Math.max(1, r.target)) ** 2;
    }, 0);
  };
  const before = objective();
  for (let pass = 0; pass < 40 && !validTotals(items, target); pass++) {
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const original = items[i].binding.grams; let best = original; let bestLoss = objective();
      const step = Math.max(.01, initial[i] * .2 * Math.pow(.85, pass));
      for (const candidate of [original - step, original + step, limits[i].min, limits[i].max]) {
        const grams = Math.round(candidate * 100) / 100;
        if (grams < limits[i].min || grams > limits[i].max) continue;
        items[i].binding.grams = grams;
        if (items.reduce((s, x) => s + x.binding.grams, 0) > 1200) continue;
        const loss = objective();
        if (loss < bestLoss - 1e-12) { best = grams; bestLoss = loss; }
      }
      items[i].binding.grams = best; changed ||= best !== original;
    }
    if (!changed) break;
  }
  return objective() < before;
}
async function resolveFoods(raw: RawAiFoodItem[], session: CatalogSearchSession, profile: NutritionProfile, names: NutritionPromptFoodNames) {
  if (raw.length > 6) throw new CatalogResolutionError('practicality');
  const items: ResolvedIntent[] = [];
  for (const intent of raw) items.push(await resolveIntent(intent, session, profile, names));
  const identities = items.map(x => `${x.binding.source.type}:${x.binding.source.sourceId}`);
  if (new Set(identities).size !== identities.length || items.reduce((s, x) => s + x.binding.grams, 0) > 1200) throw new CatalogResolutionError('practicality');
  return items;
}
async function revalidate(items: ResolvedIntent[], session: CatalogSearchSession, profile: NutritionProfile, names: NutritionPromptFoodNames) {
  for (const item of items) {
    const current = await session.verify(item.candidate);
    if (catalogNutritionRevision(current.food) !== item.binding.nutritionRevision || nutritionFailure(current)
      || restrictionFailure(current, profile, names)) throw new CatalogResolutionError('changed');
  }
}
function attach(foods: import('../shared/types/nutrition').NutritionPlanFoodItem[], items: ResolvedIntent[]) {
  foods.forEach((food, index) => {
    food.catalogBinding = { ...items[index].binding };
    const source = items[index].candidate.food;
    if (!('allergens' in source) || source.allergens === null) delete food.allergens;
  });
}
function resolutionFailure(error: unknown): never {
  if (error instanceof CatalogResolutionError) throw new PlanValidationError('AI_CATALOG_RESOLUTION_FAILED',
    !['budget', 'timeout', 'unavailable', 'changed'].includes(error.reason), error.message, undefined, undefined,
    error.repair ? { catalogResolution: error.repair } : undefined);
  throw error;
}
export async function linkAndValidatePlan(raw: unknown, session: CatalogSearchSession, profile: NutritionProfile,
  engine: NutritionEngineOutput, names: NutritionPromptFoodNames): Promise<ValidatedPlan> {
  try {
    const output = parseAiOutput(raw);
    if (output.meals.length !== profile.mealSlots.length || output.meals.some((m, i) => m.slot !== profile.mealSlots[i])) {
      throw new PlanValidationError('AI_SCHEMA_INVALID', true, 'meal_slots_mismatch');
    }
    const resolved: ResolvedIntent[][] = [];
    for (let i = 0; i < output.meals.length; i++) {
      const items = await resolveFoods(output.meals[i].foods, session, profile, names);
      if (correctCatalogPortions(items, engine.mealTargets[i])) session.metrics.corrections++;
      resolved.push(items);
    }
    const repetition = new Map<string, number>();
    for (const items of resolved) for (const x of items) {
      const id = `${x.binding.source.type}:${x.binding.source.sourceId}`;
      repetition.set(id, (repetition.get(id) ?? 0) + 1);
    }
    if ([...repetition.values()].some(n => n > Math.max(3, Math.ceil(resolved.length * .67)))) throw new CatalogResolutionError('practicality');
    const canonical = { meals: output.meals.map((m, i) => ({ slot: m.slot, foods: resolved[i].map(rawItem) })) };
    // Catalog safety has already been checked independently and is re-read below.
    // Free-text origin heuristics (e.g. 'galinha' inside 'ovo de galinha') are not authority for linked foods.
    const built = validateAndBuildPlan(canonical, profile.mealSlots, engine, [], false);
    await revalidate(resolved.flat(), session, profile, names);
    built.meals.forEach((m, i) => attach(m.options[0].foods, resolved[i]));
    built.corrected = session.metrics.corrections > 0;
    return built;
  } catch (error) { return resolutionFailure(error); }
}
export async function linkAndValidateAlternative(raw: unknown, session: CatalogSearchSession, profile: NutritionProfile,
  slot: NutritionMealSlot, target: MealNutritionTarget, names: NutritionPromptFoodNames): Promise<ValidatedMealAlternative> {
  try {
    const parsed = parseAiMealAlternativeOutput(raw); const resolved: ResolvedIntent[][] = [];
    for (const option of parsed.options) {
      const items = await resolveFoods(option.foods, session, profile, names);
      if (correctCatalogPortions(items, target)) session.metrics.corrections++;
      resolved.push(items);
    }
    const canonical = { recommendedOptionIndex: parsed.recommendedOptionIndex,
      options: resolved.map(items => ({ foods: items.map(rawItem) })) };
    const built = validateAndBuildMealAlternative(canonical, slot, target, [], false);
    await revalidate(resolved.flat(), session, profile, names);
    built.options.forEach((o, i) => attach(o.foods, resolved[i])); built.corrected = session.metrics.corrections > 0;
    return built;
  } catch (error) { return resolutionFailure(error); }
}

/** Read inside the activation transaction: a concurrent catalog edit causes a
 * transaction retry or controlled rejection, never a silently stale activation. */
export async function assertCatalogBindingsCurrent(
  tx: import('firebase-admin/firestore').Transaction, db: import('firebase-admin/firestore').Firestore,
  options: { foods: import('../shared/types/nutrition').NutritionPlanFoodItem[] }[],
  profile: NutritionProfile, names: NutritionPromptFoodNames, session: CatalogSearchSession,
): Promise<void> {
  const unique = new Map<string, NonNullable<import('../shared/types/nutrition').NutritionPlanFoodItem['catalogBinding']>>();
  for (const option of options) for (const food of option.foods) {
    const b = food.catalogBinding;
    if (!b || food.quantity !== b.grams || food.unit !== 'g') throw new PlanValidationError('AI_CATALOG_RESOLUTION_FAILED', false, 'CATALOG_CHANGED');
    unique.set(`${b.collection}/${b.foodId}`, b);
  }
  if (session.metrics.reads + unique.size > session.maxReads) throw new PlanValidationError('AI_CATALOG_RESOLUTION_FAILED', false, 'CATALOG_BUDGET');
  for (const b of unique.values()) {
    session.check(); session.metrics.reads++;
    const snap = await tx.get(db.collection(b.collection).doc(b.foodId));
    const food = snap.exists ? { ...snap.data(), id: snap.id } as ResolvedIntent['candidate']['food'] : null;
    if (!food || catalogNutritionRevision(food) !== b.nutritionRevision
      || nutritionFailure({ collection: b.collection, food }) || restrictionFailure({ collection: b.collection, food }, profile, names)) {
      throw new PlanValidationError('AI_CATALOG_RESOLUTION_FAILED', false, 'CATALOG_CHANGED');
    }
  }
}
