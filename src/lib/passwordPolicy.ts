export const PASSWORD_POLICY_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MAX_LENGTH = 4096;

const UPPERCASE_RE = /[A-Z]/;
const NUMBER_RE = /[0-9]/;

/**
 * Exact non-alphanumeric character set Firebase's remote Identity Platform
 * password policy accepts for this project (`allowedNonAlphanumericCharacters`
 * in the `validatePassword` response). A generic "anything non-alphanumeric"
 * regex would accept characters (space, `+`, `=`, emoji, accents, ...) that
 * Firebase's own policy does not recognize as special — a password approved
 * locally could then still be rejected remotely. Checked via a `Set`, never a
 * regex character class, so nothing needs escaping and nothing can silently
 * admit a character outside this exact list.
 */
export const PASSWORD_POLICY_ALLOWED_SPECIAL_CHARACTERS = '^$*.[]{}()?"!@#%&/\\,><\':;|_~`-';

const ALLOWED_SPECIAL_CHARACTER_SET = new Set(PASSWORD_POLICY_ALLOWED_SPECIAL_CHARACTERS);

function containsAllowedSpecialCharacter(password: string): boolean {
  for (const character of password) {
    if (ALLOWED_SPECIAL_CHARACTER_SET.has(character)) return true;
  }
  return false;
}

export type NewPasswordPolicyIssue =
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'passwordMissingUppercase'
  | 'passwordMissingNumber'
  | 'passwordMissingSpecialChar'
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
  if (!UPPERCASE_RE.test(password)) return 'passwordMissingUppercase';
  if (!NUMBER_RE.test(password)) return 'passwordMissingNumber';
  if (!containsAllowedSpecialCharacter(password)) return 'passwordMissingSpecialChar';
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

    // Reaching here means the remote policy rejected a password the declared
    // policy above already approved — the two have drifted apart. The specific
    // remote reasons must NOT be reused as issue codes: every one of them is
    // rendered from the LOCAL constants, so a remote `minPasswordLength: 15`
    // would tell the user "use at least 8 characters" about a 9-character
    // password. Report the drift as what it is; the message stays truthful and
    // the password still gets blocked (Firebase would reject it anyway).
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
