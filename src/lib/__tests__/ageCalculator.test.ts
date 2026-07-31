import { describe, expect, it } from 'vitest';
import { birthDateFromLegacyAge, computeAge } from '../ageCalculator';

describe('computeAge', () => {
  it('is exact on the birthday itself', () => {
    expect(computeAge(new Date(2000, 2, 15), new Date(2024, 2, 15))).toBe(24);
  });

  it('has not incremented yet the day before the birthday', () => {
    expect(computeAge(new Date(2000, 2, 15), new Date(2024, 2, 14))).toBe(23);
  });

  it('increments the day after the birthday', () => {
    expect(computeAge(new Date(2000, 2, 15), new Date(2024, 2, 16))).toBe(24);
  });

  it('handles a birthday earlier in the year than the reference month', () => {
    // Born March 15, reference in December of the same relative year → birthday already happened.
    expect(computeAge(new Date(2000, 2, 15), new Date(2024, 11, 1))).toBe(24);
  });

  it('handles a birthday later in the year than the reference month', () => {
    // Born December 15, reference in March → birthday hasn't happened yet this year.
    expect(computeAge(new Date(2000, 11, 15), new Date(2024, 2, 1))).toBe(23);
  });

  it('handles a leap-day birth date (Feb 29) against a non-leap reference year', () => {
    // Born Feb 29 2000; by Feb 28 2023 (non-leap) the birthday hasn't happened
    // (JS rolls Feb 29 → Mar 1 in a non-leap year, so it's still "in the future").
    expect(computeAge(new Date(2000, 1, 29), new Date(2023, 1, 28))).toBe(22);
    // By March 1 2023 the (rolled-over) birthday has passed.
    expect(computeAge(new Date(2000, 1, 29), new Date(2023, 2, 1))).toBe(23);
  });

  it('defaults the reference date to now when omitted', () => {
    const twentyYearsAgo = new Date();
    twentyYearsAgo.setFullYear(twentyYearsAgo.getFullYear() - 20);
    expect(computeAge(twentyYearsAgo)).toBe(20);
  });

  it('supports retroactive assessments: age at a past measuredAt differs from age today', () => {
    const birthDate = new Date(1995, 5, 10); // 10 Jun 1995
    const today = new Date(2026, 6, 30); // 30 Jul 2026 (matches the app's "currentDate")
    const oneYearAgo = new Date(2025, 6, 30);
    expect(computeAge(birthDate, today)).toBe(31);
    expect(computeAge(birthDate, oneYearAgo)).toBe(30);
  });
});

describe('birthDateFromLegacyAge (backward-compat only)', () => {
  it('round-trips: computeAge(result, referenceDate) === the original legacy age', () => {
    const referenceDate = new Date(2024, 4, 20);
    for (const age of [16, 25, 40, 74]) {
      const derived = birthDateFromLegacyAge(age, referenceDate);
      expect(computeAge(derived, referenceDate)).toBe(age);
    }
  });

  it('the derived age keeps advancing in the years after the reference date (does not freeze)', () => {
    // A legacy questionnaire said "age 28" when created on 2020-01-10.
    const questionnaireCreatedAt = new Date(2020, 0, 10);
    const derivedBirthDate = birthDateFromLegacyAge(28, questionnaireCreatedAt);

    expect(computeAge(derivedBirthDate, questionnaireCreatedAt)).toBe(28);
    // Six years later the derived age must be 34, not still 28 — this is the
    // exact staleness bug this migration exists to fix.
    expect(computeAge(derivedBirthDate, new Date(2026, 0, 10))).toBe(34);
  });
});
