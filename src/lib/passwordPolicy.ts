export const PASSWORD_POLICY_MIN_LENGTH = 15;
export const PASSWORD_POLICY_MAX_LENGTH = 4096;

export type NewPasswordPolicyIssue =
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'passwordPolicyMismatch';

/**
 * Immediate UX validation for a password that is being created or replaced.
 * Firebase remains authoritative; these constants mirror the approved policy
 * so obviously invalid submissions can be stopped without a network roundtrip.
 */
export function validateNewPasswordLocally(
  password: string,
): NewPasswordPolicyIssue | null {
  if (password.length < PASSWORD_POLICY_MIN_LENGTH) return 'passwordTooShort';
  if (password.length > PASSWORD_POLICY_MAX_LENGTH) return 'passwordTooLong';
  return null;
}

/** Login credentials are existing secrets and must never be strength-checked. */
export function validateAuthFormPasswordPolicy(
  mode: 'signup' | 'login',
  password: string,
): NewPasswordPolicyIssue | null {
  return mode === 'signup' ? validateNewPasswordLocally(password) : null;
}

/**
 * Validates against the policy Firebase exposes to this client. If that
 * read fails, the approved local min/max still apply and the subsequent Auth
 * mutation remains protected by Firebase's server-side enforcement.
 */
export async function validateNewPasswordAgainstFirebase(
  password: string,
): Promise<NewPasswordPolicyIssue | null> {
  const localIssue = validateNewPasswordLocally(password);
  if (localIssue) return localIssue;

  try {
    // Lazy imports keep the synchronous policy helpers platform-independent
    // and avoid initializing Firebase when only local form validation is used.
    const [{ validatePassword }, { auth }] = await Promise.all([
      import('firebase/auth'),
      import('./firebase'),
    ]);
    const status = await validatePassword(auth, password);
    if (status.isValid) return null;
    if (status.meetsMinPasswordLength === false) return 'passwordTooShort';
    if (status.meetsMaxPasswordLength === false) return 'passwordTooLong';
    return 'passwordPolicyMismatch';
  } catch {
    return null;
  }
}

export async function assertNewPasswordMeetsPolicy(password: string): Promise<void> {
  const issue = await validateNewPasswordAgainstFirebase(password);
  if (!issue) return;
  throw Object.assign(new Error(issue), { code: issue });
}
