import { normalizeFoodRecord, type CatalogFoodBody, type RawFoodRecord } from './normalize';

export interface CatalogImportFile {
  schemaVersion: 1;
  catalogVersion: string;
  records: RawFoodRecord[];
}

export function parseCatalogImportFile(text: string): CatalogImportFile {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_CATALOG_IMPORT');
  const file = data as Record<string, unknown>;
  if (file.schemaVersion !== 1 || typeof file.catalogVersion !== 'string' || !Array.isArray(file.records)
    || file.records.length > 10000) throw new Error('INVALID_CATALOG_IMPORT');
  return file as unknown as CatalogImportFile;
}

export function prepareCatalogImport(file: CatalogImportFile): CatalogFoodBody[] {
  if (file.schemaVersion !== 1 || !Array.isArray(file.records) || file.records.length > 10000) throw new Error('INVALID_CATALOG_IMPORT');
  const foods = file.records.map((record) => normalizeFoodRecord(record, file.catalogVersion));
  const byId = new Map<string, CatalogFoodBody>();
  for (const food of foods) {
    const previous = byId.get(food.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(food)) throw new Error(`CONFLICTING_DUPLICATE_FOOD:${food.id}`);
    byId.set(food.id, food);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
