"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revenueCatWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const revenuecat_1 = require("./billing/revenuecat");
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
 * `secrets: [REVENUECAT_WEBHOOK_SECRET]` makes the signing secret available
 * to the function at runtime via Secret Manager — must be set once with
 * `firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET` before deploy.
 *
 * NOT yet registered as a webhook URL in the RevenueCat dashboard — that
 * activation step is deliberately manual/human, after this deploys and the
 * secret is confirmed configured.
 */
exports.revenueCatWebhook = (0, https_1.onRequest)({ secrets: [revenuecat_1.REVENUECAT_WEBHOOK_SECRET] }, revenuecat_1.handleRevenueCatWebhook);
//# sourceMappingURL=index.js.map