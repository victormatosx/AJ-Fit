import { onRequest } from 'firebase-functions/v2/https';
import {
  handleRevenueCatWebhook,
  REVENUECAT_API_SECRET_KEY,
  REVENUECAT_WEBHOOK_SECRET,
} from './billing/revenuecat';

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
