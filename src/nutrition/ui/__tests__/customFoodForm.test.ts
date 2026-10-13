import { describe, expect, it } from 'vitest';
import { parseNonNegativeNumber, validateCustomFoodForm } from '../customFoodForm';

describe('parseNonNegativeNumber', () => {
  it('accepts both decimal separators', () => {
    expect(parseNonNegativeNumber('12.5')).toBe(12.5);
    expect(parseNonNegativeNumber('12,5')).toBe(12.5);
  });

  it('treats empty/whitespace as "not provided", not zero', () => {
    expect(parseNonNegativeNumber('')).toBeNull();
    expect(parseNonNegativeNumber('   ')).toBeNull();
  });

  it('rejects negative, non-finite and non-numeric input', () => {
    expect(parseNonNegativeNumber('-1')).toBeNull();
    expect(parseNonNegativeNumber('abc')).toBeNull();
    expect(parseNonNegativeNumber('Infinity')).toBeNull();
  });

  it('accepts zero', () => {
    expect(parseNonNegativeNumber('0')).toBe(0);
  });
});

describe('validateCustomFoodForm', () => {
  const valid = { name: 'Tapioca', kcal: '120', protein: '0.5', carbs: '30', fat: '0', fiber: '' };

  it('accepts a valid form with fiber omitted', () => {
    const result = validateCustomFoodForm(valid);
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({ kcal: 120, proteinG: 0.5, carbsG: 30, fatG: 0 });
  });

  it('includes fiber only when provided', () => {
    const result = validateCustomFoodForm({ ...valid, fiber: '2' });
    expect(result.valid).toBe(true);
    expect(result.values?.fiberG).toBe(2);
  });

  it('flags an empty name', () => {
    const result = validateCustomFoodForm({ ...valid, name: '  ' });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBe(true);
  });

  it('flags negative or non-numeric macro fields individually', () => {
    const result = validateCustomFoodForm({ ...valid, kcal: '-5', protein: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors.kcal).toBe(true);
    expect(result.errors.protein).toBe(true);
    expect(result.errors.carbs).toBeFalsy();
  });

  it('flags a provided-but-invalid fiber without requiring fiber at all', () => {
    const result = validateCustomFoodForm({ ...valid, fiber: '-1' });
    expect(result.valid).toBe(false);
    expect(result.errors.fiber).toBe(true);
  });

  it('never returns values when invalid', () => {
    const result = validateCustomFoodForm({ ...valid, name: '' });
    expect(result.values).toBeUndefined();
  });
});
