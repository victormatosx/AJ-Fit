import {
  NUTRITION_FOOD_ALLERGENS, NUTRITION_FOOD_CATEGORIES, NUTRITION_FOOD_GENERATION_STATUSES,
  NUTRITION_FOOD_SOURCE_TYPES, NUTRITION_FOOD_PREPARATIONS, NUTRITION_GENERATION_ALLOWED_PREPARATIONS,
  NUTRITION_MEAL_CONTEXTS, type NutritionFood, type NutritionFoodAllergen,
  type NutritionFoodCategory, type NutritionFoodGenerationStatus, type NutritionFoodSourceType,
  type NutritionFoodPreparation, type NutritionMealContext,
} from '../../types/nutrition';
import { validateNutritionValues } from './math';

export interface RawFoodRecord {
  source: { type: string; sourceId: string; sourceName: string; sourceVersion?: string };
  name: string;
  aliases?: string[];
  category: string;
  nutritionPer100g?: RawNutrients;
  /** For labels that report a weighed serving; converted explicitly to 100 g. */
  nutritionPerServing?: RawNutrients;
  servingGrams?: number;
  units?: { energy?: 'kcal' | 'kJ'; protein?: 'g' | 'mg'; carbs?: 'g' | 'mg';
    fat?: 'g' | 'mg'; fiber?: 'g' | 'mg' };
  /** null means classification has not been reviewed. */
  dietaryFlags?: { vegetarian?: boolean | null; vegan?: boolean | null; pescatarian?: boolean | null };
  allergens?: string[] | null;
  /** null/omitted means preparation has not been reviewed — never generation-eligible. */
  preparation?: string | null;
  /** Optional metadata, not consulted by generation eligibility. */
  mealContexts?: string[] | null;
  /**
   * Set only by a hand-reviewed enrichment entry (`applyEnrichment.ts`'s
   * `inferFiberGZero`) when the raw source's `fiberG` is null for a food
   * class with no dietary fiber by definition. Never set generically —
   * see `NutritionFood.fiberGProvenance`'s doc comment.
   */
  fiberGProvenance?: 'measured' | 'inferred_zero';
  generationStatus?: string;
  brand?: { name: string; productName?: string } | null;
}

export interface RawNutrients { kcal: number | string; proteinG: number | string;
  carbsG: number | string; fatG: number | string; fiberG?: number | string | null }

export function normalizeFoodName(value: string): string {
  if (typeof value !== 'string') throw new Error('INVALID_FOOD_NAME');
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (normalized.length < 1 || normalized.length > 200) throw new Error('INVALID_FOOD_NAME');
  return normalized;
}

export function normalizeSearchText(value: string): string {
  return normalizeFoodName(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

export function normalizeAliases(values: readonly string[] = [], name?: string): string[] {
  if (!Array.isArray(values) || values.length > 12) throw new Error('INVALID_ALIASES');
  const seen = new Set<string>(name ? [normalizeSearchText(name)] : []);
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeFoodName(value);
    const key = normalizeSearchText(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function normalizeFoodCategory(value: string): NutritionFoodCategory {
  if (typeof value !== 'string') throw new Error('INVALID_FOOD_CATEGORY');
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, '_');
  if (!NUTRITION_FOOD_CATEGORIES.includes(normalized as NutritionFoodCategory)) throw new Error('INVALID_FOOD_CATEGORY');
  return normalized as NutritionFoodCategory;
}

export function normalizeFoodPreparation(value: string | null | undefined): NutritionFoodPreparation | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!NUTRITION_FOOD_PREPARATIONS.includes(normalized as NutritionFoodPreparation)) throw new Error('INVALID_FOOD_PREPARATION');
  return normalized as NutritionFoodPreparation;
}

export function normalizeMealContexts(values: string[] | null | undefined): NutritionMealContext[] | null {
  if (values === undefined || values === null) return null;
  if (!Array.isArray(values) || values.length > NUTRITION_MEAL_CONTEXTS.length) throw new Error('INVALID_MEAL_CONTEXTS');
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (normalized.some((value) => !NUTRITION_MEAL_CONTEXTS.includes(value as NutritionMealContext))) throw new Error('INVALID_MEAL_CONTEXTS');
  return normalized as NutritionMealContext[];
}

export function normalizeNutrientNumber(value: number | string | null | undefined, unit: 'g' | 'mg' | 'kcal' | 'kJ', optional = false): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    if (optional) return null;
    throw new Error('MISSING_NUTRIENT');
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('INVALID_NUTRIENT');
  return unit === 'mg' ? parsed / 1000 : unit === 'kJ' ? parsed / 4.184 : parsed;
}

/** Source IDs, not names, determine identity. Hash suffix prevents sanitized-ID collisions. */
export function nutritionFoodId(type: NutritionFoodSourceType, sourceId: string): string {
  if (!NUTRITION_FOOD_SOURCE_TYPES.includes(type) || typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200) throw new Error('INVALID_SOURCE_ID');
  const identity = `${type}:${sourceId.trim()}`;
  let first = 0x811c9dc5;
  let second = 5381;
  for (const char of identity) {
    const code = char.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  const slug = sourceId.trim().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 35) || 'id';
  return `nf_${type}_${slug}_${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

/** One indexed prefix per distinct search fragment; capped to avoid index bloat. */
export function searchPrefixes(name: string, aliases: readonly string[]): string[] {
  const prefixes = new Set<string>();
  for (const label of [name, ...aliases]) {
    const phrase = normalizeSearchText(label);
    for (const term of [phrase, ...phrase.split(' ')]) {
      for (let n = 2; n <= Math.min(32, term.length); n += 1) {
        const prefix = term.slice(0, n).trimEnd();
        if (prefix.length >= 2) prefixes.add(prefix);
      }
    }
  }
  if (prefixes.size > 200) throw new Error('TOO_MANY_SEARCH_PREFIXES');
  return [...prefixes].sort();
}

export type CatalogFoodBody = Omit<NutritionFood, 'createdAt' | 'updatedAt'>;

export function normalizeFoodRecord(raw: RawFoodRecord, catalogVersion: string): CatalogFoodBody {
  if (!raw || typeof raw !== 'object' || !raw.source || typeof raw.source !== 'object') throw new Error('INVALID_FOOD_SOURCE');
  const type = typeof raw.source.type === 'string' ? raw.source.type.trim().toLowerCase() : '';
  if (!NUTRITION_FOOD_SOURCE_TYPES.includes(type as NutritionFoodSourceType)) throw new Error('INVALID_FOOD_SOURCE');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(catalogVersion)) throw new Error('INVALID_CATALOG_VERSION');
  const sourceId = raw.source.sourceId?.trim();
  const sourceName = normalizeFoodName(raw.source.sourceName);
  if (!sourceId || sourceId.length > 200 || sourceId.includes('/')) throw new Error('INVALID_SOURCE_ID');
  if (raw.source.sourceVersion != null && (!raw.source.sourceVersion.trim() || raw.source.sourceVersion.length > 80)) throw new Error('INVALID_SOURCE_VERSION');
  const name = normalizeFoodName(raw.name);
  const aliases = normalizeAliases(raw.aliases, name);
  const category = normalizeFoodCategory(raw.category);
  if (Boolean(raw.nutritionPer100g) === Boolean(raw.nutritionPerServing)) throw new Error('AMBIGUOUS_NUTRITION_BASIS');
  const n = raw.nutritionPer100g ?? raw.nutritionPerServing;
  if (!n || typeof n !== 'object') throw new Error('INVALID_NUTRITION_VALUES');
  const scale = raw.nutritionPerServing ? (typeof raw.servingGrams === 'number' && Number.isFinite(raw.servingGrams)
    && raw.servingGrams > 0 && raw.servingGrams <= 10000 ? 100 / raw.servingGrams : NaN) : 1;
  if (!Number.isFinite(scale) || (raw.nutritionPer100g && raw.servingGrams !== undefined)) throw new Error('INVALID_SERVING_GRAMS');
  const units = raw.units ?? {};
  if (!['kcal', 'kJ'].includes(units.energy ?? 'kcal')
    || ![units.protein, units.carbs, units.fat, units.fiber].every((unit) => unit === undefined || unit === 'g' || unit === 'mg')) throw new Error('INVALID_NUTRIENT_UNIT');
  const scaled = (value: number | string | null | undefined, unit: 'g' | 'mg' | 'kcal' | 'kJ', optional = false) => {
    const normalized = normalizeNutrientNumber(value, unit, optional);
    return normalized === null ? null : normalized * scale;
  };
  const nutritionPer100g = {
    kcal: scaled(n.kcal, units.energy ?? 'kcal') as number,
    proteinG: scaled(n.proteinG, units.protein ?? 'g') as number,
    carbsG: scaled(n.carbsG, units.carbs ?? 'g') as number,
    fatG: scaled(n.fatG, units.fat ?? 'g') as number,
    fiberG: scaled(n.fiberG, units.fiber ?? 'g', true),
  };
  validateNutritionValues(nutritionPer100g);
  if (raw.fiberGProvenance !== undefined && raw.fiberGProvenance !== 'measured' && raw.fiberGProvenance !== 'inferred_zero') {
    throw new Error('INVALID_FIBER_PROVENANCE');
  }
  // `inferred_zero` is a per-item, hand-reviewed enrichment claim (never a
  // generic rule) — the only thing normalize.ts enforces is that the claim
  // is internally consistent: an inferred value must literally be exactly 0,
  // never any other number and never still null.
  if (raw.fiberGProvenance === 'inferred_zero' && nutritionPer100g.fiberG !== 0) throw new Error('INVALID_FIBER_PROVENANCE');
  const flags = raw.dietaryFlags;
  for (const value of [flags?.vegetarian, flags?.vegan, flags?.pescatarian]) {
    if (value !== undefined && value !== null && typeof value !== 'boolean') throw new Error('INVALID_DIETARY_FLAGS');
  }
  const dietaryFlags = { vegetarian: flags?.vegetarian ?? null, vegan: flags?.vegan ?? null,
    pescatarian: flags?.pescatarian ?? null };
  if (dietaryFlags.vegan === true && (dietaryFlags.vegetarian === false || dietaryFlags.pescatarian === false)
    || dietaryFlags.vegetarian === true && dietaryFlags.pescatarian === false) throw new Error('CONTRADICTORY_DIETARY_FLAGS');
  const allergens = raw.allergens === undefined || raw.allergens === null ? null : [...new Set(raw.allergens)] as NutritionFoodAllergen[];
  if (allergens !== null && (!Array.isArray(raw.allergens) || allergens.length > 9
    || allergens.some((value) => !NUTRITION_FOOD_ALLERGENS.includes(value as NutritionFoodAllergen)))) throw new Error('INVALID_ALLERGENS');
  const preparation = normalizeFoodPreparation(raw.preparation);
  // `mealContexts` stays as optional metadata (diet-quality-v2, 2026-10-10):
  // generation no longer gates a food's eligible meal slots on it, so it is
  // no longer required for approval — only `preparation` still is, since
  // that's the one field generation still uses to keep composite dishes
  // (à milanesa, etc.) out of the candidate pool.
  const mealContexts = normalizeMealContexts(raw.mealContexts);
  const status = raw.generationStatus ?? 'pending_review';
  if (!NUTRITION_FOOD_GENERATION_STATUSES.includes(status as NutritionFoodGenerationStatus)) throw new Error('INVALID_GENERATION_STATUS');
  if (status === 'approved' && (allergens === null || Object.values(dietaryFlags).some((value) => value === null)
    || preparation === null)) throw new Error('UNREVIEWED_FOOD_CANNOT_BE_APPROVED');
  if (status === 'approved' && preparation !== null && !NUTRITION_GENERATION_ALLOWED_PREPARATIONS.includes(preparation)) {
    throw new Error('COMPOSITE_PREPARATION_CANNOT_BE_APPROVED');
  }
  const brand = raw.brand == null ? null : { name: normalizeFoodName(raw.brand.name),
    ...(raw.brand.productName ? { productName: normalizeFoodName(raw.brand.productName) } : {}) };
  if (type === 'label' && (!brand || !raw.source.sourceVersion)) throw new Error('LABEL_REQUIRES_BRAND_AND_REVIEW_VERSION');
  return { id: nutritionFoodId(type as NutritionFoodSourceType, sourceId), name, aliases,
    category,
    source: { type: type as NutritionFoodSourceType, sourceId, sourceName,
      ...(raw.source.sourceVersion ? { sourceVersion: raw.source.sourceVersion.trim() } : {}) },
    nutritionPer100g, dietaryFlags, allergens, preparation, mealContexts,
    ...(raw.fiberGProvenance ? { fiberGProvenance: raw.fiberGProvenance } : {}),
    generationStatus: status as NutritionFoodGenerationStatus,
    ...(brand ? { brand } : {}), catalogVersion,
    searchPrefixes: searchPrefixes(name, aliases) };
}
