import { hasPasswordProvider } from './authProviders';

type VerificationUser = {
  emailVerified: boolean;
  providerData: ReadonlyArray<{ providerId: string }>;
};

export type EmailVerificationIssue =
  | 'stillUnverified'
  | 'tooManyRequests'
  | 'network'
  | 'sessionExpired'
  | 'generic';

/**
 * Central access rule for email verification.
 *
 * Firebase Authentication remains the only source of truth: a user is held
 * outside the main app only while it has the password provider and the real
 * Firebase `emailVerified` flag is false.
 */
export function requiresEmailVerification(
  user: VerificationUser | null | undefined,
): boolean {
  return !!user && hasPasswordProvider(user) && user.emailVerified === false;
}

export function emailVerificationIssueFromError(
  error: unknown,
): Exclude<EmailVerificationIssue, 'stillUnverified'> {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/too-many-requests':
      return 'tooManyRequests';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/no-current-user':
    case 'auth/user-not-found':
    case 'auth/user-disabled':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
      return 'sessionExpired';
    default:
      return 'generic';
  }
}
