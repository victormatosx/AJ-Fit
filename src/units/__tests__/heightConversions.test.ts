import { describe, expect, it } from 'vitest';
import { computeBmi } from '../../lib/skinfoldCalculator';
import {
  cmToFeetInches,
  cmToSelectableFeetInches,
  feetInchesToCm,
  formatHeightFromCm,
  isValidImperialHeight,
  selectableFeet,
  selectableInchesForFeet,
} from '../heightConversions';

describe('height conversions', () => {
  it('displays 178 cm as 5 ft 10 in', () => {
    expect(cmToFeetInches(178)).toEqual({ feet: 5, inches: 10 });
    expect(formatHeightFromCm(178, 'imperial')).toBe('5 ft 10 in');
  });

  it('converts a 5 ft 10 in input to cm exactly once', () => {
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 10);
  });

  it('keeps metric display in the persisted cm domain', () => {
    expect(formatHeightFromCm(178, 'metric')).toBe('178');
  });

  it('derives selectable imperial limits from 140–220 cm', () => {
    expect(selectableFeet(140, 220)).toEqual([4, 5, 6, 7]);
    expect(selectableInchesForFeet(4, 140, 220)).toEqual([8, 9, 10, 11]);
    expect(selectableInchesForFeet(5, 140, 220)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(selectableInchesForFeet(7, 140, 220)).toEqual([0, 1, 2]);
    expect(cmToSelectableFeetInches(140, 140, 220)).toEqual({ feet: 4, inches: 8 });
    expect(cmToSelectableFeetInches(220, 140, 220)).toEqual({ feet: 7, inches: 2 });
  });

  it('accepts only whole feet/inches and inches from 0 through 11', () => {
    expect(isValidImperialHeight(5, 10, 140, 220)).toBe(true);
    expect(isValidImperialHeight(5, 12, 140, 220)).toBe(false);
    expect(isValidImperialHeight(4, 7, 140, 220)).toBe(false);
    expect(isValidImperialHeight(7, 3, 140, 220)).toBe(false);
  });

  it('does not change BMI merely by resolving an imperial display', () => {
    const persistedHeightCm = 178;
    const before = computeBmi(81.65, persistedHeightCm);
    cmToFeetInches(persistedHeightCm);
    const after = computeBmi(81.65, persistedHeightCm);
    expect(after).toBe(before);
  });
});
