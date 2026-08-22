import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from 'firebase/auth';
import { hasPasswordProvider } from '../lib/authProviders';
import { auth } from '../lib/firebase';
import {
  validatePasswordChange,
  type PasswordChangeInput,
  type PasswordChangeValidationIssue,
} from '../lib/passwordChange';
import { assertNewPasswordMeetsPolicy } from '../lib/passwordPolicy';
import { logAuthError, toAuthError } from './auth';

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function validationError(issue: PasswordChangeValidationIssue): Error & { code: string } {
  return codedError(issue);
}

/** Reauthenticates the current password user and rejects any session change. */
export async function reauthenticatePasswordUser(
  currentPassword: string,
): Promise<User> {
  try {
    const user = auth.currentUser;
    if (!user) throw codedError('auth/no-current-user');
    if (!hasPasswordProvider(user)) {
      throw codedError('auth/password-provider-required');
    }
    if (!user.email) throw codedError('auth/missing-email');
    if (!currentPassword) throw codedError('auth/missing-password');

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    const result = await reauthenticateWithCredential(user, credential);
    const reauthenticatedUser = auth.currentUser;
    if (
      !reauthenticatedUser ||
      !hasPasswordProvider(reauthenticatedUser) ||
      reauthenticatedUser.uid !== user.uid ||
      result.user.uid !== user.uid
    ) {
      throw codedError('auth/no-current-user');
    }
    return reauthenticatedUser;
  } catch (error) {
    logAuthError('reauthenticate-password', error);
    throw toAuthError(error);
  }
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

  await assertNewPasswordMeetsPolicy(input.newPassword);

  const reauthenticatedUser = await reauthenticatePasswordUser(
    input.currentPassword,
  );
  try {
    await updatePassword(reauthenticatedUser, input.newPassword);
  } catch (error) {
    logAuthError('change-password', error);
    throw toAuthError(error);
  }
}
