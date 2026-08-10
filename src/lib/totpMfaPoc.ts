export const TOTP_FACTOR_ID = 'totp' as const;
export const TOTP_CODE_LENGTH = 6;

export type TotpMfaPocIssue =
  | 'userMissing'
  | 'emailUnverified'
  | 'codeRequired'
  | 'codeNonNumeric'
  | 'codeLength'
  | 'invalidCode'
  | 'invalidSession'
  | 'factorAlreadyEnrolled'
  | 'factorLimit'
  | 'operationNotAllowed'
  | 'resolverWithoutHints'
  | 'totpFactorMissing'
  | 'sessionExpired'
  | 'network'
  | 'unknown';

export type TotpHintLike = {
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

export function validateTotpCode(code: string): TotpMfaPocIssue | null {
  if (code.length === 0) return 'codeRequired';
  if (!/^\d+$/.test(code)) return 'codeNonNumeric';
  if (code.length !== TOTP_CODE_LENGTH) return 'codeLength';
  return null;
}

export function selectTotpHints<T extends TotpHintLike>(hints: readonly T[]): T[] {
  return hints.filter((hint) => hint.factorId === TOTP_FACTOR_ID);
}

export function totpMfaIssueFromError(error: unknown): TotpMfaPocIssue {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issue' in error &&
    typeof (error as { issue?: unknown }).issue === 'string'
  ) {
    return (error as { issue: TotpMfaPocIssue }).issue;
  }

  switch (getFirebaseErrorCode(error)) {
    case 'auth/missing-verification-code':
      return 'codeRequired';
    case 'auth/invalid-verification-code':
      // The installed SDK uses the same code for a wrong or expired TOTP.
      return 'invalidCode';
    case 'auth/invalid-multi-factor-session':
    case 'auth/missing-multi-factor-session':
      return 'invalidSession';
    case 'auth/multi-factor-info-not-found':
    case 'auth/missing-multi-factor-info':
      return 'totpFactorMissing';
    case 'auth/second-factor-already-in-use':
      return 'factorAlreadyEnrolled';
    case 'auth/maximum-second-factor-count-exceeded':
      return 'factorLimit';
    case 'auth/operation-not-allowed':
      return 'operationNotAllowed';
    case 'auth/unverified-email':
      return 'emailUnverified';
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
    case 'auth/no-current-user':
      return 'sessionExpired';
    case 'auth/network-request-failed':
      return 'network';
    default:
      return 'unknown';
  }
}
