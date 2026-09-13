import { describe, expect, it } from 'vitest';
import { defaultQuiz } from '../../state/AppState';
import {
  assertNewAccountEligibility,
  RegistrationEligibilityError,
  resolveSocialAccountAdmission,
} from '../registrationEligibility';

const referenceDate = new Date(2026, 8, 13);

describe('new account eligibility', () => {
  it('accepts an adult who accepted the legal documents', () => {
    expect(() => assertNewAccountEligibility({
      answers: { ...defaultQuiz, birthDate: new Date(2008, 8, 13) },
      legalAccepted: true,
      referenceDate,
    })).not.toThrow();
  });

  it('rejects anyone under 18 at the account-creation boundary', () => {
    expect(() => assertNewAccountEligibility({
      answers: { ...defaultQuiz, birthDate: new Date(2008, 8, 14) },
      legalAccepted: true,
      referenceDate,
    })).toThrowError(expect.objectContaining({ code: 'registrationUnderage' }));
  });

  it('rejects missing birth date and missing legal acceptance', () => {
    expect(() => assertNewAccountEligibility({ answers: defaultQuiz, legalAccepted: true, referenceDate }))
      .toThrowError(expect.objectContaining({ code: 'registrationBirthDateRequired' }));
    expect(() => assertNewAccountEligibility({
      answers: { ...defaultQuiz, birthDate: new Date(1990, 0, 1) },
      legalAccepted: false,
      referenceDate,
    })).toThrow(RegistrationEligibilityError);
  });

  it.each(['Google', 'Apple'])(
    '%s new user requires legal acceptance before provisioning',
    () => {
      expect(() => resolveSocialAccountAdmission({
        isNewUser: true,
        hasProfile: false,
        answers: { ...defaultQuiz, birthDate: new Date(1990, 0, 1) },
        legalAccepted: false,
        referenceDate,
      })).toThrowError(expect.objectContaining({
        code: 'registrationLegalAcceptanceRequired',
      }));
    },
  );

  it.each(['Google', 'Apple'])(
    '%s existing AJ Fit user logs in without retroactive acceptance',
    () => {
      expect(resolveSocialAccountAdmission({
        isNewUser: false,
        hasProfile: true,
        legalAccepted: false,
        referenceDate,
      })).toBe('existing');
    },
  );

  it('keeps an unprovisioned identity gated on later sign-ins', () => {
    expect(() => resolveSocialAccountAdmission({
      isNewUser: false,
      hasProfile: false,
      legalAccepted: false,
      referenceDate,
    })).toThrowError(expect.objectContaining({
      code: 'registrationLegalAcceptanceRequired',
    }));
  });
});
