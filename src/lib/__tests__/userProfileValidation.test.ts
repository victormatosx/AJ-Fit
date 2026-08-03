import { describe, expect, it } from 'vitest';
import {
  normalizeDisplayName,
  validateDisplayName,
  validateProfileBirthDate,
} from '../userProfileValidation';

function yearsAgo(years: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

describe('user profile validation', () => {
  it('normalizes surrounding and repeated whitespace in names', () => {
    expect(normalizeDisplayName('  Ana   Maria  ')).toBe('Ana Maria');
  });

  it('rejects empty and one-character display names', () => {
    expect(validateDisplayName('   ')).toBeTruthy();
    expect(validateDisplayName('A')).toBeTruthy();
    expect(validateDisplayName('Ana')).toBeNull();
  });

  it('accepts birth dates inside the supported age range', () => {
    expect(validateProfileBirthDate(yearsAgo(30))).toBeNull();
  });

  it('rejects future and out-of-range birth dates', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    expect(validateProfileBirthDate(future)).toBeTruthy();
    expect(validateProfileBirthDate(yearsAgo(15))).toBeTruthy();
    expect(validateProfileBirthDate(yearsAgo(76))).toBeTruthy();
  });
});
