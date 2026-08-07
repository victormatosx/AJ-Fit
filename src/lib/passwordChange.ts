export const PASSWORD_MIN_LENGTH = 6;

export type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

export type PasswordChangeValidationIssue =
  | 'currentPasswordRequired'
  | 'newPasswordRequired'
  | 'confirmationRequired'
  | 'passwordMismatch'
  | 'passwordUnchanged'
  | 'passwordTooShort';

export type PasswordChangeIssue =
  | PasswordChangeValidationIssue
  | 'currentPasswordIncorrect'
  | 'weakPassword'
  | 'sessionExpired'
  | 'providerRequired'
  | 'tooManyRequests'
  | 'networkFailed'
  | 'changeFailed';

export function validatePasswordChange(
  input: PasswordChangeInput,
): PasswordChangeValidationIssue | null {
  if (!input.currentPassword) return 'currentPasswordRequired';
  if (!input.newPassword) return 'newPasswordRequired';
  if (!input.confirmation) return 'confirmationRequired';
  if (input.confirmation !== input.newPassword) return 'passwordMismatch';
  if (input.newPassword === input.currentPassword) return 'passwordUnchanged';
  if (input.newPassword.length < PASSWORD_MIN_LENGTH) return 'passwordTooShort';
  return null;
}

export function passwordChangeIssueFromError(error: unknown): PasswordChangeIssue {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (
    code === 'currentPasswordRequired' ||
    code === 'newPasswordRequired' ||
    code === 'confirmationRequired' ||
    code === 'passwordMismatch' ||
    code === 'passwordUnchanged' ||
    code === 'passwordTooShort'
  ) {
    return code;
  }

  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-mismatch':
      return 'currentPasswordIncorrect';
    case 'auth/weak-password':
      return 'weakPassword';
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
    case 'auth/no-current-user':
      return 'sessionExpired';
    case 'auth/password-provider-required':
    case 'auth/missing-email':
      return 'providerRequired';
    case 'auth/too-many-requests':
      return 'tooManyRequests';
    case 'auth/network-request-failed':
      return 'networkFailed';
    default:
      return 'changeFailed';
  }
}
