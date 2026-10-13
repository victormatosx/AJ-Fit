import type { RawFoodLogRecord } from './normalize';
import type { FoodLogServingUnit } from '../../types/nutrition';
import { FATSECRET_ATTRIBUTION_TEXT } from './fatsecretMapper';

/**
 * Maps FatSecret's `food.get.v2` response into `RawFoodLogRecord` —
 * the ONLY mapper the materialize path uses (security fix: previously the
 * client built its own record from the SEARCH result and wrote it
 * directly to Firestore; `foodLogCatalog`'s own security rules already
 * deny client writes (`allow write: if false`), so that write was
 * silently failing in production AND, had rules ever been loosened,
 * would have let a client dictate arbitrary nutrition values for a
 * shared, global catalog document). Materialization now always re-fetches
 * from FatSecret with the SERVER's own secret
 * (`functions/src/nutrition/foodLog/materializeExternalFood.ts`) and maps
 * the result with this file — the client only ever supplies a `food_id`,
 * never any nutrition value.
 *
 * `food.get.v2`'s structured `servings.serving[]` is strictly better
 * source data than the search endpoint's compact `food_description` text
 * (`fatsecretMapper.ts`): each serving carries its OWN
 * `metric_serving_amount`/`metric_serving_unit` (`'g'`/`'ml'`) and, for
 * gram-based servings, per-serving macros — enough to derive
 * `nutritionPer100g` AND the full natural-unit list in one call, no
 * separate `food.get` round trip needed.
 */
export interface RawFatSecretFoodGetServing {
  serving_id?: string;
  serving_description?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  is_default?: string;
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fiber?: string;
}

export interface RawFatSecretFoodGetFood {
  food_id?: string;
  food_name?: string;
  brand_name?: string;
  servings?: { serving?: RawFatSecretFoodGetServing | RawFatSecretFoodGetServing[] };
}

const MAX_SERVING_UNITS = 8;

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Maps one `food.get.v2` serving entry into a `FoodLogServingUnit`, or `null` when it can't be mapped confidently. */
function mapServingUnit(raw: RawFatSecretFoodGetServing, index: number): FoodLogServingUnit | null {
  const amount = toNumber(raw.metric_serving_amount);
  if (amount == null || amount <= 0) return null;
  const label = raw.serving_description?.trim();
  if (!label || label.length > 60) return null;
  const unit = raw.metric_serving_unit?.trim().toLowerCase();
  const id = `fs-${(raw.serving_id?.trim() || String(index)).replace(/[^a-z0-9]/gu, '').slice(0, 30) || index}`;
  if (unit === 'g') return { id, label, quantity: 1, gramEquivalent: amount, provenance: 'provider_official' };
  if (unit === 'ml') return { id, label, quantity: 1, mlEquivalent: amount, provenance: 'provider_official' };
  return null;
}

/**
 * Returns `null` (never throws, never guesses) when the food has no
 * usable name/id, or no gram-based serving at all to derive
 * `nutritionPer100g` from — a food.get response describing a product
 * only in volume (ml) with no gram metric cannot be safely converted to
 * per-100g without assuming a density this code has no basis for.
 */
export function mapFatSecretFoodGetToFoodLogRecord(food: RawFatSecretFoodGetFood, catalogVersion: string): RawFoodLogRecord | null {
  const name = food.food_name?.trim();
  if (!name || !food.food_id) return null;

  const rawServings = toArray(food.servings?.serving);
  const gramServings = rawServings.filter((serving) => serving.metric_serving_unit?.trim().toLowerCase() === 'g');
  const basis = gramServings.find((serving) => serving.is_default === '1') ?? gramServings[0];
  if (!basis) return null;
  const grams = toNumber(basis.metric_serving_amount);
  const kcal = toNumber(basis.calories);
  const proteinG = toNumber(basis.protein);
  const carbsG = toNumber(basis.carbohydrate);
  const fatG = toNumber(basis.fat);
  const fiberG = toNumber(basis.fiber);
  if (grams == null || grams <= 0 || kcal == null || proteinG == null || carbsG == null || fatG == null) return null;
  const factor = 100 / grams;

  const units = rawServings.map((serving, index) => ({ serving, unit: mapServingUnit(serving, index) }))
    .filter((entry): entry is { serving: RawFatSecretFoodGetServing; unit: FoodLogServingUnit } => entry.unit != null)
    .slice(0, MAX_SERVING_UNITS);
  const defaultUnitEntry = units.find((entry) => entry.serving.is_default === '1') ?? units[0];

  return {
    source: { type: 'fatsecret', sourceId: food.food_id, sourceName: 'FatSecret Platform API', sourceVersion: catalogVersion },
    name,
    ...(food.brand_name ? { brand: { name: food.brand_name }, aliases: [food.brand_name] } : {}),
    locale: 'pt-BR',
    region: 'BR',
    category: 'other',
    nutritionPer100g: {
      kcal: kcal * factor, proteinG: proteinG * factor, carbsG: carbsG * factor, fatG: fatG * factor,
      fiberG: fiberG != null ? fiberG * factor : null,
    },
    status: 'active',
    ...(units.length > 0 ? { servings: units.map((entry) => entry.unit), defaultServingId: defaultUnitEntry?.unit.id ?? null } : {}),
    provenance: { license: 'proprietary_contract', attributionRequired: true, attributionText: FATSECRET_ATTRIBUTION_TEXT },
  };
}
