import {
  reauthenticateWithCredential,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import {
  getReauthenticationProviders,
  type ReauthenticationProvider,
} from '../lib/authProviders';
import { auth } from '../lib/firebase';
import { reauthenticatePasswordUser } from './password';
import { getAppleCredential } from './providers/apple';
import { getGoogleCredential } from './providers/google';
import {
  ProviderCredentialError,
  SocialAuthCancelledError,
} from './providers/types';

export type ReauthenticationRequest =
  | { provider: 'password'; password: string }
  | { provider: 'google' }
  | { provider: 'apple' };

export type ReauthenticationIssue =
  | 'userMissing'
  | 'userMismatch'
  | 'reauthProviderUnsupported'
  | 'reauthFailed';

export class ReauthenticationCancelledError extends Error {
  constructor() {
    super('Reauthentication cancelled');
    this.name = 'ReauthenticationCancelledError';
  }
}

export class ReauthenticationServiceError extends Error {
  readonly issue: ReauthenticationIssue;

  constructor(issue: ReauthenticationIssue) {
    super(issue);
    this.name = 'ReauthenticationServiceError';
    this.issue = issue;
  }
}

function currentUserForUid(uid: string): User {
  const current = auth.currentUser;
  if (!current) throw new ReauthenticationServiceError('userMissing');
  if (current.uid !== uid) {
    throw new ReauthenticationServiceError('userMismatch');
  }
  return current;
}

function assertProviderLinked(user: User, provider: ReauthenticationProvider): void {
  if (!getReauthenticationProviders(user).includes(provider)) {
    throw new ReauthenticationServiceError('reauthProviderUnsupported');
  }
}

async function acquireFederatedCredential(
  provider: 'google' | 'apple',
): Promise<AuthCredential> {
  try {
    const result =
      provider === 'google'
        ? await getGoogleCredential()
        : await getAppleCredential({ requestProfile: false });
    return result.credential;
  } catch (error) {
    if (error instanceof SocialAuthCancelledError) {
      throw new ReauthenticationCancelledError();
    }
    if (error instanceof ProviderCredentialError) throw error;
    throw new ReauthenticationServiceError('reauthFailed');
  }
}

function shouldPreserveFirebaseError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return [
    'auth/network-request-failed',
    'auth/too-many-requests',
    'auth/requires-recent-login',
    'auth/user-token-expired',
    'auth/invalid-user-token',
    'auth/no-current-user',
    'auth/user-mismatch',
  ].includes(code);
}

/**
 * Reauthenticates the current Firebase user without signing in, linking, or
 * changing navigation. Federated credentials and Apple nonces remain local to
 * this call and become unreachable immediately after it completes.
 */
export async function reauthenticateCurrentUser(
  request: ReauthenticationRequest,
): Promise<User> {
  const originalUser = auth.currentUser;
  if (!originalUser) throw new ReauthenticationServiceError('userMissing');
  const originalUid = originalUser.uid;
  assertProviderLinked(originalUser, request.provider);

  if (request.provider === 'password') {
    const reauthenticated = await reauthenticatePasswordUser(request.password);
    const current = currentUserForUid(originalUid);
    if (reauthenticated.uid !== originalUid) {
      throw new ReauthenticationServiceError('userMismatch');
    }
    return current;
  }

  const credential = await acquireFederatedCredential(request.provider);
  // The provider sheet can remain open long enough for the app session to be
  // replaced elsewhere. Never apply its credential to a different current UID.
  currentUserForUid(originalUid);

  try {
    const result = await reauthenticateWithCredential(originalUser, credential);
    const current = currentUserForUid(originalUid);
    if (result.user.uid !== originalUid) {
      throw new ReauthenticationServiceError('userMismatch');
    }
    return current;
  } catch (error) {
    if (error instanceof ReauthenticationServiceError) throw error;
    if (shouldPreserveFirebaseError(error)) throw error;
    throw new ReauthenticationServiceError('reauthFailed');
  }
}
