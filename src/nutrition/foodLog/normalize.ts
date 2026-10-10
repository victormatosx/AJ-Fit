/**
 * Food Log Catalog (`foodLogCatalog`) normalization — Fase C2
 * (`docs/nutrition/catalog-expansion/03_canonical_model.md`). Deliberately
 * reuses the generation catalog's primitives (`normalizeFoodName`,
 * `normalizeSearchText`, `normalizeAliases`, `searchPrefixes`,
 * `normalizeFoodCategory`, `normalizeNutrientNumber`,
 * `validateNutritionValues`) — only identity (ID scheme, source vocabulary)
 * and the visibility gate (`status`, not `generationStatus`) differ from
 * `src/nutrition/catalog/normalize.ts`.
 */
import {
  FOOD_LOG_LICENSES, FOOD_LOG_SOURCE_TYPES, FOOD_LOG_STATUSES,
  type FoodLogEntry, type FoodLogLicense, type FoodLogSourceType, type FoodLogStatus,
  type NutritionFoodCategory,
} from '../../types/nutrition';
import {
  normalizeAliases, normalizeFoodCategory, normalizeFoodName, normalizeNutrientNumber, normalizeSearchText,
  searchPrefixes as computeSearchPrefixes,
} from '../catalog/normalize';
import { validateNutritionValues } from '../catalog/math';
import { deriveHyphenCompoundAliases } from './aliases';
import { classifyFoodLogSubCategory } from './subCategory';

export interface RawFoodLogRecord {
  source: { type: string; sourceId: string; sourceName: string; sourceVersion?: string };
  name: string;
  aliases?: string[];
  brand?: { name: string; productName?: string } | null;
  barcode?: string | null;
  locale?: string;
  category: string;
  nutritionPer100g: { kcal: number | string; proteinG: number | string; carbsG: number | string;
    fatG: number | string; fiberG?: number | string | null };
  units?: { energy?: 'kcal' | 'kJ'; protein?: 'g' | 'mg'; carbs?: 'g' | 'mg'; fat?: 'g' | 'mg'; fiber?: 'g' | 'mg' };
  status?: string;
  provenance: { license: string; attributionRequired: boolean; attributionText?: string };
}

/** Same FNV/djb2 hash as `nutritionFoodId`, prefixed `flc_` instead of `nf_` to keep the two ID spaces visually and programmatically distinct. */
export function foodLogId(type: FoodLogSourceType, sourceId: string): string {
  if (!FOOD_LOG_SOURCE_TYPES.includes(type) || typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200) throw new Error('INVALID_SOURCE_ID');
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
  return `flc_${type}_${slug}_${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

/** Normalizes a barcode to digits-only, or `null` if absent/unusable (round brief C2 §5: "armazenar quando existir", never fabricated). */
export function normalizeBarcode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = String(value).trim().replace(/[^0-9]/gu, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

export type FoodLogEntryBody = Omit<FoodLogEntry, 'createdAt' | 'updatedAt'>;

export function normalizeFoodLogRecord(raw: RawFoodLogRecord, catalogVersion: string): FoodLogEntryBody {
  if (!raw || typeof raw !== 'object' || !raw.source || typeof raw.source !== 'object') throw new Error('INVALID_FOOD_SOURCE');
  const type = typeof raw.source.type === 'string' ? raw.source.type.trim().toLowerCase() : '';
  if (!FOOD_LOG_SOURCE_TYPES.includes(type as FoodLogSourceType)) throw new Error('INVALID_FOOD_SOURCE');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(catalogVersion)) throw new Error('INVALID_CATALOG_VERSION');
  const sourceId = raw.source.sourceId?.trim();
  const sourceName = normalizeFoodName(raw.source.sourceName);
  if (!sourceId || sourceId.length > 200 || sourceId.includes('/')) throw new Error('INVALID_SOURCE_ID');
  if (raw.source.sourceVersion != null && (!raw.source.sourceVersion.trim() || raw.source.sourceVersion.length > 80)) throw new Error('INVALID_SOURCE_VERSION');

  const name = normalizeFoodName(raw.name);
  // Fase C3 (`docs/nutrition/catalog-expansion/11_c3_implementation.md`):
  // a hyphenated compound in the SOURCE name ("contra-filé") never matches
  // a user typing it as one run-together word ("contrafile") once
  // `normalizeSearchText` turns the hyphen into a space — deriving the
  // concatenated form as an extra alias here runs for every hyphenated
  // name from any source, not a per-food manual list.
  const hyphenAliases = deriveHyphenCompoundAliases(raw.name);
  const aliases = normalizeAliases([...(raw.aliases ?? []), ...hyphenAliases], name);
  const category = normalizeFoodCategory(raw.category) as NutritionFoodCategory;

  const n = raw.nutritionPer100g;
  if (!n || typeof n !== 'object') throw new Error('INVALID_NUTRITION_VALUES');
  const units = raw.units ?? {};
  if (!['kcal', 'kJ'].includes(units.energy ?? 'kcal')
    || ![units.protein, units.carbs, units.fat, units.fiber].every((unit) => unit === undefined || unit === 'g' || unit === 'mg')) throw new Error('INVALID_NUTRIENT_UNIT');
  const nutritionPer100g = {
    kcal: normalizeNutrientNumber(n.kcal, units.energy ?? 'kcal') as number,
    proteinG: normalizeNutrientNumber(n.proteinG, units.protein ?? 'g') as number,
    carbsG: normalizeNutrientNumber(n.carbsG, units.carbs ?? 'g') as number,
    fatG: normalizeNutrientNumber(n.fatG, units.fat ?? 'g') as number,
    fiberG: normalizeNutrientNumber(n.fiberG, units.fiber ?? 'g', true),
  };
  validateNutritionValues(nutritionPer100g);
  // Domain bound tighter than `validateNutritionValues`' generic ceiling —
  // per-100g energy/macros cannot physically exceed these without being a
  // unit-conversion bug upstream (round brief C2 Part 6: "energia/macros
  // claramente inválidos").
  if (nutritionPer100g.kcal > 900 || nutritionPer100g.proteinG > 100
    || nutritionPer100g.carbsG > 100 || nutritionPer100g.fatG > 100
    || (nutritionPer100g.fiberG != null && nutritionPer100g.fiberG > 100)) {
    throw new Error('IMPLAUSIBLE_NUTRITION_VALUES');
  }

  const brand = raw.brand == null ? null : { name: normalizeFoodName(raw.brand.name),
    ...(raw.brand.productName ? { productName: normalizeFoodName(raw.brand.productName) } : {}) };
  const barcode = normalizeBarcode(raw.barcode);
  const locale = typeof raw.locale === 'string' && raw.locale.trim() ? raw.locale.trim() : 'pt-BR';

  const status = (raw.status ?? 'active') as FoodLogStatus;
  if (!FOOD_LOG_STATUSES.includes(status)) throw new Error('INVALID_FOOD_LOG_STATUS');

  if (!raw.provenance || typeof raw.provenance !== 'object') throw new Error('INVALID_PROVENANCE');
  const license = raw.provenance.license as FoodLogLicense;
  if (!FOOD_LOG_LICENSES.includes(license)) throw new Error('INVALID_PROVENANCE');
  if (typeof raw.provenance.attributionRequired !== 'boolean') throw new Error('INVALID_PROVENANCE');
  if (raw.provenance.attributionRequired && !raw.provenance.attributionText?.trim()) throw new Error('ATTRIBUTION_TEXT_REQUIRED');

  const subCategory = classifyFoodLogSubCategory(name, category, brand != null);
  const searchSourcePriority = type === 'taco' || type === 'tbca' ? 0 : 1;

  return {
    id: foodLogId(type as FoodLogSourceType, sourceId),
    source: { type: type as FoodLogSourceType, sourceId, sourceName,
      ...(raw.source.sourceVersion ? { sourceVersion: raw.source.sourceVersion.trim() } : {}) },
    name, aliases, ...(brand ? { brand } : {}), ...(barcode ? { barcode } : {}),
    locale, category, subCategory, nutritionPer100g, status, catalogVersion,
    provenance: { license, attributionRequired: raw.provenance.attributionRequired,
      ...(raw.provenance.attributionText ? { attributionText: raw.provenance.attributionText.trim() } : {}) },
    searchPrefixes: computeSearchPrefixes(name, aliases), searchSourcePriority,
  };
}

export { normalizeFoodName, normalizeSearchText };
