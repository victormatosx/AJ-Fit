import { evaluateOffProductQuality, firstOffBrand, offNutrientValue, type RawOffProduct } from './offQualityFilter';
import { mapOffCategory } from './offCategoryMap';
import type { RawFoodLogRecord } from './normalize';

/**
 * Shared OFF -> `RawFoodLogRecord` mapping, used by BOTH the Fase C2
 * search-API importer (`scripts/nutrition/foodLog/importOff.ts`) and the
 * Fase C3 bulk-export importer (`scripts/nutrition/foodLog/importOffBulk.ts`)
 * — one mapping rule set, never duplicated/drifted between the two entry
 * points. Respects the ODbL/share-alike conclusion
 * (`docs/nutrition/catalog-expansion/05_licensing_and_storage.md`): every
 * record keeps `source.type: 'off'` + full provenance/attribution, is
 * never merged into TACO records.
 */
export const OFF_ATTRIBUTION_TEXT = 'Dados de Open Food Facts (openfoodfacts.org), disponiveis sob licenca ODbL. '
  + 'Contribua e saiba mais em https://br.openfoodfacts.org.';

/**
 * Fase C6 ("serving units") — OFF's `serving_quantity` is already
 * grams-normalized by OFF itself (unlike `serving_size`, free text like
 * `"1 lata (350ml)"`), so it needs no density guessing: it IS the gram
 * equivalent. Returns `null` when OFF didn't provide one — never
 * fabricated from `serving_size` text alone.
 */
function offServingUnit(product: RawOffProduct): RawFoodLogRecord['servings'] {
  const grams = typeof product.serving_quantity === 'number' ? product.serving_quantity
    : typeof product.serving_quantity === 'string' ? Number(product.serving_quantity) : null;
  if (grams == null || !Number.isFinite(grams) || grams <= 0 || grams > 10_000) return undefined;
  const label = product.serving_size?.trim() || `${grams} g`;
  return [{ id: 'porcao', label: label.length > 60 ? `${grams} g` : label, quantity: 1, gramEquivalent: grams, provenance: 'provider_official' }];
}

export function toOffFoodLogRecord(product: RawOffProduct, catalogVersion: string): RawFoodLogRecord {
  const fiber = offNutrientValue(product.nutriments, 'fiber_100g');
  const brand = firstOffBrand(product.brands);
  const servings = offServingUnit(product);
  return {
    source: { type: 'off', sourceId: product.code!.trim(), sourceName: 'Open Food Facts', sourceVersion: catalogVersion },
    name: product.product_name!.trim(),
    barcode: product.code!.trim(),
    ...(brand ? { brand: { name: brand }, aliases: [brand] } : {}),
    ...(servings ? { servings } : {}),
    locale: product.lang === 'pt' ? 'pt-BR' : (product.lang ?? 'pt-BR'),
    category: mapOffCategory(product.categories_tags),
    nutritionPer100g: {
      kcal: offNutrientValue(product.nutriments, 'energy-kcal_100g')!,
      proteinG: offNutrientValue(product.nutriments, 'proteins_100g')!,
      carbsG: offNutrientValue(product.nutriments, 'carbohydrates_100g')!,
      fatG: offNutrientValue(product.nutriments, 'fat_100g')!,
      fiberG: fiber,
    },
    status: 'active',
    provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: OFF_ATTRIBUTION_TEXT },
  };
}

export interface OffBatchResult {
  accepted: RawFoodLogRecord[];
  rejected: { index: number; reason: string }[];
}

/**
 * Applies the quality gate + mapping to one batch of raw OFF products.
 * `seenBarcodes` is caller-owned and mutated in place so cross-BATCH
 * (not just cross-record) barcode dedup holds when called repeatedly
 * over a streamed file (`importOffBulk.ts`) — a barcode seen in an
 * earlier chunk still rejects a later chunk's duplicate.
 */
export function processOffBatch(products: readonly RawOffProduct[], catalogVersion: string, seenBarcodes: Set<string>, indexOffset = 0): OffBatchResult {
  const accepted: RawFoodLogRecord[] = [];
  const rejected: { index: number; reason: string }[] = [];
  products.forEach((product, offset) => {
    const index = indexOffset + offset;
    const quality = evaluateOffProductQuality(product);
    if (!quality.ok) { rejected.push({ index, reason: quality.reason }); return; }
    const barcode = product.code!.trim();
    if (seenBarcodes.has(barcode)) { rejected.push({ index, reason: 'DUPLICATE_BARCODE_IN_BATCH' }); return; }
    seenBarcodes.add(barcode);
    accepted.push(toOffFoodLogRecord(product, catalogVersion));
  });
  return { accepted, rejected };
}
