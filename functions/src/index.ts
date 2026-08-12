import { onCall, onRequest } from 'firebase-functions/v2/https';
import {
  handleRevenueCatWebhook,
  REVENUECAT_API_SECRET_KEY,
  REVENUECAT_WEBHOOK_SECRET,
} from './billing/revenuecat';
import { validatePromoCodeHandler } from './attribution/validatePromoCode';

/**
 * AJ Fit Cloud Functions entry point.
 *
 * Every exported Cloud Function is wired here; the implementation itself
 * lives in its own module (docs/05_desenvolvimento_backend_modulo.md lists
 * the planned modules — billing is the first one implemented).
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
