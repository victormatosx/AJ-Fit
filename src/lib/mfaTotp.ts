export const TOTP_FACTOR_ID = 'totp' as const;
export const TOTP_CODE_LENGTH = 6;

export type MfaTotpIssue =
  | 'userMissing'
  | 'emailUnverified'
  | 'passwordRequired'
  | 'currentPasswordIncorrect'
  | 'reauthProviderUnsupported'
  | 'codeRequired'
  | 'codeNonNumeric'
  | 'codeLength'
  | 'invalidCode'
  | 'expiredCode'
  | 'flowExpired'
  | 'recentLoginRequired'
  | 'sessionExpired'
  | 'network'
  | 'tooManyRequests'
  | 'factorNotFound'
  | 'factorAlreadyEnrolled'
  | 'factorLimit'
  | 'unsupportedFirstFactor'
  | 'alreadyEnabled'
  | 'multipleFactors'
  | 'operationNotAllowed'
  | 'authenticatorUnavailable'
  | 'clipboardFailed'
  | 'resolverWithoutHints'
  | 'generic';

export type MfaFactorLike = {
  uid: string;
  factorId: string;
  displayName?: string | null;
  enrollmentTime?: string;
};

export function getFirebaseErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

export function isMultiFactorAuthRequired(error: unknown): boolean {
  return getFirebaseErrorCode(error) === 'auth/multi-factor-auth-required';
}

export function validateTotpCode(code: string): MfaTotpIssue | null {
  if (code.length === 0) return 'codeRequired';
  if (!/^\d+$/.test(code)) return 'codeNonNumeric';
  if (code.length !== TOTP_CODE_LENGTH) return 'codeLength';
  return null;
}

export function selectTotpFactors<T extends MfaFactorLike>(
  factors: readonly T[],
): T[] {
  return factors.filter((factor) => factor.factorId === TOTP_FACTOR_ID);
}

export function formatTotpSecret(secretKey: string): string {
  return secretKey.replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') ?? secretKey;
}

export function mfaTotpIssueFromError(error: unknown): MfaTotpIssue {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issue' in error &&
    typeof (error as { issue?: unknown }).issue === 'string'
  ) {
    return (error as { issue: MfaTotpIssue }).issue;
  }

  switch (getFirebaseErrorCode(error)) {
    case 'auth/missing-password':
      return 'passwordRequired';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-mismatch':
      return 'currentPasswordIncorrect';
    case 'auth/password-provider-required':
    case 'auth/missing-email':
      return 'reauthProviderUnsupported';
    case 'auth/missing-verification-code':
      return 'codeRequired';
    case 'auth/invalid-verification-code':
      return 'invalidCode';
    case 'auth/code-expired':
      return 'expiredCode';
    case 'auth/requires-recent-login':
      return 'recentLoginRequired';
    case 'auth/invalid-multi-factor-session':
    case 'auth/missing-multi-factor-session':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
    case 'auth/no-current-user':
      return 'sessionExpired';
    case 'auth/multi-factor-info-not-found':
    case 'auth/missing-multi-factor-info':
      return 'factorNotFound';
    case 'auth/second-factor-already-in-use':
      return 'factorAlreadyEnrolled';
    case 'auth/maximum-second-factor-count-exceeded':
      return 'factorLimit';
    case 'auth/unsupported-first-factor':
      return 'unsupportedFirstFactor';
    case 'auth/unverified-email':
      return 'emailUnverified';
    case 'auth/operation-not-allowed':
      return 'operationNotAllowed';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/too-many-requests':
      return 'tooManyRequests';
    default:
      return 'generic';
  }
}
