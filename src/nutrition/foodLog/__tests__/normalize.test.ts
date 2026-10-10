import { describe, expect, it } from 'vitest';
import { foodLogId, normalizeBarcode, normalizeFoodLogRecord, type RawFoodLogRecord } from '../normalize';

const rawTaco = (): RawFoodLogRecord => ({
  source: { type: 'taco', sourceId: '1', sourceName: 'TACO', sourceVersion: '4a-edicao-2011' },
  name: 'Arroz, integral, cru', category: 'cereal',
  nutritionPer100g: { kcal: 360, proteinG: 7.3, carbsG: 77.5, fatG: 1.9, fiberG: 4.8 },
  locale: 'pt-BR', status: 'active',
  provenance: { license: 'public_domain', attributionRequired: false },
});

const rawOff = (): RawFoodLogRecord => ({
  source: { type: 'off', sourceId: '7891000412855', sourceName: 'Open Food Facts', sourceVersion: 'food-log-off-brazil-v1' },
  name: 'Achocolatado em po', brand: { name: 'Nestle' }, barcode: '7891000412855',
  category: 'beverage', nutritionPer100g: { kcal: 86, proteinG: 3.5, carbsG: 13, fatG: 2.1, fiberG: 0.4 },
  locale: 'pt-BR', status: 'active',
  provenance: { license: 'odbl_share_alike', attributionRequired: true, attributionText: 'Open Food Facts, ODbL' },
});

describe('foodLogId', () => {
  it('is deterministic for the same source+sourceId, distinct across types and across source ids', () => {
    expect(foodLogId('taco', '1')).toBe(foodLogId('taco', '1'));
    expect(foodLogId('taco', '1')).not.toBe(foodLogId('off', '1'));
    expect(foodLogId('taco', '1')).not.toBe(foodLogId('taco', '2'));
    expect(foodLogId('taco', '1')).toMatch(/^flc_taco_/);
  });
  it('rejects unknown source types and empty/oversized source ids', () => {
    expect(() => foodLogId('unknown' as never, '1')).toThrow();
    expect(() => foodLogId('taco', '')).toThrow();
    expect(() => foodLogId('taco', 'x'.repeat(201))).toThrow();
  });
});

describe('normalizeBarcode', () => {
  it('keeps digits-only barcodes within 8-14 length, drops the rest', () => {
    expect(normalizeBarcode('7891000412855')).toBe('7891000412855');
    expect(normalizeBarcode(' 789-100-041-2855 ')).toBe('7891000412855');
    expect(normalizeBarcode('123')).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
    expect(normalizeBarcode(undefined)).toBeNull();
  });
});

describe('normalizeFoodLogRecord', () => {
  it('normalizes a TACO record with no generationStatus/allergens/dietaryFlags concept at all', () => {
    const food = normalizeFoodLogRecord(rawTaco(), 'food-log-taco-4a-edicao-2011-v1');
    expect(food.id).toBe(foodLogId('taco', '1'));
    expect(food.status).toBe('active');
    expect(food.nutritionPer100g).toEqual({ kcal: 360, proteinG: 7.3, carbsG: 77.5, fatG: 1.9, fiberG: 4.8 });
    expect(food.provenance).toEqual({ license: 'public_domain', attributionRequired: false });
    expect('generationStatus' in food).toBe(false);
    expect('allergens' in food).toBe(false);
  });
  it('normalizes an Open Food Facts record with brand + barcode', () => {
    const food = normalizeFoodLogRecord(rawOff(), 'food-log-off-brazil-v1');
    expect(food.id).toBe(foodLogId('off', '7891000412855'));
    expect(food.brand).toEqual({ name: 'Nestle' });
    expect(food.barcode).toBe('7891000412855');
    expect(food.provenance.license).toBe('odbl_share_alike');
  });
  it('requires attributionText when attributionRequired is true', () => {
    const bad = { ...rawOff(), provenance: { license: 'odbl_share_alike' as const, attributionRequired: true } };
    expect(() => normalizeFoodLogRecord(bad, 'v1')).toThrow('ATTRIBUTION_TEXT_REQUIRED');
  });
  it('rejects implausible per-100g macros (unit-conversion-bug guard)', () => {
    const tooHot = { ...rawTaco(), nutritionPer100g: { kcal: 950, proteinG: 7, carbsG: 77, fatG: 1, fiberG: null } };
    expect(() => normalizeFoodLogRecord(tooHot, 'v1')).toThrow('IMPLAUSIBLE_NUTRITION_VALUES');
    const tooMuchProtein = { ...rawTaco(), nutritionPer100g: { kcal: 300, proteinG: 150, carbsG: 10, fatG: 1, fiberG: null } };
    expect(() => normalizeFoodLogRecord(tooMuchProtein, 'v1')).toThrow('IMPLAUSIBLE_NUTRITION_VALUES');
  });
  it('rejects unknown source types and invalid catalog versions', () => {
    expect(() => normalizeFoodLogRecord({ ...rawTaco(), source: { ...rawTaco().source, type: 'fatsecret-v2' } }, 'v1')).toThrow('INVALID_FOOD_SOURCE');
    expect(() => normalizeFoodLogRecord(rawTaco(), 'bad version!')).toThrow('INVALID_CATALOG_VERSION');
  });
  it('defaults locale to pt-BR when absent', () => {
    const { locale, ...withoutLocale } = rawTaco();
    const food = normalizeFoodLogRecord(withoutLocale, 'v1');
    expect(food.locale).toBe('pt-BR');
  });
});
