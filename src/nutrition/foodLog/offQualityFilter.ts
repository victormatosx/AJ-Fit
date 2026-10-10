/**
 * Deterministic quality gate for raw Open Food Facts products (round brief
 * C2 Part 6) — pure, no network, no AI. Each rule is independently
 * testable and the rejection reason is always reported, never silently
 * dropped (round brief Part 14: "rejeitados + motivo").
 */
export interface RawOffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  categories_tags?: string[];
  countries_tags?: string[];
  lang?: string;
  nutriments?: Record<string, number | string | undefined>;
}

export type OffQualityResult =
  | { ok: true }
  | { ok: false; reason: string };

function toNumber(value: number | string | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Shared by the filter (reject) and the mapper (normalize) so the two can never disagree about what a valid number looks like. */
export function offNutrientValue(nutriments: Record<string, number | string | undefined> | undefined, key: string): number | null {
  const direct = toNumber(nutriments?.[key]);
  if (direct != null) return direct;
  if (key === 'energy-kcal_100g') {
    const kilojoules = toNumber(nutriments?.energy_100g ?? nutriments?.['energy-kj_100g']);
    return kilojoules == null ? null : kilojoules / 4.184;
  }
  return null;
}

export function evaluateOffProductQuality(product: RawOffProduct): OffQualityResult {
  if (!product.code || !/^[0-9]{8,14}$/.test(product.code.trim())) return { ok: false, reason: 'MISSING_OR_INVALID_BARCODE' };
  const name = product.product_name?.trim();
  if (!name || name.length < 2 || name.length > 200) return { ok: false, reason: 'MISSING_OR_INVALID_NAME' };
  if (!/[\p{L}]/u.test(name)) return { ok: false, reason: 'NAME_HAS_NO_LETTERS' };

  const kcal = offNutrientValue(product.nutriments, 'energy-kcal_100g');
  const protein = offNutrientValue(product.nutriments, 'proteins_100g');
  const carbs = offNutrientValue(product.nutriments, 'carbohydrates_100g');
  const fat = offNutrientValue(product.nutriments, 'fat_100g');
  if (kcal == null || protein == null || carbs == null || fat == null) return { ok: false, reason: 'INCOMPLETE_MACROS' };
  if (kcal < 0 || protein < 0 || carbs < 0 || fat < 0) return { ok: false, reason: 'NEGATIVE_NUTRIENT_VALUE' };
  if (kcal === 0 && protein + carbs + fat > 1) return { ok: false, reason: 'ZERO_KCAL_WITH_MACROS' };
  if (kcal > 900 || protein > 100 || carbs > 100 || fat > 100) return { ok: false, reason: 'IMPLAUSIBLE_NUTRIENT_VALUE' };
  if (protein + carbs + fat > 105) return { ok: false, reason: 'MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT' };

  const fiber = offNutrientValue(product.nutriments, 'fiber_100g');
  if (fiber != null && (fiber < 0 || fiber > 100)) return { ok: false, reason: 'IMPLAUSIBLE_FIBER_VALUE' };

  const countries = product.countries_tags ?? [];
  if (countries.length > 0 && !countries.some((tag) => tag.toLowerCase().includes('brazil'))) return { ok: false, reason: 'NOT_BRAZIL_MARKET' };

  return { ok: true };
}

/** First brand only, when `brands` is a comma-separated list (OFF convention) — matches `NutritionFoodSource.brand`'s single-brand shape. */
export function firstOffBrand(brands: string | undefined): string | null {
  if (!brands?.trim()) return null;
  const first = brands.split(',')[0]?.trim();
  return first && first.length <= 120 ? first : null;
}
