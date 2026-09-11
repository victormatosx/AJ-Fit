import { onCall, onRequest } from 'firebase-functions/v2/https';
import {
  handleRevenueCatWebhook,
  REVENUECAT_API_SECRET_KEY,
  REVENUECAT_WEBHOOK_SECRET,
} from './billing/revenuecat';
import {
  adminCreatePromoCodeHandler,
  adminListPromoCodesHandler,
  adminSetPromoCodeActiveHandler,
  adminUpdatePromoCodeHandler,
} from './attribution/promoCodeAdmin';
import { validatePromoCodeHandler } from './attribution/validatePromoCode';
import { authorizePromoPurchaseHandler } from './attribution/authorizePromoPurchase';
import { backendHealth } from './health/backendHealth';
import { createVault } from './photoVault/createVault';
import { recoverVaultKey } from './photoVault/recoverVaultKey';
import { cleanupPhotoVaultOrphans } from './photoVault/cleanupOrphans';
import { confirmCommercialGate } from './billing/confirmCommercialGate';
import { requestAccountDeletion } from './accountDeletion/requestAccountDeletion';
import { cleanupPendingAccountDeletions } from './accountDeletion/reconciliation/scheduler';
import { onAccountDeletionRequested } from './accountDeletion/immediateDispatch';
import { adminGetUserHandler, adminListUsersHandler } from './adminUsers/adminUsers';
import { adminGetCouponHandler, adminListCouponsHandler } from './adminCoupons/adminCoupons';
import { recordWorkoutLifecycleTelemetryHandler } from './telemetry/workoutLifecycleTelemetry';
import { onTrustedWorkoutLifecycleEventCreated } from './telemetry/trustedWorkoutLifecycleTelemetry';
import { authorizeWorkoutLifecycleMutationHandler } from './workoutLifecycle/authorizeMutation';
import { applyExerciseSubstitutionHandler } from './workoutLifecycle/exerciseSubstitution';
import {
  releasePushDeviceHandler,
  syncPushDeviceHandler,
} from './pushDevices/pushDeviceRegistration';
import { dispatchTestNotificationHandler } from './notifications/qaDispatch';
import { reconcileNotificationReceipts } from './notifications/receiptsReconciler';
import { retryNotificationDispatches } from './notifications/retryScheduler';
import { evaluateDailyWorkoutNotifications } from './notifications/dailyScheduler';

/**
 * AJ Fit Cloud Functions entry point.
 *
 * Every exported Cloud Function is wired here; the implementation itself
 * lives in its own module. Billing/promotion handlers and Photo Vault/KMS
 * callables intentionally share this single deployment entry point.
 */

/**
 * RevenueCat webhook endpoint (docs/13_assinaturas_e_billing.md §25/§28).
 * Real processing implemented in Sprint 4 — see handleRevenueCatWebhook's
 * JSDoc (billing/revenuecat.ts) for the full flow.
 *
 * Both `REVENUECAT_WEBHOOK_SECRET` (HMAC verification) and
 * `REVENUECAT_API_SECRET_KEY` (server-side V2 identity + TRANSFER
 * reconciliation) are explicitly bound through Secret Manager. Their
 * values never enter client code.
 *
 * NOT yet registered as a webhook URL in the RevenueCat dashboard — that
 * activation step is deliberately manual/human, after this deploys and the
 * secret is confirmed configured.
 */
export const revenueCatWebhook = onRequest(
  { secrets: [REVENUECAT_WEBHOOK_SECRET, REVENUECAT_API_SECRET_KEY] },
  handleRevenueCatWebhook,
);

/**
 * Validates a promo/influencer code and applies (or swaps, while pending)
 * the calling user's attribution (docs/13_assinaturas_e_billing.md §8/§33/
 * §34 — see `attribution/validatePromoCode.ts` for the full flow, and
 * `attribution/constants.ts`'s doc comment on `COUPON_REDEMPTIONS_COLLECTION`
 * for the one deviation from §33 this introduces).
 *
 * App Check is enforced as an additional caller-attestation layer. The
 * handler's Auth, authorization and request/response contract stay unchanged.
 */
export const validatePromoCode = onCall(
  { enforceAppCheck: true },
  validatePromoCodeHandler,
);

/**
 * Creates or idempotently returns the calling uid's short-lived iOS promo
 * purchase intent. The callable accepts only `monthly`/`annual`; campaign,
 * Offering, product ID, status and timestamps are derived transactionally
 * from `couponRedemptions/{uid}` by the backend.
 */
export const authorizePromoPurchase = onCall(
  { enforceAppCheck: true },
  authorizePromoPurchaseHandler,
);

/** PII-free operational lifecycle telemetry, authenticated and attested. */
export const recordWorkoutLifecycleTelemetry = onCall(
  { enforceAppCheck: true },
  recordWorkoutLifecycleTelemetryHandler,
);

/** Short-lived, one-operation authority grant for semantically validated lifecycle mutations. */
export const authorizeWorkoutLifecycleMutation = onCall(
  { enforceAppCheck: true },
  authorizeWorkoutLifecycleMutationHandler,
);

/**
 * Manual exercise substitution during an active workout (exercise-
 * substitution architecture audit). Performs the ENTIRE write via the Admin
 * SDK inside a transaction — the client never writes `exercises[].exerciseId`/
 * `substitution` directly, so a compromised client can never apply a
 * candidate the manual resolver would reject.
 */
export const applyExerciseSubstitution = onCall(
  { enforceAppCheck: true },
  applyExerciseSubstitutionHandler,
);

/** Trusted operational projection sourced only from the immutable backend-authoritative domain ledger. */
export { onTrustedWorkoutLifecycleEventCreated };

/**
 * Admin promo-code catalog surface (`ajfit-admin`'s "Cupons e Campanhas"
 * page). `firestore.rules`'s `promoCodes` block stays `allow read, write:
 * if false` for every client — these four callables are the ONLY way the
 * catalog is ever read or written, mirroring `validatePromoCode` above:
 * Admin SDK server-side, never a client-side Firestore read/write. Every
 * handler independently re-verifies `users/{uid}.metadata.role === 'admin'`
 * via `attribution/adminAuth.ts`'s `requireAdminUid` — the client's own
 * route guard/UI state is never trusted.
 *
 * See `attribution/promoCodeAdmin.ts` for the full contract (allowlisted
 * fields, create/update/activate split, and why `couponRedemptions` is
 * never touched here).
 */
export const adminListPromoCodes = onCall(adminListPromoCodesHandler);
export const adminCreatePromoCode = onCall(adminCreatePromoCodeHandler);
export const adminUpdatePromoCode = onCall(adminUpdatePromoCodeHandler);
export const adminSetPromoCodeActive = onCall(adminSetPromoCodeActiveHandler);

/**
 * Read-only user-management surface for ajfit-admin. Firestore Rules remain
 * owner-only for users: every request is authorized again on the backend and
 * reads Auth/Firestore through the Admin SDK. No mutation endpoint is exposed.
 */
export const adminListUsers = onCall(adminListUsersHandler);
export const adminGetUser = onCall(adminGetUserHandler);

/** Commercial intelligence over the existing promo attribution + subscription mirrors. */
export const adminListCoupons = onCall(adminListCouponsHandler);
export const adminGetCoupon = onCall(adminGetCouponHandler);

// Only authenticated, policy-enforcing Photo Vault callables are exported.
// The KMS wrap/unwrap layer stays internal and has no endpoint of its own.
export { backendHealth, cleanupPhotoVaultOrphans, createVault, recoverVaultKey };

/**
 * Synchronous, server-authoritative second line of defense for
 * `metadata.commercialGateResolvedAt` (the initial-Paywall marker) —
 * complements (never replaces) `revenueCatWebhook`'s async resolution. See
 * `billing/confirmCommercialGate.ts`'s module doc comment for the full
 * security model. The client only requests a revalidation of ITS OWN uid
 * (`request.auth.uid`); this callable independently re-derives entitlement
 * from RevenueCat's V2 API before writing anything.
 */
export { confirmCommercialGate };

/**
 * "Excluir Conta" — Fase 4 of docs/25_exclusao_de_conta_arquitetura.md.
 * Requires recent-auth (same guard/window as `recoverVaultKey`) and ONLY
 * persists the workflow's `REQUESTED` state, atomically deduplicated per
 * uid — it never touches Firestore user data, Storage, RevenueCat, Apple,
 * Google, or the Firebase Auth user record itself. The destructive worker
 * that actually executes the eight workflow steps does not exist yet
 * (Fase 5+) — see the Fase 4 report for the full boundary this callable
 * does and does not cross.
 */
export { requestAccountDeletion };

/**
 * "Excluir Conta" reconciliation worker — Fase 14 of
 * docs/25_exclusao_de_conta_arquitetura.md. Second line of defense: a
 * scheduled sweep that finds any `AccountDeletionRecord` interrupted by a
 * crash/timeout/network failure/process kill and continues it to a known
 * terminal state, using ONLY the existing state machine, retry/backoff and
 * step executors (Fase 1-13) — never a re-derivation of any of them. Acts
 * exclusively on the `accountDeletions` control plane; never infers deletion
 * intent from the absence of a resource elsewhere. See
 * `accountDeletion/reconciliation/scheduler.ts` for the frequency/batch/
 * timeout justification.
 */
export { cleanupPendingAccountDeletions };

/**
 * "Excluir Conta" immediate dispatch — Fase 15 of
 * docs/25_exclusao_de_conta_arquitetura.md. Fires exactly once per real new
 * `accountDeletions/{deletionId}` document (Firestore `onDocumentCreated`,
 * never on the deduplicated-reuse path), calling the SAME
 * `processAccountDeletionRecord` engine as `cleanupPendingAccountDeletions`.
 * `cleanupPendingAccountDeletions` remains the unconditional 15-minute
 * fallback/reconciler — this only removes the up-to-15-minute wait for the
 * NORMAL case where nothing fails. See
 * `accountDeletion/immediateDispatch.ts` for the full commit-boundary and
 * concurrency reasoning.
 */
export { onAccountDeletionRequested };

/**
 * Push foundation callables. Sync requires Auth; release additionally supports
 * the narrow post-logout installation-proof capability. App Check is enforced
 * for both paths.
 */
export const syncPushDevice = onCall(
  { enforceAppCheck: true },
  syncPushDeviceHandler,
);
export const releasePushDevice = onCall(
  { enforceAppCheck: true },
  releasePushDeviceHandler,
);

/**
 * Canonical-copy, self-targeted internal QA preview. Authorization requires
 * the narrow `pushQa` claim or the existing admin role. This is not a general
 * notification API and accepts no target, title, body, category or data.
 */
export const dispatchTestNotification = onCall(
  { enforceAppCheck: true },
  dispatchTestNotificationHandler,
);

export {
  evaluateDailyWorkoutNotifications,
  reconcileNotificationReceipts,
  retryNotificationDispatches,
};
