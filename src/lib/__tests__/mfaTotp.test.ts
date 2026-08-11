import { describe, expect, it } from 'vitest';
import {
  formatTotpSecret,
  isMultiFactorAuthRequired,
  mfaTotpIssueFromError,
  selectTotpFactors,
  validateTotpCode,
} from '../mfaTotp';

describe('TOTP MFA domain helpers', () => {
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
    expect(isMultiFactorAuthRequired({ code: 'auth/multi-factor-auth-required' })).toBe(true);
    expect(isMultiFactorAuthRequired({ code: 'auth/invalid-credential' })).toBe(false);
    expect(isMultiFactorAuthRequired(new Error('multi-factor-auth-required'))).toBe(false);
  });

  it('selects every TOTP factor without assuming array position', () => {
    const factors = [
      { uid: 'totp-1', factorId: 'totp' },
      { uid: 'other-1', factorId: 'phone' },
      { uid: 'totp-2', factorId: 'totp' },
    ];
    expect(selectTotpFactors(factors).map((factor) => factor.uid)).toEqual([
      'totp-1',
      'totp-2',
    ]);
  });

  it('formats a manual secret without changing its value', () => {
    expect(formatTotpSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP');
  });

  it.each([
    ['auth/missing-verification-code', 'codeRequired'],
    ['auth/invalid-verification-code', 'invalidCode'],
    ['auth/code-expired', 'expiredCode'],
    ['auth/invalid-multi-factor-session', 'sessionExpired'],
    ['auth/missing-multi-factor-session', 'sessionExpired'],
    ['auth/multi-factor-info-not-found', 'factorNotFound'],
    ['auth/second-factor-already-in-use', 'factorAlreadyEnrolled'],
    ['auth/maximum-second-factor-count-exceeded', 'factorLimit'],
    ['auth/unsupported-first-factor', 'unsupportedFirstFactor'],
    ['auth/operation-not-allowed', 'operationNotAllowed'],
    ['auth/unverified-email', 'emailUnverified'],
    ['auth/requires-recent-login', 'recentLoginRequired'],
    ['auth/user-mismatch', 'userMismatch'],
    ['auth/user-token-expired', 'sessionExpired'],
    ['auth/network-request-failed', 'network'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/not-a-real-code', 'generic'],
  ])('maps real Firebase code %s to domain feedback', (code, issue) => {
    expect(mfaTotpIssueFromError({ code })).toBe(issue);
  });

  it('preserves safe provider and reauthentication domain issues', () => {
    expect(mfaTotpIssueFromError({ issue: 'providerUnavailable' })).toBe(
      'providerUnavailable',
    );
    expect(mfaTotpIssueFromError({ issue: 'reauthFailed' })).toBe(
      'reauthFailed',
    );
  });
});
