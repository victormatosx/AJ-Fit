/**
 * Server-side authorization boundary for the future `requestAccountDeletion`
 * callable — Fase 2. Composes two already-tested primitives WITHOUT
 * modifying either:
 *
 *   - `requireRecentAuth` (`functions/src/lib/auth.ts:47-72`) — the exact
 *     same recent-auth guard already protecting Photo Vault key recovery
 *     (`recoverVaultKey`). Reads `request.auth.token.auth_time` from the
 *     Firebase-verified ID token; ignores anything the client claims about
 *     its own freshness in the request body.
 *   - `rejectClientSuppliedIdentityOrPolicy` (Fase 1,
 *     `./requestContract.ts:57-64`) — defense-in-depth against a payload
 *     that tries to smuggle `uid`/`policy`/`workflowVersion`/`recentAuth`/
 *     `deletionId` fields.
 *
 * This function is the ENTIRE server-side authorization check a future
 * callable needs before it may create or touch any `AccountDeletionRecord`
 * state — see the Fase 2 report for why nothing else belongs here (uid
 * resolution, record creation, and everything downstream is Fase 3+ work).
 *
 * Deliberately not wired into `functions/src/index.ts` this phase: doing so
 * would stand up a live, deployable callable before the destructive
 * workflow behind it exists, which is explicitly out of scope for Fase 2.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';

import { requireRecentAuth, RECENT_AUTH_MAX_AGE_SECONDS } from '../lib/auth';
import { rejectClientSuppliedIdentityOrPolicy } from './requestContract';
import type { Uid } from './types';

export { RECENT_AUTH_MAX_AGE_SECONDS };

/**
 * Returns the authorized uid, or throws (via `requireRecentAuth`'s
 * `HttpsError('unauthenticated' | 'failed-precondition', ...)`, or via
 * `rejectClientSuppliedIdentityOrPolicy`'s `ForbiddenClientFieldError`) when
 * the request may not proceed.
 *
 * Order matters only for defense-in-depth clarity, not for correctness:
 * checking the payload shape first means a forged-field attempt is rejected
 * on its own terms even if it happened to also carry a fresh token.
 */
export function requireAccountDeletionAuthorization(
  request: Pick<CallableRequest, 'auth' | 'data'>,
): Uid {
  rejectClientSuppliedIdentityOrPolicy(request.data);
  return requireRecentAuth(request as CallableRequest);
}
