import type { RawFoodLogRecord } from './normalize';

/**
 * Client-side FatSecret -> `RawFoodLogRecord` mapping (C5 round) — same
 * split as every other food-log source: `functions/src/nutrition/foodLog/
 * searchExternalFood.ts` is a thin authenticated proxy that returns
 * FatSecret's raw JSON as-is (never holds normalization logic), this file
 * does the actual mapping, exactly like `offMapper.ts` does for Open Food
 * Facts. Field names below are copied verbatim from FatSecret's
 * `foods.search.v5` response shape
 * (`docs/nutrition/catalog-expansion/14_c3_external_providers.md`).
 */
export interface RawFatSecretSearchFood {
  food_id: string;
  food_name: string;
  food_type?: 'Brand' | 'Generic';
  brand_name?: string;
  food_description?: string;
}

export const FATSECRET_ATTRIBUTION_TEXT = 'Dados nutricionais fornecidos por FatSecret (platform.fatsecret.com).';

/**
 * `food_description` is PER-SERVING text, e.g. `"Per 100g - Calories: 52kcal
 * | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"` for most generic foods, but
 * branded items often report a non-mass serving instead
 * (`"Per 1 lata (350ml) - Calories: 140kcal | ..."`). Only a gram-based
 * header can be safely scaled to per-100g without assuming a density this
 * code has no basis for — anything else is rejected rather than guessed.
 */
const SERVING_HEADER_PATTERN = /^Per\s+([\d.]+)\s*g\b/iu;
const SERVING_LABEL_PATTERN = /^Per\s+([^-]+?)\s*-/u;
const MACROS_PATTERN = /Calories:\s*([\d.]+)\s*kcal\s*\|\s*Fat:\s*([\d.]+)\s*g\s*\|\s*Carbs:\s*([\d.]+)\s*g\s*\|\s*Protein:\s*([\d.]+)\s*g/iu;
const FIBER_PATTERN = /Fiber:\s*([\d.]+)\s*g/iu;

export interface ParsedFatSecretServing {
  servingGrams: number;
  kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number | null;
}

/** Returns `null` when the description is missing, malformed, or reports a non-gram serving — never a fabricated conversion. */
export function parseFatSecretDescription(description: string | undefined): ParsedFatSecretServing | null {
  if (!description) return null;
  const servingMatch = SERVING_HEADER_PATTERN.exec(description);
  const macrosMatch = MACROS_PATTERN.exec(description);
  if (!servingMatch || !macrosMatch) return null;
  const servingGrams = Number(servingMatch[1]);
  if (!Number.isFinite(servingGrams) || servingGrams <= 0) return null;
  const fiberMatch = FIBER_PATTERN.exec(description);
  return {
    servingGrams,
    kcal: Number(macrosMatch[1]), fatG: Number(macrosMatch[2]),
    carbsG: Number(macrosMatch[3]), proteinG: Number(macrosMatch[4]),
    fiberG: fiberMatch ? Number(fiberMatch[1]) : null,
  };
}

/**
 * Maps one FatSecret search result into `RawFoodLogRecord`, scaling its
 * per-serving macros up/down to per-100g. Returns `null` (never throws) for
 * an item this mapper cannot safely normalize — `normalizeFoodLogRecord`'s
 * own numeric/plausibility checks still run on anything this DOES return,
 * same as every other source.
 */
export function mapFatSecretFoodToFoodLogRecord(food: RawFatSecretSearchFood, catalogVersion: string): RawFoodLogRecord | null {
  const parsed = parseFatSecretDescription(food.food_description);
  if (!parsed) return null;
  const factor = 100 / parsed.servingGrams;
  const name = food.food_name?.trim();
  if (!name) return null;
  return {
    source: { type: 'fatsecret', sourceId: food.food_id, sourceName: 'FatSecret Platform API', sourceVersion: catalogVersion },
    name,
    ...(food.brand_name ? { brand: { name: food.brand_name }, aliases: [food.brand_name] } : {}),
    locale: 'pt-BR',
    region: 'BR',
    ...(SERVING_LABEL_PATTERN.exec(food.food_description ?? '')?.[1]
      ? { servingDescription: SERVING_LABEL_PATTERN.exec(food.food_description ?? '')![1].trim() } : {}),
    // Fase C6 ("serving units") — FatSecret's own reference serving IS a
    // provider-official unit once it's anything other than the generic
    // 100g basis (e.g. "Per 250g" for a packaged product). A non-100
    // gram header is the one structured serving this compact search
    // description reliably gives; FatSecret's full serving LIST
    // (named units like "1 lata") requires a separate `food.get` call
    // this round doesn't make — see the C6 report's follow-up list.
    ...(parsed.servingGrams !== 100 ? {
      servings: [{ id: 'porcao', label: `${parsed.servingGrams} g`, quantity: 1, gramEquivalent: parsed.servingGrams, provenance: 'provider_official' as const }],
    } : {}),
    category: 'other',
    nutritionPer100g: {
      kcal: parsed.kcal * factor, proteinG: parsed.proteinG * factor,
      carbsG: parsed.carbsG * factor, fatG: parsed.fatG * factor,
      fiberG: parsed.fiberG != null ? parsed.fiberG * factor : null,
    },
    status: 'active',
    provenance: { license: 'proprietary_contract', attributionRequired: true, attributionText: FATSECRET_ATTRIBUTION_TEXT },
  };
}
