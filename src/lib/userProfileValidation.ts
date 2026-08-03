import { computeAge } from './ageCalculator';
import { isFutureDate } from './dateUtils';

export const DISPLAY_NAME_MAX_LENGTH = 50;
export const PROFILE_MIN_AGE = 16;
export const PROFILE_MAX_AGE = 75;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateDisplayName(value: string): string | null {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return 'Informe seu nome.';
  if (normalized.length < 2) return 'Use pelo menos 2 caracteres.';
  if (normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Use no máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres.`;
  }
  return null;
}

export function validateProfileBirthDate(date: Date | null): string | null {
  if (!date) return 'Informe uma data válida.';
  if (isFutureDate(date)) return 'A data não pode estar no futuro.';
  const age = computeAge(date);
  if (age < PROFILE_MIN_AGE || age > PROFILE_MAX_AGE) {
    return `A idade deve estar entre ${PROFILE_MIN_AGE} e ${PROFILE_MAX_AGE} anos.`;
  }
  return null;
}
