/**
 * `requestAccountDeletion` — Fase 4. The official entry point a future
 * client uses to start "Excluir Conta". This callable ONLY validates the
 * request and durably persists the workflow's `REQUESTED` state — it never
 * touches Firestore user data, Storage, RevenueCat, Apple, Google, or the
 * Firebase Auth user record itself. See docs/25_exclusao_de_conta_arquitetura.md's
 * Fase 4 section for the full architecture this implements.
 *
 * Guard order (Fase 4 §10 — deliberate, not incidental):
 *   1. `validateRequestAccountDeletionPayload` — cheapest possible check
 *      (pure, sync, no I/O), and its outcome is identical regardless of
 *      auth state, so running it first leaks nothing to an unauthenticated
 *      caller that authenticating first wouldn't already reveal via a
 *      different error code.
 *   2. `requireRecentAuth` — the ONLY gate that may allow a NEW workflow to
 *      be created. Internally checks `request.auth` (throws
 *      `unauthenticated` if absent) THEN `request.auth.token.auth_time`
 *      (throws `failed-precondition` if stale) — reusing Fase 2's exact,
 *      already-tested primitive, unmodified.
 *   3. Only after (2) succeeds: resolve the uid's linked providers via
 *      Admin Auth. NOTHING is read or written to
 *      `accountDeletions`/`accountDeletionLocks` before this point.
 *   4. Fase 3/5 CORRECTION (see docs/25_exclusao_de_conta_arquitetura.md's
 *      "Correção Fases 3/5" section): if `apple.com` is linked (per the
 *      SERVER-SIDE snapshot from step 3 — never client-asserted), a fresh
 *      `appleAuthorizationCode` is REQUIRED in the payload and is exchanged
 *      with Apple's own servers, synchronously, right here — BEFORE the
 *      deletion record is created. If Apple's account is Google-only or
 *      password-only, this step does nothing at all (no Apple I/O, no
 *      secret read).
 *   5. Only once (4) has either succeeded or determined it doesn't apply:
 *      open the persistence transaction (`repository.createOrReuse`) —
 *      exactly Fase 4's existing, unmodified logic.
 *   6. After the record durably exists (and only for a BRAND NEW record,
 *      never a deduplicated reuse of an existing one): the refresh token
 *      obtained in step 4 is wrapped and cached
 *      (`appleRevocationPreparation.ts`'s `cacheAppleRevocationMaterial`)
 *      against the real `deletionId`. From this point on,
 *      `PROVIDER_REVOCATION`'s Apple sub-step
 *      (`providerRevocation/appleProviderRevocation.ts`, unmodified by this
 *      correction) can complete WITHOUT the client ever coming back — see
 *      this file's own backend-autonomy integration test.
 *
 * GOOGLE — deliberately NOT mirrored here (Fase 3/5 correction's other
 * half, entirely CLIENT-side): `GoogleSignin.revokeAccess()` has no backend
 * equivalent this app can call (Fase 3's own researched conclusion,
 * unchanged). The fix is ordering, not a new backend call: the client is
 * now expected to revoke access AND unlink `google.com` from the Firebase
 * Auth user (a standard client SDK call) BEFORE ever calling
 * `requestAccountDeletion()` — see
 * `src/services/accountDeletionOrchestrator.ts`. By the time THIS
 * handler's existing `admin.auth().getUser(uid).providerData` snapshot
 * (step 3, Fase 4's own pre-existing logic, unmodified) runs, a
 * successfully-unlinked Google account no longer appears there at all —
 * `initialProviderRevocationSubState` (Fase 3, unmodified) already treats
 * "not linked" as `SKIPPED_BY_POLICY` at record-creation time. No client
 * boolean is ever trusted; the proof is the server's OWN read of
 * `providerData`, exactly the same authority Apple's linked/not-linked
 * status already used before this correction.
 */

import { randomUUID } from 'node:crypto';

import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

import { requireRecentAuth } from '../lib/auth';
import { auth as adminAuth } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { classifyErrorCode } from './errors';
import { currentPolicy } from './policy';
import {
  APPLE_KEY_ID,
  APPLE_NATIVE_CLIENT_ID,
  APPLE_PRIVATE_KEY,
  APPLE_TEAM_ID,
  AppleRevocationPreparationError,
  cacheAppleRevocationMaterial,
  createAppleIdentityClient,
  exchangeAppleAuthorizationCode,
  PROVIDER_IDS,
  type AppleIdentityClient,
} from './providerRevocation';
import type { ProviderId } from './providerRevocation/types';
import {
  AccountDeletionRepositoryError,
  FirestoreAccountDeletionRepository,
  type AccountDeletionRepository,
} from './repository';
import {
  InvalidRequestPayloadError,
  validateRequestAccountDeletionPayload,
  type RequestAccountDeletionRequestData,
  type RequestAccountDeletionResponseData,
} from './requestContract';

/**
 * Cloud Functions v2 secret bindings this callable needs — bound in
 * `index.ts`, mirroring `revenueCatWebhook`'s pattern. `APPLE_SERVICES_CLIENT_ID`
 * is deliberately NOT bound here — nothing on this native-only path reads it
 * (Fase 15: see `appleIdentityConfig.ts`'s doc comment on native vs. services
 * client_id).
 */
export const REQUEST_ACCOUNT_DELETION_SECRETS = [
  APPLE_TEAM_ID,
  APPLE_KEY_ID,
  APPLE_NATIVE_CLIENT_ID,
  APPLE_PRIVATE_KEY,
];

const SCOPE = 'accountDeletion.requestAccountDeletion';

/**
 * Minimizes what's read off the Admin Auth user record (Fase 4 §40): only
 * the boolean "is this provider linked" facts the workflow needs, never
 * email/displayName/photoURL/provider-specific uid.
 */
function resolveLinkedProviders(providerData: readonly { providerId: string }[]): ProviderId[] {
  const linked = new Set(providerData.map((p) => p.providerId));
  return PROVIDER_IDS.filter((id) => linked.has(id));
}

/**
 * Maps an Apple exchange failure to the HttpsError the client should act on
 * — Fase 15 incident fix: this used to collapse into the SAME
 * `failed-precondition` code `requireRecentAuth` uses for a genuinely stale
 * session, which the client then (reasonably, given that single signal)
 * displayed as "your session expired" — actively misleading for an Apple
 * config/exchange problem that redoing Firebase reauth can never fix. Three
 * DISTINCT codes now leave here, none of them `failed-precondition`/
 * `unauthenticated` (those stay reserved for `requireRecentAuth`, above):
 *   - RETRYABLE (network/5xx/timeout) -> `unavailable`, unchanged.
 *   - `MISSING_REQUIRED_CONFIGURATION` (Apple rejected client_id/client_secret
 *     itself — e.g. `invalid_client`) -> `internal`. This is OUR
 *     configuration, never the user's session; the client already renders
 *     `internal` as a generic "try again" without implying reauth is needed.
 *   - Any other TERMINAL code (e.g. an expired/already-used authorizationCode)
 *     -> `aborted`. The SAME code can never succeed on retry, but capturing a
 *     FRESH one (still on THIS Firebase session — no Firebase reauth
 *     required) can; the client surfaces this as its own
 *     "could not validate with Apple" message, never as a session issue.
 */
function httpsErrorForAppleFailure(error: AppleRevocationPreparationError): HttpsError {
  const classification = classifyErrorCode(error.code);
  if (classification === 'RETRYABLE') {
    return new HttpsError('unavailable', 'Could not reach Apple. Please try again.');
  }
  if (error.code === 'MISSING_REQUIRED_CONFIGURATION') {
    return new HttpsError('internal', 'Apple sign-in is temporarily unavailable. Please try again later.');
  }
  return new HttpsError('aborted', 'Could not validate with Apple. Please try again.');
}

export async function handleRequestAccountDeletion(
  request: CallableRequest,
  repository: AccountDeletionRepository = new FirestoreAccountDeletionRepository(),
  deps: { appleIdentityClient?: Pick<AppleIdentityClient, 'exchangeAuthorizationCode'> } = {},
): Promise<RequestAccountDeletionResponseData> {
  try {
    validateRequestAccountDeletionPayload(request.data);
  } catch (error) {
    if (error instanceof InvalidRequestPayloadError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw error;
  }
  const payload = (request.data ?? {}) as RequestAccountDeletionRequestData;

  // Auth + recent-auth. Nothing above this line reads or writes any part of
  // the workflow. `requireRecentAuth` throws `unauthenticated` when
  // `request.auth` is absent, and `failed-precondition` when
  // `request.auth.token.auth_time` is missing/stale — both already
  // exhaustively tested in `functions/src/__tests__/auth.test.ts`.
  //
  // Investigation note (email/password reauth loop report): `requireRecentAuth`
  // itself never logged WHY it rejected a request, which made a reported
  // "keeps asking for the password" loop unfalsifiable from Cloud Logging
  // alone — see the account-deletion password-reauth audit. This log line is
  // scoped to THIS call site only (never the shared `requireRecentAuth`, used
  // elsewhere e.g. Photo Vault) and never logs anything beyond what's already
  // safe to log elsewhere in this file (uid, timing, provider) — no token,
  // no credential, no password.
  let uid: string;
  try {
    uid = requireRecentAuth(request);
  } catch (error) {
    const authTime = request.auth?.token?.auth_time;
    const firebaseClaim = request.auth?.token?.firebase as { sign_in_provider?: unknown } | undefined;
    logWarn(SCOPE, 'requireRecentAuth rejected requestAccountDeletion', {
      uid: request.auth?.uid ?? null,
      hasAuthTime: typeof authTime === 'number',
      ageSeconds: typeof authTime === 'number' ? Math.round(Date.now() / 1000 - authTime) : null,
      signInProvider: typeof firebaseClaim?.sign_in_provider === 'string' ? firebaseClaim.sign_in_provider : null,
    });
    throw error;
  }
  const authTimeSeconds =
    typeof request.auth?.token?.auth_time === 'number' ? request.auth.token.auth_time : 0;

  let providerData: readonly { providerId: string }[];
  try {
    const user = await adminAuth.getUser(uid);
    providerData = user.providerData;
  } catch (error) {
    // A uid the platform just verified via a valid ID token failing
    // `getUser` is an inconsistency worth its own log line (Fase 4 §55),
    // not a generic transient failure blindly retried by the client.
    logFunctionError(SCOPE, error, { uid });
    throw new HttpsError('internal', 'Could not verify account details. Please try again.');
  }
  const linkedProviders = resolveLinkedProviders(providerData);

  // Fase 3/5 CORRECTION — gate BEFORE any deletion record exists. Apple
  // linkage is the SERVER's own read above, never `payload`; a caller
  // cannot avoid this by omitting/lying about the field for an account
  // that actually has `apple.com` linked.
  let appleRefreshToken: string | null = null;
  if (linkedProviders.includes('apple.com')) {
    if (!payload.appleAuthorizationCode) {
      throw new HttpsError(
        'failed-precondition',
        'This account has Apple Sign In linked — a fresh Apple authorization is required to delete it.',
      );
    }
    try {
      appleRefreshToken = await exchangeAppleAuthorizationCode(payload.appleAuthorizationCode, {
        client: deps.appleIdentityClient ?? createAppleIdentityClient('native'),
      });
    } catch (error) {
      if (error instanceof AppleRevocationPreparationError) {
        // `appleErrorClass`, never `code` — `lib/logger.ts`'s `sanitizeLogContext`
        // blanket-redacts any context field literally named `code` (it
        // exists to keep a promo/coupon `code` out of logs) to `[redacted]`,
        // which silently destroyed this exact diagnostic during the Fase 15
        // incident. `error.code` is a closed, non-sensitive
        // `KnownErrorCode` enum value (`errors.ts`) — safe to log under a
        // name the blanket rule doesn't match.
        logWarn(SCOPE, 'apple authorization exchange failed — deletion not accepted', {
          uid,
          appleErrorClass: error.code,
        });
        throw httpsErrorForAppleFailure(error);
      }
      throw error;
    }
  }

  const policy = currentPolicy();
  // Pre-generated OUTSIDE the transaction: if the transaction internally
  // retries on contention (Firestore's own optimistic-concurrency retry),
  // the SAME candidate id is reused across those retries, which is correct
  // — it's still resolving one logical create attempt. It is only ever
  // actually persisted if the transaction determines no operation exists
  // yet for this uid (`concurrency.ts`'s `resolveDeletionRequest`).
  const candidateDeletionId = randomUUID();
  const now = Date.now();

  let result;
  try {
    result = await repository.createOrReuse({
      uid,
      candidateDeletionId,
      policy,
      linkedProviders,
      requestMetadata: {
        // Fase 4 §60/§61: never queried from RevenueCat — an active
        // subscription is irrelevant to whether this request is accepted.
        // `null` here (rather than a value) is the honest representation of
        // "the backend never asked".
        subscriptionActiveAtRequest: null,
        requestAuthTimeSeconds: authTimeSeconds,
      },
      now,
    });
  } catch (error) {
    logFunctionError(SCOPE, error, {
      uid,
      kind: error instanceof AccountDeletionRepositoryError ? 'REPOSITORY_INCONSISTENCY' : 'UNKNOWN',
    });
    throw new HttpsError('internal', 'Could not process the account deletion request. Please try again.');
  }

  logInfo(SCOPE, result.deduplicated ? 'request deduplicated' : 'request created', {
    uid,
    workflowVersion: result.record.workflowVersion,
    status: result.record.status,
    deduplicated: result.deduplicated,
    appleLinked: linkedProviders.includes('apple.com'),
    googleLinked: linkedProviders.includes('google.com'),
  });

  // Fase 3/5 CORRECTION — cache the already-exchanged refresh token against
  // the REAL deletionId now that the record durably exists. Only for a
  // brand-new record: a deduplicated reuse means an operation for this uid
  // already exists (with its own, possibly-already-resolved Apple
  // sub-step) — the freshly-exchanged token has no home to go to and is
  // simply discarded (the authorizationCode was already spent regardless;
  // a documented, harmless inefficiency, never a correctness issue — see
  // this file's own doc comment).
  if (appleRefreshToken !== null && !result.deduplicated) {
    const { cached } = await cacheAppleRevocationMaterial(result.record.deletionId, appleRefreshToken);
    if (!cached) {
      // Rare degraded path (Fase 3/5 correction, same reasoning as
      // appleProviderRevocation.ts's own note): the deletion is still
      // accepted — VAULT_KEY_DESTRUCTION and every other step remain fully
      // backend-autonomous regardless — but the Apple sub-step will need a
      // fresh authorizationCode captured again before it can complete.
      logFunctionError(
        SCOPE,
        new Error('failed to cache Apple revocation material after record creation'),
        { uid, deletionId: result.record.deletionId },
      );
    }
  }

  if (result.blockedTerminalFailure) {
    logFunctionError(SCOPE, new Error('existing operation is FAILED_TERMINAL — reconciliation required'), {
      uid,
    });
  }

  return {
    deletionId: result.record.deletionId,
    status: result.record.status,
    accepted: true,
    deduplicated: result.deduplicated,
    requiresReconciliation: result.blockedTerminalFailure,
  };
}

export const requestAccountDeletion = onCall(
  { secrets: REQUEST_ACCOUNT_DELETION_SECRETS, enforceAppCheck: true },
  (request: CallableRequest) => handleRequestAccountDeletion(request),
);
