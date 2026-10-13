import { describe, expect, it } from 'vitest';
import { classifyFoodLogSubCategory } from '../subCategory';

describe('classifyFoodLogSubCategory', () => {
  it('classifies meats/fish/eggs by keyword, independent of the generation category', () => {
    expect(classifyFoodLogSubCategory('Frango, peito, sem pele, cru', 'protein_source', false)).toBe('poultry');
    expect(classifyFoodLogSubCategory('Carne, bovina, acém, cru', 'protein_source', false)).toBe('beef');
    expect(classifyFoodLogSubCategory('Lombo suíno', 'protein_source', false)).toBe('pork');
    expect(classifyFoodLogSubCategory('Tilápia, filé, crua', 'protein_source', false)).toBe('fish');
    expect(classifyFoodLogSubCategory('Ovo, de galinha, cru', 'protein_source', false)).toBe('eggs');
  });

  it('classifies dairy/grains/legumes/fruits/vegetables', () => {
    expect(classifyFoodLogSubCategory('Queijo, minas, frescal', 'dairy', false)).toBe('dairy');
    expect(classifyFoodLogSubCategory('Arroz, integral, cru', 'cereal', false)).toBe('grains');
    expect(classifyFoodLogSubCategory('Feijão, carioca, cru', 'legume', false)).toBe('legumes');
    expect(classifyFoodLogSubCategory('Banana, nanica, crua', 'fruit', false)).toBe('fruits');
    expect(classifyFoodLogSubCategory('Tomate, cru', 'vegetable', false)).toBe('vegetables');
    expect(classifyFoodLogSubCategory('Aveia em flocos', 'cereal', false)).toBe('grains');
  });

  it('uses token boundaries so incidental substrings do not misclassify branded names', () => {
    expect(classifyFoodLogSubCategory('Sorvete Ovomaltine', 'other', true)).toBe('branded_product');
    expect(classifyFoodLogSubCategory('Produto peruano', 'other', true)).toBe('branded_product');
  });

  it('classifies supplements/beverages/snacks/prepared_food', () => {
    expect(classifyFoodLogSubCategory('Whey Protein Concentrado', 'supplement', true)).toBe('supplements');
    expect(classifyFoodLogSubCategory('Refrigerante, tipo cola', 'beverage', false)).toBe('beverages');
    expect(classifyFoodLogSubCategory('Chocolate ao leite', 'other', true)).toBe('snacks');
    expect(classifyFoodLogSubCategory('Lasanha, massa fresca, cozida', 'other', false)).toBe('prepared_food');
  });

  it('falls back to branded_product for an unrecognized branded item, else the category default', () => {
    expect(classifyFoodLogSubCategory('XYZ Produto Qualquer', 'other', true)).toBe('branded_product');
    expect(classifyFoodLogSubCategory('XYZ Produto Qualquer', 'other', false)).toBe('other');
    expect(classifyFoodLogSubCategory('Alimento sem nome reconhecivel', 'dairy', false)).toBe('dairy');
  });
});
