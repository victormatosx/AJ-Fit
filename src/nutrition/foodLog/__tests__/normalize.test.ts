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
  it('fills in a reviewed-generic serving unit for a TACO staple with no provider-declared serving (Fase C6)', () => {
    const food = normalizeFoodLogRecord(rawTaco(), 'v1'); // name: "Arroz, integral, cru"
    expect(food.servings).toEqual([
      { id: 'colher-servir', label: '1 colher de servir (60 g)', quantity: 1, gramEquivalent: 60, provenance: 'reviewed_generic' },
      { id: 'xicara', label: '1 xícara (150 g)', quantity: 1, gramEquivalent: 150, provenance: 'reviewed_generic' },
    ]);
    expect(food.defaultServingId).toBe('colher-servir');
  });
  it('ovo normalizes with the reviewed-generic "1 unidade (50 g)" serving (Fase C7)', () => {
    const rawOvo: RawFoodLogRecord = { ...rawTaco(), name: 'Ovo, de galinha, inteiro, cru' };
    const food = normalizeFoodLogRecord(rawOvo, 'v1');
    expect(food.servings).toEqual([{ id: 'unidade', label: '1 unidade (50 g)', quantity: 1, gramEquivalent: 50, provenance: 'reviewed_generic' }]);
    expect(food.defaultServingId).toBe('unidade');
  });

  it('fruta (maçã) normalizes with the reviewed-generic "1 unidade" serving (Fase C7)', () => {
    const rawMaca: RawFoodLogRecord = { ...rawTaco(), name: 'Maçã, Fuji, com casca, crua' };
    const food = normalizeFoodLogRecord(rawMaca, 'v1');
    expect(food.servings).toEqual([{ id: 'unidade', label: '1 unidade (130 g)', quantity: 1, gramEquivalent: 130, provenance: 'reviewed_generic' }]);
  });

  it('mussarela normalizes with the reviewed-generic "1 fatia (30 g)" serving (Fase C7)', () => {
    const rawMussarela: RawFoodLogRecord = { ...rawTaco(), name: 'Queijo, mussarela' };
    const food = normalizeFoodLogRecord(rawMussarela, 'v1');
    expect(food.servings).toEqual([{ id: 'fatia', label: '1 fatia (30 g)', quantity: 1, gramEquivalent: 30, provenance: 'reviewed_generic' }]);
  });

  it('dry-run false-positive #1: "Banana, maçã, crua" normalizes with the banana unit (90 g), never maçã\'s (130 g)', () => {
    const rawBananaMaca: RawFoodLogRecord = { ...rawTaco(), name: 'Banana, maçã, crua' };
    const food = normalizeFoodLogRecord(rawBananaMaca, 'v1');
    expect(food.servings).toEqual([{ id: 'unidade', label: '1 unidade (90 g)', quantity: 1, gramEquivalent: 90, provenance: 'reviewed_generic' }]);
  });

  it('dry-run false-positive #2: "Pão, de queijo, assado" normalizes with NO generic serving at all', () => {
    const rawPaoDeQueijo: RawFoodLogRecord = { ...rawTaco(), name: 'Pão, de queijo, assado' };
    const food = normalizeFoodLogRecord(rawPaoDeQueijo, 'v1');
    expect(food.servings).toBeUndefined();
    expect(food.defaultServingId).toBeUndefined();
  });

  it('never attaches a reviewed-generic serving to a branded/provider source with no official one (OFF, no serving_quantity)', () => {
    const food = normalizeFoodLogRecord(rawOff(), 'v1');
    expect(food.servings).toBeUndefined();
    expect(food.defaultServingId).toBeUndefined();
  });
  it('passes through a provider-declared serving as-is, preferring it over the reviewed-generic table', () => {
    const withServing: RawFoodLogRecord = { ...rawTaco(), servings: [{ id: 'xicara', label: '1 xícara (150 g)', quantity: 1, gramEquivalent: 150, provenance: 'provider_official' }] };
    const food = normalizeFoodLogRecord(withServing, 'v1');
    expect(food.servings).toEqual([{ id: 'xicara', label: '1 xícara (150 g)', quantity: 1, gramEquivalent: 150, provenance: 'provider_official' }]);
    expect(food.defaultServingId).toBe('xicara');
  });
  it('rejects a malformed serving unit rather than persisting it', () => {
    const bad: RawFoodLogRecord = { ...rawTaco(), servings: [{ id: 'bad id!', label: 'x', quantity: 1, provenance: 'provider_official' }] };
    expect(() => normalizeFoodLogRecord(bad, 'v1')).toThrow('INVALID_SERVING_UNITS');
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
