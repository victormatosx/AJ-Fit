import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { hasPasswordProvider } from '../lib/authProviders';
import { auth } from '../lib/firebase';
import {
  validatePasswordChange,
  type PasswordChangeInput,
  type PasswordChangeValidationIssue,
} from '../lib/passwordChange';
import { logAuthError, toAuthError } from './auth';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function validationError(issue: PasswordChangeValidationIssue): Error & { code: string } {
  return codedError(issue);
}

/**
 * Revalidates every precondition before touching Firebase, then performs the
 * mandatory sensitive-operation sequence: reauthenticate first, update second.
 */
export async function changePasswordWithReauthentication(
  input: PasswordChangeInput,
): Promise<void> {
  const validationIssue = validatePasswordChange(input);
  if (validationIssue) throw validationError(validationIssue);

  try {
    const user = auth.currentUser;
    if (!user) throw codedError('auth/no-current-user');
    if (!hasPasswordProvider(user)) {
      throw codedError('auth/password-provider-required');
    }
    if (!user.email) throw codedError('auth/missing-email');

    const credential = EmailAuthProvider.credential(
      user.email,
      input.currentPassword,
    );
    await reauthenticateWithCredential(user, credential);
    const reauthenticatedUser = auth.currentUser;
    if (!reauthenticatedUser || reauthenticatedUser.uid !== user.uid) {
      throw codedError('auth/no-current-user');
    }
    if (!hasPasswordProvider(reauthenticatedUser)) {
      throw codedError('auth/password-provider-required');
    }
    await updatePassword(reauthenticatedUser, input.newPassword);
  } catch (error) {
    logAuthError('change-password', error);
    throw toAuthError(error);
  }
}
