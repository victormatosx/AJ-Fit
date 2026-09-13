import type { Quiz } from '../state/AppState';
import { computeAge } from './ageCalculator';
import { PROFILE_MAX_AGE, PROFILE_MIN_AGE } from './userProfileValidation';

export type RegistrationEligibilityCode =
  | 'registrationBirthDateRequired'
  | 'registrationUnderage'
  | 'registrationBirthDateInvalid'
  | 'registrationLegalAcceptanceRequired';

export class RegistrationEligibilityError extends Error {
  readonly code: RegistrationEligibilityCode;

  constructor(code: RegistrationEligibilityCode) {
    super(code);
    this.name = 'RegistrationEligibilityError';
    this.code = code;
  }
}

/** Domain boundary for every path that can provision a new AJ Fit account. */
export function assertNewAccountEligibility(input: {
  answers?: Quiz | null;
  legalAccepted?: boolean;
  referenceDate?: Date;
}): void {
  const birthDate = input.answers?.birthDate;
  if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) {
    throw new RegistrationEligibilityError('registrationBirthDateRequired');
  }

  const age = computeAge(birthDate, input.referenceDate);
  if (age < PROFILE_MIN_AGE) {
    throw new RegistrationEligibilityError('registrationUnderage');
  }
  if (age > PROFILE_MAX_AGE || birthDate.getTime() > (input.referenceDate ?? new Date()).getTime()) {
    throw new RegistrationEligibilityError('registrationBirthDateInvalid');
  }
  if (!input.legalAccepted) {
    throw new RegistrationEligibilityError('registrationLegalAcceptanceRequired');
  }
}

/**
 * Classifies a federated sign-in without retroactively gating established AJ
 * Fit accounts. Missing profiles are treated as incomplete registrations so a
 * failed cleanup can never turn into an "existing user" bypass on retry.
 */
export function resolveSocialAccountAdmission(input: {
  isNewUser: boolean;
  hasProfile: boolean;
  answers?: Quiz | null;
  legalAccepted?: boolean;
  referenceDate?: Date;
}): 'existing' | 'requires-provisioning' {
  if (!input.isNewUser && input.hasProfile) return 'existing';

  // Legal acceptance is checked first here because a direct social attempt
  // can happen before onboarding supplied the rest of the registration data.
  if (!input.legalAccepted) {
    throw new RegistrationEligibilityError('registrationLegalAcceptanceRequired');
  }
  assertNewAccountEligibility(input);
  return 'requires-provisioning';
}
