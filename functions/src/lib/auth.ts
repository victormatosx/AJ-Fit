import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/**
 * Shared guard for future authenticated Photo Vault callable functions
 * (not implemented yet — see docs/20_backend_functions_photo_vault.md).
 *
 * Firebase Callable Functions already verify the Firebase ID Token before
 * invoking the handler and populate `request.auth` from it — this helper
 * only enforces that a request without a verified token is rejected, and
 * returns the uid straight from that verified token. The uid must never be
 * read from `request.data` (client-supplied body), only from
 * `request.auth.uid`.
 */
export function requireAuth(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'This function requires an authenticated user.');
  }

  return request.auth.uid;
}
