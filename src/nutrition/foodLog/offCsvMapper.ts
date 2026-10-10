import type { RawOffProduct } from './offQualityFilter';

const REQUIRED_COLUMNS = [
  'code', 'product_name', 'brands', 'categories_tags', 'countries_tags',
  'energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'proteins_100g',
  'carbohydrates_100g', 'fat_100g', 'fiber_100g',
] as const;

export interface OffCsvLayout {
  columns: ReadonlyMap<string, number>;
}

export function parseOffCsvHeader(line: string): OffCsvLayout {
  const names = line.replace(/^\uFEFF/u, '').split('\t');
  const columns = new Map(names.map((name, index) => [name, index]));
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.has(name));
  if (missing.length > 0) throw new Error(`OFF_CSV_MISSING_COLUMNS:${missing.join(',')}`);
  return { columns };
}

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

/** Maps one row from OFF's official tab-separated CSV export into the same raw shape as the JSONL/search-API pipelines. */
export function offCsvRowToProduct(line: string, layout: OffCsvLayout): RawOffProduct {
  const cells = line.split('\t');
  const value = (name: string): string => cells[layout.columns.get(name)!] ?? '';
  const nutriments: Record<string, string> = {};
  for (const key of ['energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g']) {
    const nutrient = value(key).trim();
    if (nutrient) nutriments[key] = nutrient;
  }
  // Fase C6 ("serving units") — optional columns: not in `REQUIRED_COLUMNS`
  // (older exports/fixtures lack them), present in OFF's real bulk export.
  const servingSize = layout.columns.has('serving_size') ? value('serving_size').trim() : '';
  const servingQuantity = layout.columns.has('serving_quantity') ? value('serving_quantity').trim() : '';
  return {
    code: value('code').trim(),
    product_name: value('product_name').trim(),
    brands: value('brands').trim(),
    categories_tags: splitTags(value('categories_tags')),
    countries_tags: splitTags(value('countries_tags')),
    nutriments,
    ...(servingSize ? { serving_size: servingSize } : {}),
    ...(servingQuantity ? { serving_quantity: servingQuantity } : {}),
  };
}

export function isBrazilOffProduct(product: RawOffProduct): boolean {
  return (product.countries_tags ?? []).some((tag) => tag.toLowerCase() === 'en:brazil');
}
