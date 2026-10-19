import type { FoodLogEntry, FoodLogSourceType, NutritionFoodNutritionValues } from '../../types/nutrition';

/**
 * Deterministic, post-hoc quality audit over already-normalized catalog
 * entries (Fase C3 Part 13) — distinct from `offQualityFilter.ts`'s
 * IMPORT-time gate (which rejects a raw OFF product before it ever
 * becomes a `FoodLogEntry`). This audits records already in the catalog
 * (from any source, including future ones) for issues that only become
 * visible in the normalized shape, or that the original source's own data
 * quality drifted into after import. Never mutates `nutritionPer100g` —
 * only ever produces flags for a human/script to act on (hide, re-import,
 * or accept as-is).
 */
export const QUALITY_FLAGS = [
  'ZERO_KCAL_WITH_MACROS',
  'KCAL_MACRO_MISMATCH',
  'MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT',
  'NEGATIVE_NUTRIENT_VALUE',
  'IMPLAUSIBLE_NUTRIENT_VALUE',
  'SUSPECT_NAME',
  'INVALID_BARCODE_FORMAT',
  'UNUSUAL_KCAL_FOR_CATEGORY',
] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];
export type QualitySeverity = 'warning' | 'severe';

export const QUALITY_FLAG_SEVERITY: Readonly<Record<QualityFlag, QualitySeverity>> = {
  ZERO_KCAL_WITH_MACROS: 'severe',
  KCAL_MACRO_MISMATCH: 'warning',
  MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT: 'severe',
  NEGATIVE_NUTRIENT_VALUE: 'severe',
  IMPLAUSIBLE_NUTRIENT_VALUE: 'severe',
  SUSPECT_NAME: 'severe',
  INVALID_BARCODE_FORMAT: 'warning',
  UNUSUAL_KCAL_FOR_CATEGORY: 'warning',
};

export function isSevereQualityFlag(flag: QualityFlag): boolean {
  return QUALITY_FLAG_SEVERITY[flag] === 'severe';
}

const ATWATER_FACTORS = { proteinG: 4, carbsG: 4, fatG: 9 } as const;

function atwaterKcal(values: NutritionFoodNutritionValues): number {
  return values.proteinG * ATWATER_FACTORS.proteinG + values.carbsG * ATWATER_FACTORS.carbsG + values.fatG * ATWATER_FACTORS.fatG;
}

const LOW_KCAL_CATEGORIES = new Set(['fruit', 'vegetable', 'beverage']);

export function auditFoodLogEntry<TTimestamp>(entry: FoodLogEntry<TTimestamp>): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const { nutritionPer100g: n } = entry;
  const macroSum = n.proteinG + n.carbsG + n.fatG;
  const nutrientValues = [n.kcal, n.proteinG, n.carbsG, n.fatG, ...(n.fiberG == null ? [] : [n.fiberG])];

  if (nutrientValues.some((value) => value < 0)) flags.push('NEGATIVE_NUTRIENT_VALUE');
  if (n.kcal > 1_000 || [n.proteinG, n.carbsG, n.fatG, n.fiberG ?? 0].some((value) => value > 100)) {
    flags.push('IMPLAUSIBLE_NUTRIENT_VALUE');
  }

  if (n.kcal <= 0 && macroSum > 1) flags.push('ZERO_KCAL_WITH_MACROS');

  const expectedKcal = atwaterKcal(n);
  // Label carbohydrates may include or exclude fibre depending on market;
  // fibre contributes roughly 2 kcal/g. Alcohol and polyols are not fields
  // in the canonical model, so a wider asymmetric upper tolerance prevents
  // those legitimate declared calories from becoming blocking errors.
  const expectedWithFiber = expectedKcal + (n.fiberG ?? 0) * 2;
  const belowExpected = expectedKcal - n.kcal > Math.max(80, expectedKcal * 0.4);
  const aboveExpected = n.kcal - expectedWithFiber > Math.max(120, expectedWithFiber * 0.6);
  if (expectedKcal > 10 && (belowExpected || aboveExpected)) {
    flags.push('KCAL_MACRO_MISMATCH');
  }

  // A small tolerance above 100g/100g absorbs rounding and water-content
  // edge cases (some dehydrated/concentrated products legitimately report
  // close to the boundary) — this flags only gross, physically
  // impossible entries, not every minor rounding artifact.
  if (macroSum > 105) flags.push('MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT');

  // Unicode letters are valid names even if the current PT-BR search
  // normalizer cannot index them. Do not classify CJK/other scripts as
  // corrupt merely because they are not ASCII.
  if (entry.name.trim().length < 2 || !/\p{L}/u.test(entry.name)) flags.push('SUSPECT_NAME');

  if (entry.barcode != null && !/^[0-9]{8,14}$/.test(entry.barcode)) flags.push('INVALID_BARCODE_FORMAT');

  if (LOW_KCAL_CATEGORIES.has(entry.category) && n.kcal > 350 && !entry.brand) flags.push('UNUSUAL_KCAL_FOR_CATEGORY');

  return flags;
}

export interface QualityAuditSummary {
  totalAudited: number;
  flaggedCount: number;
  flagCounts: Partial<Record<QualityFlag, number>>;
  flagCountsBySource: Partial<Record<FoodLogSourceType, Partial<Record<QualityFlag, number>>>>;
  severityCounts: Record<QualitySeverity, number>;
  /** Up to 50 `{ id, name, flags }` samples per flag, for manual review — never the whole flagged set (bounded report size). */
  samples: Partial<Record<QualityFlag, { id: string; name: string }[]>>;
}

export function summarizeQualityAudit<TTimestamp>(entries: readonly FoodLogEntry<TTimestamp>[]): QualityAuditSummary {
  const flagCounts: Partial<Record<QualityFlag, number>> = {};
  const samples: Partial<Record<QualityFlag, { id: string; name: string }[]>> = {};
  const flagCountsBySource: Partial<Record<FoodLogSourceType, Partial<Record<QualityFlag, number>>>> = {};
  let flaggedCount = 0;
  const severityCounts: Record<QualitySeverity, number> = { warning: 0, severe: 0 };
  for (const entry of entries) {
    const flags = auditFoodLogEntry(entry);
    if (flags.length > 0) flaggedCount += 1;
    const severities = new Set(flags.map((flag) => QUALITY_FLAG_SEVERITY[flag]));
    for (const severity of severities) severityCounts[severity] += 1;
    for (const flag of flags) {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
      const sourceCounts = flagCountsBySource[entry.source.type] ?? {};
      sourceCounts[flag] = (sourceCounts[flag] ?? 0) + 1;
      flagCountsBySource[entry.source.type] = sourceCounts;
      const bucket = samples[flag] ?? [];
      if (bucket.length < 50) bucket.push({ id: entry.id, name: entry.name });
      samples[flag] = bucket;
    }
  }
  return { totalAudited: entries.length, flaggedCount, flagCounts, flagCountsBySource, severityCounts, samples };
}
