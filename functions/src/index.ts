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
import { generateMfaRecoveryCodes } from './mfaRecovery/generateRecoveryCodes';

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
 * `enforceAppCheck` is left at its default (unset/false) for this phase —
 * flipping it to `true` later is a pure function-options change here, with
 * zero change to `validatePromoCodeHandler` or the request/response
 * contract.
 */
export const validatePromoCode = onCall(validatePromoCodeHandler);

/**
 * Creates or idempotently returns the calling uid's short-lived iOS promo
 * purchase intent. The callable accepts only `monthly`/`annual`; campaign,
 * Offering, product ID, status and timestamps are derived transactionally
 * from `couponRedemptions/{uid}` by the backend.
 */
export const authorizePromoPurchase = onCall(authorizePromoPurchaseHandler);

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

// Only authenticated, policy-enforcing Photo Vault callables are exported.
// The KMS wrap/unwrap layer stays internal and has no endpoint of its own.
export { backendHealth, cleanupPhotoVaultOrphans, createVault, recoverVaultKey };

/**
 * Mints a fresh set of MFA recovery codes for the calling user, rotating any
 * previous set (functions/src/mfaRecovery/generateRecoveryCodes.ts).
 *
 * Requires an authenticated caller, authentication no older than 5 minutes,
 * and a TOTP factor already enrolled — recovery codes only exist to replace a
 * second factor the account actually has. The plaintext codes are returned
 * exactly once and are never persisted in any form other than their
 * HMAC-SHA-256 digests; there is deliberately no endpoint that can read them
 * back. `MFA_RECOVERY_PEPPER` is bound at the function definition, so its
 * value materializes only inside this function's runtime.
 *
 * Only GENERATION is exported. Consuming a recovery code and resetting MFA
 * are a later phase and have no endpoint yet — nothing here can remove a
 * second factor or revoke a session.
 *
 * `enforceAppCheck` stays at its default (unset/false), matching every other
 * callable in this file: App Check enforcement is switched on project-wide
 * only after real-device attestation has been validated on both platforms.
 */
export { generateMfaRecoveryCodes };
