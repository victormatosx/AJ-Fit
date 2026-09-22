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
import { adminGrantFreeAccessHandler, adminRevokeFreeAccessHandler } from './adminUsers/adminFreeAccess';
import { REVENUECAT_ADMIN_GRANTS_API_KEY } from './billing/revenueCatGrants';
import { adminGetCouponHandler, adminListCouponsHandler } from './adminCoupons/adminCoupons';
import { recordWorkoutLifecycleTelemetryHandler } from './telemetry/workoutLifecycleTelemetry';
import { onTrustedWorkoutLifecycleEventCreated } from './telemetry/trustedWorkoutLifecycleTelemetry';
import { authorizeWorkoutLifecycleMutationHandler, initializeWorkoutProgramV127Handler } from './workoutLifecycle/authorizeMutation';
import { applyExerciseSubstitutionHandler } from './workoutLifecycle/exerciseSubstitution';
import { completeWorkoutCardioHandler } from './workoutLifecycle/completeWorkoutCardio';
import { finalizeWorkoutSessionHandler } from './workoutLifecycle/finalizeWorkoutSession';
import {
  releasePushDeviceHandler,
  syncPushDeviceHandler,
} from './pushDevices/pushDeviceRegistration';
import { dispatchTestNotificationHandler } from './notifications/qaDispatch';
import { reconcileNotificationReceipts } from './notifications/receiptsReconciler';
import { retryNotificationDispatches } from './notifications/retryScheduler';
import { evaluateDailyWorkoutNotifications } from './notifications/dailyScheduler';
import {
  adminCloseSupportChatHandler,
  adminGetSupportAttachmentAccessHandler,
  adminPrepareSupportAttachmentUploadHandler,
  adminReplyAndCloseSupportCaseHandler,
  adminSendSupportChatMessageHandler,
  adminStartSupportChatHandler,
  createSupportCaseHandler,
  getSupportAttachmentAccessHandler,
  markSupportMessageReadHandler,
  prepareSupportAttachmentUploadHandler,
  sendSupportChatMessageHandler,
} from './supportV2/supportV2';
import { cleanupSupportV2 } from './supportV2/cleanup';
import {
  adminClaimSupportCaseHandler,
  adminListSupportAgentsHandler,
  adminReleaseSupportCaseHandler,
  adminTransferSupportCaseHandler,
} from './supportV2/supportAssignment';

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
 * Fase 15 — the ONE-CALL, fully backend-persisted path for a brand-new
 * account's very first v1.27 program (`authorizeMutation.ts`'s
 * `initializeWorkoutProgramV127Handler` doc comment has the full
 * architecture rationale). Generates, safety-validates, and persists the
 * entire lifecycle bootstrap (workoutPrograms/programInstances/
 * trainingCycles/workoutLifecycleState/workoutLifecycleEvents/
 * workoutProgramState) via the Admin SDK in one call — the client never
 * writes any of these documents directly for this case. Falls back
 * transparently (client-side) to the existing `authorizeWorkoutLifecycleMutation`
 * grant flow whenever it does not apply (MIGRATE, ADAPT, v2, or an already-
 * initialized lifecycle).
 */
export const initializeWorkoutProgramV127 = onCall(
  { enforceAppCheck: true },
  initializeWorkoutProgramV127Handler,
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

/**
 * Cardio Finisher completion (Cardio Finisher Completion Recovery
 * hardening, Architecture B — 2026-09 security audit). Performs the ENTIRE
 * write to `WorkoutExecution.cardio` via the Admin SDK inside a
 * transaction — Firestore Rules deny the client from ever writing that
 * field directly (`firestore.rules`'s `workoutExecutions` create/update
 * rules), so this callable is the only way it is ever set.
 */
export const completeWorkoutCardio = onCall(
  { enforceAppCheck: true },
  completeWorkoutCardioHandler,
);

/** Atomic durable boundary for cardio (when prescribed), Execution and Schedule. */
export const finalizeWorkoutSession = onCall(
  { enforceAppCheck: true },
  finalizeWorkoutSessionHandler,
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

/**
 * Administrative "free Premium access" surface (docs: Acesso Premium
 * Gratuito Administrativo). `requireAdminUid` re-verifies the caller on
 * every invocation (see `attribution/adminAuth.ts`); the target uid always
 * comes from `request.data`, the acting admin always from
 * `request.auth.uid` (adminFreeAccess.ts never trusts a caller-supplied
 * admin identity).
 *
 * `REVENUECAT_ADMIN_GRANTS_API_KEY` is bound here — a DEDICATED Secret API
 * Key ("AJ Fit Administrative Grants", API Version V1 in the RevenueCat
 * dashboard), separate from `REVENUECAT_API_SECRET_KEY` (the V2 key
 * `revenueCatWebhook`/`RevenueCatV2Client` use for read-only calls). Only
 * these two callables depend on it; `billing/revenueCatGrants.ts` reads it
 * exclusively. This key never reaches `ajfit-admin` or the mobile client.
 *
 * App Check is intentionally NOT enabled here yet: `ajfit-admin` has no
 * App Check provider configured client-side today (verified — no
 * `initializeAppCheck` call anywhere in that repo), so enforcing it would
 * reject every call from the panel outright. This mirrors the existing gap
 * on every other `adminX` callable in this file and is called out as a
 * known security debt item in the feature's audit report, not silently
 * fixed here (which would be a behavior change outside this task's scope).
 */
export const adminGrantFreeAccess = onCall(
  { secrets: [REVENUECAT_ADMIN_GRANTS_API_KEY] },
  adminGrantFreeAccessHandler,
);
export const adminRevokeFreeAccess = onCall(
  { secrets: [REVENUECAT_ADMIN_GRANTS_API_KEY] },
  adminRevokeFreeAccessHandler,
);

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

/** Support V2: client mutations are authenticated, attested and backend-authoritative. */
export const prepareSupportAttachmentUpload = onCall(
  { enforceAppCheck: true },
  prepareSupportAttachmentUploadHandler,
);
export const createSupportCase = onCall(
  { enforceAppCheck: true },
  createSupportCaseHandler,
);
export const sendSupportChatMessage = onCall(
  { enforceAppCheck: true },
  sendSupportChatMessageHandler,
);
export const markSupportMessageRead = onCall(
  { enforceAppCheck: true },
  markSupportMessageReadHandler,
);
export const getSupportAttachmentAccess = onCall(
  { enforceAppCheck: true },
  getSupportAttachmentAccessHandler,
);

// Admin Web does not have App Check configured yet; every handler performs a
// fresh server-side role check. Enable enforcement only after a web provider
// is rolled out, otherwise the existing panel would be locked out.
export const adminReplyAndCloseSupportCase = onCall(adminReplyAndCloseSupportCaseHandler);
export const adminStartSupportChat = onCall(adminStartSupportChatHandler);
export const adminCloseSupportChat = onCall(adminCloseSupportChatHandler);
export const adminSendSupportChatMessage = onCall(adminSendSupportChatMessageHandler);
export const adminGetSupportAttachmentAccess = onCall(adminGetSupportAttachmentAccessHandler);
// Admin Web's own attachment-staging entry point: the mobile
// prepareSupportAttachmentUpload above requires App Check, which Admin Web
// cannot present, so Admin Web must never call it directly. This mirrors it
// exactly (same stageSupportAttachmentUpload) but is authorized by
// requireAdminUid's server-side admin-role check instead.
export const adminPrepareSupportAttachmentUpload = onCall(adminPrepareSupportAttachmentUploadHandler);
export const adminClaimSupportCase = onCall(adminClaimSupportCaseHandler);
export const adminReleaseSupportCase = onCall(adminReleaseSupportCaseHandler);
export const adminTransferSupportCase = onCall(adminTransferSupportCaseHandler);
export const adminListSupportAgents = onCall(adminListSupportAgentsHandler);

// Push for admin-sent Support V2 messages — deliberately NOT awaited inside
// the callables above (perf audit, 2026-09-17). Fires once the message
// document itself durably commits; see supportV2Triggers.ts for why this
// cannot double-send on idempotent retries.
export { onSupportAdminMessageCreated } from './supportV2/supportV2Triggers';

export { cleanupSupportV2 };

export {
  evaluateDailyWorkoutNotifications,
  reconcileNotificationReceipts,
  retryNotificationDispatches,
};
