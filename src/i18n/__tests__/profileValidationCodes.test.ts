import { describe, it, expect } from 'vitest';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  PROFILE_MAX_AGE,
  PROFILE_MIN_AGE,
  normalizeDisplayName,
  validateDisplayName,
  validateProfileBirthDate,
} from '../../lib/userProfileValidation';

function yearsAgo(years: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

/**
 * Phase 6 REGRESSION GUARD for the validation layer.
 *
 * These tests lock the code contract between the pure validators (locale-
 * free) and the profile.json translations. Renaming or adding a code here
 * requires a matching change in both:
 *   - src/lib/userProfileValidation.ts
 *   - every locale profile.json under edit.validation
 *
 * The existing userProfileValidation.test.ts covers truthiness of the
 * validators; this file adds the shape assertions the UI relies on.
 */

describe('validateDisplayName — returns tagged codes', () => {
  it('empty and whitespace-only names → { code: "nameRequired" }', () => {
    expect(validateDisplayName('')).toEqual({ code: 'nameRequired' });
    expect(validateDisplayName('   ')).toEqual({ code: 'nameRequired' });
  });

  it('names shorter than DISPLAY_NAME_MIN_LENGTH → nameTooShort with min param', () => {
    expect(validateDisplayName('A')).toEqual({
      code: 'nameTooShort',
      params: { min: DISPLAY_NAME_MIN_LENGTH },
    });
  });

  it('names longer than DISPLAY_NAME_MAX_LENGTH → nameTooLong with max param', () => {
    const overLimit = 'A'.repeat(DISPLAY_NAME_MAX_LENGTH + 5);
    expect(validateDisplayName(overLimit)).toEqual({
      code: 'nameTooLong',
      params: { max: DISPLAY_NAME_MAX_LENGTH },
    });
  });

  it('normalized valid names → null (no error)', () => {
    expect(validateDisplayName('Ana')).toBeNull();
    expect(validateDisplayName('  Ana  Maria  ')).toBeNull();
    expect(normalizeDisplayName('  Ana  Maria  ')).toBe('Ana Maria');
  });
});

describe('validateProfileBirthDate — returns tagged codes', () => {
  it('null → { code: "birthDateRequired" }', () => {
    expect(validateProfileBirthDate(null)).toEqual({ code: 'birthDateRequired' });
  });

  it('future dates → { code: "birthDateFuture" }', () => {
    const future = new Date();
    future.setDate(future.getDate() + 1);
    expect(validateProfileBirthDate(future)).toEqual({ code: 'birthDateFuture' });
  });

  it('below-minimum age → birthDateAgeRange with min/max params', () => {
    expect(validateProfileBirthDate(yearsAgo(PROFILE_MIN_AGE - 1))).toEqual({
      code: 'birthDateAgeRange',
      params: { min: PROFILE_MIN_AGE, max: PROFILE_MAX_AGE },
    });
  });

  it('above-maximum age → birthDateAgeRange with min/max params', () => {
    expect(validateProfileBirthDate(yearsAgo(PROFILE_MAX_AGE + 1))).toEqual({
      code: 'birthDateAgeRange',
      params: { min: PROFILE_MIN_AGE, max: PROFILE_MAX_AGE },
    });
  });

  it('in-range date → null (no error)', () => {
    expect(validateProfileBirthDate(yearsAgo(30))).toBeNull();
  });
});

describe('validator codes match profile.json keys', () => {
  // Guards the invariant that every code the validators produce has a
  // matching translation key. Missing keys would fall through to i18next's
  // last-resort fallback (raw key string), visible to users.
  const REQUIRED_KEYS = [
    'edit.validation.nameRequired',
    'edit.validation.nameTooShort',
    'edit.validation.nameTooLong',
    'edit.validation.birthDateRequired',
    'edit.validation.birthDateFuture',
    'edit.validation.birthDateAgeRange',
  ];

  it.each(['pt-BR', 'en', 'es'] as const)('%s exposes every validation key', async (loc) => {
    const json = (await import(`../resources/${loc}/profile.json`)).default as Record<
      string,
      unknown
    >;
    const edit = json.edit as Record<string, unknown>;
    const validation = edit.validation as Record<string, string>;
    for (const key of REQUIRED_KEYS) {
      const leaf = key.split('.').pop()!;
      expect(validation[leaf], `[${loc}] missing profile:${key}`).toBeTruthy();
      expect(typeof validation[leaf]).toBe('string');
    }
  });
});
