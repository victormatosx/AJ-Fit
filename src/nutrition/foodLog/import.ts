import { normalizeFoodLogRecord, type FoodLogEntryBody, type RawFoodLogRecord } from './normalize';

export interface FoodLogImportFile {
  schemaVersion: 1;
  catalogVersion: string;
  records: RawFoodLogRecord[];
}

export function parseFoodLogImportFile(text: string): FoodLogImportFile {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_FOOD_LOG_IMPORT');
  const file = data as Record<string, unknown>;
  if (file.schemaVersion !== 1 || typeof file.catalogVersion !== 'string' || !Array.isArray(file.records)
    || file.records.length > 20000) throw new Error('INVALID_FOOD_LOG_IMPORT');
  return file as unknown as FoodLogImportFile;
}

export interface PrepareFoodLogImportResult {
  foods: FoodLogEntryBody[];
  rejected: { index: number; reason: string }[];
}

/**
 * Unlike `prepareCatalogImport` (generation catalog), a single bad record
 * here is REJECTED and reported, not a fatal error for the whole batch —
 * this catalog ingests externally-sourced data at volume (round brief C2
 * Part 6: "rejeitar registros quebrados/inconsistentes" without failing the
 * whole import). Same-ID conflicts within one file are still rejected
 * (never silently pick one), consistent with the generation catalog's
 * dedup-by-identity rule (`03_canonical_model.md`).
 */
export function prepareFoodLogImport(file: FoodLogImportFile): PrepareFoodLogImportResult {
  if (file.schemaVersion !== 1 || !Array.isArray(file.records) || file.records.length > 20000) throw new Error('INVALID_FOOD_LOG_IMPORT');
  const byId = new Map<string, FoodLogEntryBody>();
  const rejected: { index: number; reason: string }[] = [];
  file.records.forEach((record, index) => {
    let food: FoodLogEntryBody;
    try {
      food = normalizeFoodLogRecord(record, file.catalogVersion);
    } catch (error) {
      rejected.push({ index, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    const previous = byId.get(food.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(food)) {
      rejected.push({ index, reason: `CONFLICTING_DUPLICATE_FOOD:${food.id}` });
      return;
    }
    byId.set(food.id, food);
  });
  return { foods: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), rejected };
}
