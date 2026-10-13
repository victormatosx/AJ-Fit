import { describe, expect, it } from 'vitest';
import { formatFoodDisplayName } from '../formatFoodDisplayName';

describe('formatFoodDisplayName', () => {
  it('reorders poultry cuts', () => {
    expect(formatFoodDisplayName('Frango, peito, sem pele, cozido')).toBe('Peito de frango sem pele cozido');
    expect(formatFoodDisplayName('Frango, coxa, com pele, assada')).toBe('Coxa de frango com pele assada');
  });

  it('reorders bovine cuts', () => {
    expect(formatFoodDisplayName('Carne, bovina, patinho, sem gordura, grelhado')).toBe('Patinho bovino sem gordura grelhado');
    expect(formatFoodDisplayName('Carne, bovina, acém, sem gordura, cozido')).toBe('Acém bovino sem gordura cozido');
  });

  it('reorders suine cuts', () => {
    expect(formatFoodDisplayName('Carne, suína, lombo, sem gordura, assado')).toBe('Lombo suíno sem gordura assado');
  });

  it('reorders fish fillets', () => {
    expect(formatFoodDisplayName('Peixe, tilápia, filé, grelhado')).toBe('Filé de tilápia grelhado');
  });

  it('falls back to species name for fish without a fillet cut', () => {
    expect(formatFoodDisplayName('Peixe, tilápia, grelhada')).toBe('Tilápia grelhada');
  });

  it('just strips commas for cereals/legumes/eggs', () => {
    expect(formatFoodDisplayName('Arroz, integral, cozido')).toBe('Arroz integral cozido');
    expect(formatFoodDisplayName('Feijão, carioca, cozido')).toBe('Feijão carioca cozido');
    expect(formatFoodDisplayName('Ovo, de galinha, inteiro, cozido')).toBe('Ovo de galinha inteiro cozido');
  });

  it('leaves names with no commas untouched', () => {
    expect(formatFoodDisplayName('Tapioca')).toBe('Tapioca');
    expect(formatFoodDisplayName('Água de coco')).toBe('Água de coco');
  });

  it('is conservative with branded/Open Food Facts names', () => {
    expect(formatFoodDisplayName('Nescau, Chocolate em pó, 400g', { name: 'Nestlé' }))
      .toBe('Nescau, Chocolate em pó, 400g');
    expect(formatFoodDisplayName('Leite Condensado Moça 395g', { name: 'Nestlé', productName: 'Moça' }))
      .toBe('Leite Condensado Moça 395g');
  });

  it('does not invent structure for unknown/weird technical chains', () => {
    expect(formatFoodDisplayName('Suplemento, whey protein, sabor chocolate'))
      .toBe('Suplemento whey protein sabor chocolate');
  });

  it('handles empty/whitespace-only input', () => {
    expect(formatFoodDisplayName('')).toBe('');
    expect(formatFoodDisplayName('   ')).toBe('');
  });
});
