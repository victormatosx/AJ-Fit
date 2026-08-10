"use strict";
/**
 * Single source of truth for every billing constant used across the backend
 * (docs/13_assinaturas_e_billing.md). No magic strings for statuses,
 * providers, stores, event types, or Firestore paths/field names should
 * appear anywhere else under functions/src/billing/*.
 *
 * `PREMIUM_ENTITLEMENT_ID` is intentionally duplicated on the client
 * (src/services/revenueCatService.ts) — functions/ and the Expo app are two
 * separate deployables with no shared package, and RevenueCatService is
 * explicitly out of scope to touch this Sprint. Both copies derive from the
 * same doc (docs §5) and must be kept in sync manually if that entitlement
 * id ever changes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD = exports.SUBSCRIPTION_LAST_EVENT_ID_FIELD = exports.SUBSCRIPTION_FIELD = exports.USERS_COLLECTION = exports.RC_ANONYMOUS_ID_PREFIX = exports.SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES = exports.REVENUECAT_WEBHOOK_EVENT_TYPES = exports.SUBSCRIPTION_STORES = exports.SUBSCRIPTION_STATUSES = exports.REVENUECAT_PROVIDER = exports.PREMIUM_ENTITLEMENT_ID = void 0;
exports.userDocPath = userDocPath;
/** The single entitlement identifier for this app (docs §5). */
exports.PREMIUM_ENTITLEMENT_ID = 'premium';
/** The only subscription provider this project integrates with (docs §26). */
exports.REVENUECAT_PROVIDER = 'REVENUECAT';
/** Official subscription statuses (docs §12) — a commercial signal, never an authorization one. */
exports.SUBSCRIPTION_STATUSES = [
    'TRIAL',
    'ACTIVE',
    'CANCELED',
    'BILLING_ISSUE',
    'EXPIRED',
];
/** Stores this app sells through (docs §5). */
exports.SUBSCRIPTION_STORES = ['APP_STORE', 'PLAY_STORE'];
/**
 * RevenueCat webhook event types this project recognizes by name (docs §25).
 *
 * `REFUND` was REMOVED in Sprint 4: it does not exist as a standalone
 * RevenueCat webhook event (verified against RevenueCat's official webhook
 * docs — revenuecat.com/docs/integrations/webhooks/event-types-and-fields).
 * Refunds arrive as a `CANCELLATION` event with `cancel_reason` describing
 * why (e.g. `CUSTOMER_SUPPORT`). `docs/13_assinaturas_e_billing.md` §25 was
 * updated to match — see that section for the full explanation. If any
 * analytics need ever have to distinguish "canceled" from "refunded", derive
 * it from `CANCELLATION` + `cancel_reason`, never from a `REFUND` event.
 */
exports.REVENUECAT_WEBHOOK_EVENT_TYPES = [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'CANCELLATION',
    'EXPIRATION',
    'BILLING_ISSUE',
    'PRODUCT_CHANGE',
    'UNCANCELLATION',
    'TRANSFER',
];
/**
 * The subset of `REVENUECAT_WEBHOOK_EVENT_TYPES` this backend actually
 * processes (docs §25, Sprint 4 scope). `UNCANCELLATION`/`TRANSFER` are
 * recognized RevenueCat event names but not acted on yet — they fall
 * through `handleRevenueCatWebhook`'s "recognized but unsupported" path
 * (logged, HTTP 200, no Firestore write), same as any truly unknown type.
 */
exports.SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES = [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'CANCELLATION',
    'EXPIRATION',
    'BILLING_ISSUE',
    'PRODUCT_CHANGE',
];
/** Prefix RevenueCat uses for its own anonymous App User IDs (pre-login activity). */
exports.RC_ANONYMOUS_ID_PREFIX = '$RCAnonymousID:';
/** Firestore collection holding the user documents billing writes into. */
exports.USERS_COLLECTION = 'users';
/** Nested map field on `users/{uid}` this module is exclusively responsible for (docs §25/§26/§27). */
exports.SUBSCRIPTION_FIELD = 'subscription';
/**
 * Sub-field names accessed directly (not via `validateSubscriptionPayload`)
 * by `applySubscriptionEventAtomically`'s transaction (subscriptionSync.ts,
 * Sprint 4.1) when reading the currently-stored mirror to decide
 * duplicate/stale/conflict. Centralized here for the same reason as
 * `SUBSCRIPTION_FIELD` — no hand-typed field-name strings elsewhere.
 */
exports.SUBSCRIPTION_LAST_EVENT_ID_FIELD = 'lastEventId';
exports.SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD = 'lastEventTimestampMs';
/** Path helper so no other module hand-builds `users/${uid}` template strings. */
function userDocPath(uid) {
    return `${exports.USERS_COLLECTION}/${uid}`;
}
//# sourceMappingURL=constants.js.map