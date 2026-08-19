/**
 * Google provider revocation — architecture decision + wire contract only.
 * Fase 3 §18/§19/§20.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DOCUMENTAÇÃO OFICIAL / COMPORTAMENTO ENCONTRADO (researched this phase)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `GoogleSignin.revokeAccess()` (`@react-native-google-signin/google-signin`,
 * the library this project already depends on — `src/services/providers/
 * google.native.ts`):
 *   - COMPORTAMENTO ENCONTRADO (package docs + GitHub issue history):
 *     disconnects the Google account from the app and revokes the OAuth
 *     grant server-side at Google — distinct from `signOut()`, which only
 *     clears the local session/disables auto sign-in without revoking
 *     anything. This IS the correct primitive for "revoke AJ Fit's
 *     authorization on this Google account" — confirmed NOT the same as,
 *     and with NO effect on, deleting the user's Google Account or any
 *     other app's authorization.
 *   - It operates entirely within Google's own OAuth infrastructure,
 *     independent of Firebase — it does not require the Firebase Auth user
 *     to still exist or be enabled. It DOES require an active Google
 *     Sign-In SDK session on the device (the library's own local session,
 *     which is separate from whatever Firebase provider reauthentication
 *     happened in Fase 2 — a user who reauthenticated with PASSWORD, for
 *     instance, may not have a live Google SDK session at all).
 *   - COMPORTAMENTO ENCONTRADO (multiple open GitHub issues against this
 *     exact library, checked during this phase): `revokeAccess()` is
 *     documented in real-world usage as unreliable — reports of it never
 *     resolving on iOS, and intermittent rejection on Android. This is a
 *     property of the INSTALLED library, not a hypothetical — any client
 *     wrapper around it MUST apply its own timeout (see
 *     `src/services/accountDeletionProviderRevocation.ts`).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DECISÃO ARQUITETURAL (Fase 3 §19): OPTION A — client-side revoke,
 * backend-CONFIRMED.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Option B (backend revoke via Google's OAuth `POST
 * https://oauth2.googleapis.com/revoke?token=...` endpoint) was
 * considered and rejected FOR NOW: it requires the backend to hold a
 * revocable Google access/refresh token, which requires the client to
 * request Google "offline access" (a `serverAuthCode`) during sign-in —
 * `src/services/providers/google.native.ts`'s CURRENT configuration only
 * requests an ID token for Firebase verification, never offline access.
 * Adding that is a real, separate change to the Google sign-in
 * configuration/consent scope (visible to the user as an extra
 * permission), not something to slip in silently inside a revocation
 * feature — flagged as a candidate for a FUTURE phase if Option A proves
 * insufficient in practice, never implemented here.
 *
 * Option C ("no additional revocation needed") was rejected: `revokeAccess`
 * genuinely does something `signOut`/Firebase Auth deletion does not (it
 * revokes the OAuth grant itself), and skipping it would leave AJ Fit's
 * authorization live in the user's Google Account "Connected apps" list
 * indefinitely after account deletion — not defensible as "no revocation
 * necessary".
 *
 * CONSEQUENCE the Fase 3 prompt explicitly demanded not be ignored (§20):
 * a client-side action can succeed while the app is then closed before
 * `requestAccountDeletion` (or, here, before this confirmation report)
 * ever reaches the backend. The mitigation adopted: `revokeAccess()` is
 * only ever invoked AFTER the deletion request already exists durably on
 * the backend (Fase 1's `REQUESTED` record) — never before/instead of it.
 * If the report in this file never arrives (app closed mid-flight), the
 * DELETION ITSELF still proceeds normally on every other front; only the
 * `google.com` sub-step remains not-yet-`SUCCEEDED`, which — being a
 * REQUIRED step under the v1 policy — blocks `COMPLETED` until either (a)
 * the app is reopened and the client naturally retries the still-pending
 * sub-step (ordinary resumability, no special code), or (b) a FUTURE
 * reconciliation/admin process is built to handle stragglers (Fase 4+,
 * flagged as a pendency below, not solved here).
 */

import type { CallableRequest } from 'firebase-functions/v2/https';

import { requireAuth } from '../../lib/auth';
import type { AccountDeletionStepOutcome } from '../errors';
import type { Uid } from '../types';

/** What the client reports after attempting `GoogleSignin.revokeAccess()` — see `src/services/accountDeletionProviderRevocation.ts`. */
export type GoogleProviderRevocationClientOutcome = 'revoked' | 'not-linked' | 'failed';

/**
 * Wire contract for a FUTURE confirmation callable (not registered in this
 * phase — see Fase 3 report). Deliberately narrow: `deletionId` ties the
 * report to one specific, already-authorized workflow instance; the uid
 * performing the report is `request.auth.uid`, never a field here.
 */
export interface ReportGoogleProviderRevokedRequestData {
  deletionId: string;
  outcome: GoogleProviderRevocationClientOutcome;
}

/**
 * Turns a client-reported outcome into the same `AccountDeletionStepOutcome`
 * shape every other step already reports through — no parallel contract.
 * `'failed'` is deliberately RETRYABLE (`UNAVAILABLE`, the shared code for
 * "the provider/SDK misbehaved transiently") given the documented
 * real-world flakiness of `revokeAccess()` cited above — a single failure
 * is expected to sometimes just be the library, not a permanent condition.
 */
export function deriveGoogleSubStepOutcome(
  outcome: GoogleProviderRevocationClientOutcome,
): AccountDeletionStepOutcome {
  switch (outcome) {
    case 'revoked':
      return { kind: 'SUCCEEDED' };
    case 'not-linked':
      // Defensive — the sub-step should already be SKIPPED_BY_POLICY from
      // record creation (`types.ts`'s `initialProviderRevocationSubState`)
      // if Google was never linked. Handled gracefully in case client/server
      // ever disagree, rather than treated as a contract violation.
      return { kind: 'SKIPPED_BY_POLICY', reason: 'google-not-linked-per-client-report' };
    case 'failed':
      return { kind: 'FAILED', code: 'UNAVAILABLE' };
  }
}

/**
 * Authorization for the FUTURE report callable — deliberately `requireAuth`
 * (ordinary authentication), NOT `requireRecentAuth`. This report is not
 * itself the sensitive action (revoking the Google grant already happened
 * client-side, and creating the deletion request already went through
 * recent-auth in Fase 2) — it is a status update about an
 * ALREADY-authorized, in-flight workflow. Re-demanding recent-auth here
 * would violate Fase 1 report §12's boundary: recent-auth protects
 * REQUEST CREATION, never a subsequent retry/report
 * (`functions/src/accountDeletion/authGuard.ts`'s doc comment states the
 * same principle for the main callable).
 */
export function requireGoogleRevocationReportAuthorization(
  request: Pick<CallableRequest, 'auth'>,
): Uid {
  return requireAuth(request as CallableRequest);
}
