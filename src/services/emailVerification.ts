import { sendEmailVerification, type User } from 'firebase/auth';
import { hasPasswordProvider } from '../lib/authProviders';
import { auth } from '../lib/firebase';
import { logAuthError, toAuthError } from './auth';

const sendInFlightByUid = new Map<string, Promise<void>>();

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function requirePasswordUser(candidate?: User | null): User {
  const user = candidate ?? auth.currentUser;
  if (!user) throw codedError('auth/no-current-user');
  if (!hasPasswordProvider(user)) {
    throw codedError('auth/password-provider-required');
  }
  return user;
}

/** Sends one verification email. Never called automatically from a screen. */
export async function sendVerificationEmail(targetUser?: User): Promise<void> {
  let user: User;
  try {
    user = requirePasswordUser(targetUser);
  } catch (error) {
    logAuthError('email-verification:send', error);
    throw toAuthError(error);
  }
  const inFlight = sendInFlightByUid.get(user.uid);
  if (inFlight) return inFlight;

  const request = sendEmailVerification(user)
    .catch((error: unknown) => {
      logAuthError('email-verification:send', error);
      throw toAuthError(error);
    })
    .finally(() => {
      if (sendInFlightByUid.get(user.uid) === request) {
        sendInFlightByUid.delete(user.uid);
      }
    });
  sendInFlightByUid.set(user.uid, request);
  return request;
}

/**
 * Reloads the current Firebase user and returns the server-backed verification
 * status. Reading `auth.currentUser` again after `reload()` guards against a
 * session change while the network request was in flight.
 */
export async function refreshEmailVerificationStatus(): Promise<{
  user: User;
  emailVerified: boolean;
}> {
  try {
    const user = requirePasswordUser();
    await user.reload();

    const refreshedUser = auth.currentUser;
    if (!refreshedUser || refreshedUser.uid !== user.uid) {
      throw codedError('auth/no-current-user');
    }

    // `reload()` refreshes the User object, but Rules and callable handlers
    // authorize with ID-token claims. Force a new token before releasing the
    // navigation gate so `email_verified` cannot remain stale.
    if (refreshedUser.emailVerified) {
      await refreshedUser.getIdToken(true);
    }

    return {
      user: refreshedUser,
      emailVerified: refreshedUser.emailVerified,
    };
  } catch (error) {
    logAuthError('email-verification:refresh', error);
    throw toAuthError(error);
  }
}
