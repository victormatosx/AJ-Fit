import { describe, expect, it } from 'vitest';
import { evaluateOffProductQuality, firstOffBrand, offNutrientValue, type RawOffProduct } from '../offQualityFilter';

const valid = (): RawOffProduct => ({
  code: '7891000412855', product_name: 'Achocolatado em po', brands: 'Nestle, Nestle Brasil',
  countries_tags: ['en:brazil'], lang: 'pt',
  nutriments: { 'energy-kcal_100g': 86, proteins_100g: 3.5, carbohydrates_100g: 13, fat_100g: 2.1, fiber_100g: 0.4 },
});

describe('evaluateOffProductQuality', () => {
  it('accepts a complete, plausible Brazil product', () => {
    expect(evaluateOffProductQuality(valid())).toEqual({ ok: true });
  });
  it('rejects missing/invalid barcode', () => {
    expect(evaluateOffProductQuality({ ...valid(), code: undefined })).toMatchObject({ ok: false, reason: 'MISSING_OR_INVALID_BARCODE' });
    expect(evaluateOffProductQuality({ ...valid(), code: 'abc' })).toMatchObject({ ok: false, reason: 'MISSING_OR_INVALID_BARCODE' });
  });
  it('rejects missing/empty/punctuation-only name', () => {
    expect(evaluateOffProductQuality({ ...valid(), product_name: '' })).toMatchObject({ ok: false, reason: 'MISSING_OR_INVALID_NAME' });
    expect(evaluateOffProductQuality({ ...valid(), product_name: '   ' })).toMatchObject({ ok: false, reason: 'MISSING_OR_INVALID_NAME' });
    expect(evaluateOffProductQuality({ ...valid(), product_name: '...---' })).toMatchObject({ ok: false, reason: 'NAME_HAS_NO_LETTERS' });
  });
  it('rejects incomplete macros', () => {
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { 'energy-kcal_100g': 86 } })).toMatchObject({ ok: false, reason: 'INCOMPLETE_MACROS' });
  });
  it('rejects negative and implausible nutrient values', () => {
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { ...valid().nutriments, proteins_100g: -1 } }))
      .toMatchObject({ ok: false, reason: 'NEGATIVE_NUTRIENT_VALUE' });
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { ...valid().nutriments, 'energy-kcal_100g': 950 } }))
      .toMatchObject({ ok: false, reason: 'IMPLAUSIBLE_NUTRIENT_VALUE' });
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { ...valid().nutriments, carbohydrates_100g: 150 } }))
      .toMatchObject({ ok: false, reason: 'IMPLAUSIBLE_NUTRIENT_VALUE' });
  });
  it('rejects zero declared kcal when material macros are present', () => {
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { ...valid().nutriments, 'energy-kcal_100g': 0 } }))
      .toMatchObject({ ok: false, reason: 'ZERO_KCAL_WITH_MACROS' });
  });
  it('rejects a physically impossible sum of protein, carbs and fat', () => {
    expect(evaluateOffProductQuality({ ...valid(), nutriments: {
      ...valid().nutriments, proteins_100g: 60, carbohydrates_100g: 40, fat_100g: 10,
    } })).toMatchObject({ ok: false, reason: 'MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT' });
  });
  it('rejects implausible fiber specifically, keeps absent fiber valid', () => {
    expect(evaluateOffProductQuality({ ...valid(), nutriments: { ...valid().nutriments, fiber_100g: 150 } }))
      .toMatchObject({ ok: false, reason: 'IMPLAUSIBLE_FIBER_VALUE' });
    const { fiber_100g: _omit, ...withoutFiber } = valid().nutriments!;
    expect(evaluateOffProductQuality({ ...valid(), nutriments: withoutFiber })).toEqual({ ok: true });
  });
  it('rejects products explicitly tagged for a non-Brazil market only', () => {
    expect(evaluateOffProductQuality({ ...valid(), countries_tags: ['en:france'] })).toMatchObject({ ok: false, reason: 'NOT_BRAZIL_MARKET' });
  });
  it('accepts when countries_tags is absent (fetch already filtered by country)', () => {
    expect(evaluateOffProductQuality({ ...valid(), countries_tags: undefined })).toEqual({ ok: true });
  });
});

describe('offNutrientValue', () => {
  it('parses numeric and numeric-string values, rejects non-finite', () => {
    expect(offNutrientValue({ a: 5 }, 'a')).toBe(5);
    expect(offNutrientValue({ a: '5.5' }, 'a')).toBe(5.5);
    expect(offNutrientValue({ a: 'not-a-number' }, 'a')).toBeNull();
    expect(offNutrientValue(undefined, 'a')).toBeNull();
  });
});

describe('firstOffBrand', () => {
  it('takes only the first comma-separated brand', () => {
    expect(firstOffBrand('Nestle, Nestle Brasil')).toBe('Nestle');
    expect(firstOffBrand(undefined)).toBeNull();
    expect(firstOffBrand('   ')).toBeNull();
  });
});
