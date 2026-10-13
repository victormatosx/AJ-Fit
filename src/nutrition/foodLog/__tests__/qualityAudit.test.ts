import { describe, expect, it } from 'vitest';
import { auditFoodLogEntry, isSevereQualityFlag, summarizeQualityAudit } from '../qualityAudit';
import type { FoodLogEntry } from '../../../types/nutrition';

function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'flc_taco_x', name: 'Arroz, integral, cozido', aliases: [],
    source: { type: 'taco', sourceId: '1', sourceName: 'TACO' },
    locale: 'pt-BR', category: 'cereal',
    nutritionPer100g: { kcal: 124, proteinG: 2.6, carbsG: 25.8, fatG: 1, fiberG: 2.7 },
    status: 'active', provenance: { license: 'public_domain', attributionRequired: false },
    catalogVersion: 'v1', searchPrefixes: [], createdAt: null, updatedAt: null,
    ...overrides,
  } as FoodLogEntry;
}

describe('auditFoodLogEntry', () => {
  it('flags nothing for a plausible, coherent record', () => {
    expect(auditFoodLogEntry(entry())).toEqual([]);
  });

  it('flags zero kcal despite non-trivial macros', () => {
    const flags = auditFoodLogEntry(entry({ nutritionPer100g: { kcal: 0, proteinG: 10, carbsG: 20, fatG: 5, fiberG: null } }));
    expect(flags).toContain('ZERO_KCAL_WITH_MACROS');
  });

  it('flags a kcal/macro Atwater mismatch beyond tolerance', () => {
    const flags = auditFoodLogEntry(entry({ nutritionPer100g: { kcal: 900, proteinG: 2, carbsG: 2, fatG: 1, fiberG: null } }));
    expect(flags).toContain('KCAL_MACRO_MISMATCH');
  });

  it('does not flag a small, expected Atwater rounding gap', () => {
    // 2.6*4 + 25.8*4 + 1*9 = 123.6, vs kcal 124 — well within tolerance.
    expect(auditFoodLogEntry(entry())).not.toContain('KCAL_MACRO_MISMATCH');
  });

  it('tolerates fibre convention and untracked alcohol/polyol energy as a warning-threshold concern', () => {
    expect(auditFoodLogEntry(entry({ nutritionPer100g: {
      kcal: 260, proteinG: 2, carbsG: 30, fatG: 1, fiberG: 20,
    } }))).not.toContain('KCAL_MACRO_MISMATCH');
  });

  it('classifies mismatch as warning while impossible/negative values are severe', () => {
    expect(isSevereQualityFlag('KCAL_MACRO_MISMATCH')).toBe(false);
    expect(isSevereQualityFlag('ZERO_KCAL_WITH_MACROS')).toBe(true);
    expect(isSevereQualityFlag('MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT')).toBe(true);
  });

  it('flags negative and clearly implausible nutrient values as severe', () => {
    expect(auditFoodLogEntry(entry({ nutritionPer100g: { kcal: 50, proteinG: -1, carbsG: 2, fatG: 1, fiberG: null } })))
      .toContain('NEGATIVE_NUTRIENT_VALUE');
    expect(auditFoodLogEntry(entry({ nutritionPer100g: { kcal: 1_200, proteinG: 2, carbsG: 2, fatG: 1, fiberG: null } })))
      .toContain('IMPLAUSIBLE_NUTRIENT_VALUE');
  });

  it('flags macro sum exceeding the physical 100g/100g limit', () => {
    const flags = auditFoodLogEntry(entry({ nutritionPer100g: { kcal: 500, proteinG: 60, carbsG: 60, fatG: 20, fiberG: null } }));
    expect(flags).toContain('MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT');
  });

  it('flags a suspect (unusable) name', () => {
    expect(auditFoodLogEntry(entry({ name: '...---' }))).toContain('SUSPECT_NAME');
    expect(auditFoodLogEntry(entry({ name: '1234' }))).toContain('SUSPECT_NAME');
  });

  it('does not treat a real Unicode-script name as corrupt', () => {
    expect(auditFoodLogEntry(entry({ name: '龙口粉丝' }))).not.toContain('SUSPECT_NAME');
  });

  it('flags an invalid barcode format', () => {
    expect(auditFoodLogEntry(entry({ barcode: 'abc' }))).toContain('INVALID_BARCODE_FORMAT');
  });

  it('flags an unusually high-kcal generic fruit/vegetable (non-branded)', () => {
    const flags = auditFoodLogEntry(entry({ category: 'fruit', name: 'Banana, crua',
      nutritionPer100g: { kcal: 400, proteinG: 1, carbsG: 95, fatG: 1, fiberG: null } }));
    expect(flags).toContain('UNUSUAL_KCAL_FOR_CATEGORY');
  });

  it('does not flag a high-kcal BRANDED fruit-category snack (e.g. dried/candied fruit)', () => {
    const flags = auditFoodLogEntry(entry({ category: 'fruit', name: 'Banana, doce em barra', brand: { name: 'Marca X' },
      nutritionPer100g: { kcal: 400, proteinG: 1, carbsG: 95, fatG: 1, fiberG: null } }));
    expect(flags).not.toContain('UNUSUAL_KCAL_FOR_CATEGORY');
  });
});

describe('summarizeQualityAudit', () => {
  it('counts flagged entries and buckets samples by flag, never mutating input', () => {
    const entries = [entry(), entry({ id: 'bad1', barcode: 'xx' }), entry({ id: 'bad2', barcode: 'yy' })];
    const snapshotBefore = JSON.stringify(entries);
    const summary = summarizeQualityAudit(entries);
    expect(summary.totalAudited).toBe(3);
    expect(summary.flaggedCount).toBe(2);
    expect(summary.flagCounts.INVALID_BARCODE_FORMAT).toBe(2);
    expect(summary.severityCounts.warning).toBe(2);
    expect(summary.severityCounts.severe).toBe(0);
    expect(summary.samples.INVALID_BARCODE_FORMAT?.map((item) => item.id).sort()).toEqual(['bad1', 'bad2']);
    expect(JSON.stringify(entries)).toBe(snapshotBefore);
  });
});
