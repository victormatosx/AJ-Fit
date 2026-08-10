import { describe, expect, it } from 'vitest';
import {
  isMultiFactorAuthRequired,
  selectTotpHints,
  totpMfaIssueFromError,
  validateTotpCode,
} from '../totpMfaPoc';

describe('TOTP MFA POC helpers', () => {
  it.each([
    ['', 'codeRequired'],
    ['12a456', 'codeNonNumeric'],
    ['12345', 'codeLength'],
    ['1234567', 'codeLength'],
    ['123456', null],
  ])('validates the six-digit format for %j', (code, issue) => {
    expect(validateTotpCode(code)).toBe(issue);
  });

  it('recognizes only the installed SDK MFA-required error code', () => {
    expect(
      isMultiFactorAuthRequired({ code: 'auth/multi-factor-auth-required' }),
    ).toBe(true);
    expect(isMultiFactorAuthRequired({ code: 'auth/invalid-credential' })).toBe(
      false,
    );
    expect(isMultiFactorAuthRequired(new Error('multi-factor-auth-required'))).toBe(
      false,
    );
  });

  it('selects TOTP hints without assuming social providers are verified', () => {
    const hints = [
      { uid: 'totp-1', factorId: 'totp' },
      { uid: 'other-1', factorId: 'phone' },
      { uid: 'totp-2', factorId: 'totp' },
    ];

    expect(selectTotpHints(hints).map((hint) => hint.uid)).toEqual([
      'totp-1',
      'totp-2',
    ]);
  });

  it.each([
    ['auth/missing-verification-code', 'codeRequired'],
    ['auth/invalid-verification-code', 'invalidCode'],
    ['auth/invalid-multi-factor-session', 'invalidSession'],
    ['auth/missing-multi-factor-session', 'invalidSession'],
    ['auth/multi-factor-info-not-found', 'totpFactorMissing'],
    ['auth/second-factor-already-in-use', 'factorAlreadyEnrolled'],
    ['auth/maximum-second-factor-count-exceeded', 'factorLimit'],
    ['auth/operation-not-allowed', 'operationNotAllowed'],
    ['auth/unverified-email', 'emailUnverified'],
    ['auth/requires-recent-login', 'sessionExpired'],
    ['auth/user-token-expired', 'sessionExpired'],
    ['auth/network-request-failed', 'network'],
    ['auth/not-a-real-code', 'unknown'],
  ])('maps real Firebase code %s to domain feedback', (code, issue) => {
    expect(totpMfaIssueFromError({ code })).toBe(issue);
  });
});
