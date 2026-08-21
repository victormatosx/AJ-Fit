import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/**
 * Shared guards for the authenticated Photo Vault callable functions
 * (docs/20_backend_functions_photo_vault.md).
 *
 * Firebase Callable Functions already verify the Firebase ID Token before
 * invoking the handler and populate `request.auth` from it — these helpers
 * only enforce policy on top of that verified token. The uid must never be
 * read from `request.data` (client-supplied body), only from
 * `request.auth.uid`.
 */
export function requireAuth(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'This function requires an authenticated user.');
  }

  return request.auth.uid;
}

function hasPasswordIdentity(request: CallableRequest): boolean {
  const firebaseClaim = request.auth?.token?.firebase;
  if (!firebaseClaim || typeof firebaseClaim !== 'object') return false;
  const identities = (firebaseClaim as Record<string, unknown>).identities;
  if (!identities || typeof identities !== 'object') return false;
  const emails = (identities as Record<string, unknown>).email;
  return Array.isArray(emails) && emails.length > 0;
}

/**
 * Email/Password identities must verify ownership of their email before
 * using private product surfaces. Social-only identities remain eligible;
 * a linked account that also contains an email/password identity does not
 * gain a bypass by signing in with another provider.
 */
export function requireVerifiedEmailForPrivateAccess(request: CallableRequest): void {
  requireAuth(request);
  if (hasPasswordIdentity(request) && request.auth?.token?.email_verified !== true) {
    throw new HttpsError('permission-denied', 'email_verification_required');
  }
}

/**
 * How recently the user must have proved their credentials for a sensitive
 * operation. A valid but old ID Token is deliberately NOT enough to recover
 * the Vault Key — a stolen device with a live session must not be able to
 * extract it without re-entering the account credential.
 */
export const RECENT_AUTH_MAX_AGE_SECONDS = 5 * 60;

/**
 * Small allowance for clock skew between the token issuer and this runtime.
 * Anything further in the future is treated as anomalous and rejected.
 */
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

/**
 * Like `requireAuth`, but additionally demands that the user authenticated
 * recently.
 *
 * `auth_time` comes from the Firebase-verified ID Token — never from the
 * request body — so the client cannot claim to have authenticated more
 * recently than it did. Missing or anomalous values fail closed.
 *
 * Note: "recent auth" here means the Firebase credential was re-proved
 * (password, Google, Apple). It is NOT biometrics — device-local
 * authentication is a separate, later concern.
 */
export function requireRecentAuth(
  request: CallableRequest,
  maxAgeSeconds: number = RECENT_AUTH_MAX_AGE_SECONDS,
): string {
  const uid = requireAuth(request);
  const authTime = request.auth?.token?.auth_time;

  if (typeof authTime !== 'number' || !Number.isFinite(authTime)) {
    throw new HttpsError(
      'failed-precondition',
      'Recent authentication is required for this operation.',
    );
  }

  const ageSeconds = Date.now() / 1000 - authTime;

  // Too old, or implausibly in the future — both fail closed.
  if (ageSeconds > maxAgeSeconds || ageSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS) {
    throw new HttpsError(
      'failed-precondition',
      'Recent authentication is required for this operation.',
    );
  }

  return uid;
}
