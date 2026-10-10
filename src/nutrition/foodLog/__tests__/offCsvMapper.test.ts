import { describe, expect, it } from 'vitest';
import { isBrazilOffProduct, offCsvRowToProduct, parseOffCsvHeader } from '../offCsvMapper';
import { evaluateOffProductQuality, offNutrientValue } from '../offQualityFilter';

const header = [
  'code', 'product_name', 'brands', 'categories_tags', 'countries_tags',
  'energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'proteins_100g',
  'carbohydrates_100g', 'fat_100g', 'fiber_100g',
].join('\t');

describe('OFF official CSV mapper', () => {
  it('maps the tab-separated export into the shared RawOffProduct quality path', () => {
    const product = offCsvRowToProduct([
      '7891000412855', 'Achocolatado', 'Nestlé', 'en:beverages', 'en:brazil,en:portugal',
      '86', '', '', '3.5', '13', '2.1', '0.4',
    ].join('\t'), parseOffCsvHeader(header));
    expect(isBrazilOffProduct(product)).toBe(true);
    expect(evaluateOffProductQuality(product)).toEqual({ ok: true });
  });

  it('derives kcal from the export energy kJ field when the kcal column is absent', () => {
    const product = offCsvRowToProduct([
      '7891000412855', 'Produto', 'Marca', '', 'en:brazil', '', '418.4', '', '3', '10', '5', '',
    ].join('\t'), parseOffCsvHeader(header));
    expect(offNutrientValue(product.nutriments, 'energy-kcal_100g')).toBeCloseTo(100);
    expect(evaluateOffProductQuality(product)).toEqual({ ok: true });
  });

  it('fails closed when the upstream export loses a required column', () => {
    expect(() => parseOffCsvHeader('code\tproduct_name')).toThrow('OFF_CSV_MISSING_COLUMNS');
  });

  it('reads serving_size/serving_quantity when the export provides them (Fase C6, optional columns)', () => {
    const headerWithServing = `${header}\tserving_size\tserving_quantity`;
    const product = offCsvRowToProduct([
      '7891000412855', 'Achocolatado', 'Nestlé', 'en:beverages', 'en:brazil',
      '86', '', '', '3.5', '13', '2.1', '0.4', '30 g', '30',
    ].join('\t'), parseOffCsvHeader(headerWithServing));
    expect(product.serving_size).toBe('30 g');
    expect(product.serving_quantity).toBe('30');
  });

  it('omits serving_size/serving_quantity when the export (or an older fixture) lacks those columns', () => {
    const product = offCsvRowToProduct([
      '7891000412855', 'Achocolatado', 'Nestlé', 'en:beverages', 'en:brazil',
      '86', '', '', '3.5', '13', '2.1', '0.4',
    ].join('\t'), parseOffCsvHeader(header));
    expect(product.serving_size).toBeUndefined();
    expect(product.serving_quantity).toBeUndefined();
  });
});
