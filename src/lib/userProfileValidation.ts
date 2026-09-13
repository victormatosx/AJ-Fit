import { computeAge } from './ageCalculator';
import { isFutureDate } from './dateUtils';

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const PROFILE_MIN_AGE = 18;
export const PROFILE_MAX_AGE = 75;
// Matches the onboarding height wheel's range (src/onboarding/questionDefs.ts).
export const PROFILE_MIN_HEIGHT_CM = 140;
export const PROFILE_MAX_HEIGHT_CM = 220;

/**
 * Validators return a structured code (never a localized string). The UI
 * translates the code via `t('profile:edit.validation.<code>', params)`;
 * the service layer (`userProfile.ts::updateUserProfile`) rethrows the code
 * as an Error message so the caller can display a generic fallback. Keeping
 * the validation layer locale-free lets it stay testable without loading
 * i18next and prevents Portuguese strings from ever reaching the wire.
 */
export type DisplayNameError =
  | { code: 'nameRequired' }
  | { code: 'nameTooShort'; params: { min: number } }
  | { code: 'nameTooLong'; params: { max: number } };

export type BirthDateError =
  | { code: 'birthDateRequired' }
  | { code: 'birthDateFuture' }
  | { code: 'birthDateAgeRange'; params: { min: number; max: number } };

export type HeightError =
  | { code: 'heightRequired' }
  | { code: 'heightRange'; params: { min: number; max: number } };

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateDisplayName(value: string): DisplayNameError | null {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return { code: 'nameRequired' };
  if (normalized.length < DISPLAY_NAME_MIN_LENGTH) {
    return { code: 'nameTooShort', params: { min: DISPLAY_NAME_MIN_LENGTH } };
  }
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    return { code: 'nameTooLong', params: { max: DISPLAY_NAME_MAX_LENGTH } };
  }
  return null;
}

export function validateProfileHeight(cm: number | null): HeightError | null {
  if (cm == null || Number.isNaN(cm)) return { code: 'heightRequired' };
  if (cm < PROFILE_MIN_HEIGHT_CM || cm > PROFILE_MAX_HEIGHT_CM) {
    return {
      code: 'heightRange',
      params: { min: PROFILE_MIN_HEIGHT_CM, max: PROFILE_MAX_HEIGHT_CM },
    };
  }
  return null;
}

export function validateProfileBirthDate(date: Date | null): BirthDateError | null {
  if (!date) return { code: 'birthDateRequired' };
  if (isFutureDate(date)) return { code: 'birthDateFuture' };
  const age = computeAge(date);
  if (age < PROFILE_MIN_AGE || age > PROFILE_MAX_AGE) {
    return {
      code: 'birthDateAgeRange',
      params: { min: PROFILE_MIN_AGE, max: PROFILE_MAX_AGE },
    };
  }
  return null;
}
