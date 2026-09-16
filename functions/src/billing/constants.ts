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

/** The single entitlement identifier for this app (docs §5). */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

/** The only subscription provider this project integrates with (docs §26). */
export const REVENUECAT_PROVIDER = 'REVENUECAT';

/**
 * Public RevenueCat project identifier used only by the server-side V2 API
 * client. This is routing configuration, not a credential; keeping it as a
 * centralized backend constant avoids introducing a second deploy-time
 * parameter for a value that is fixed for this repository.
 */
export const REVENUECAT_PROJECT_ID = 'projde891e34';

/** Official subscription statuses (docs §12) — a commercial signal, never an authorization one. */
export const SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'CANCELED',
  'BILLING_ISSUE',
  'EXPIRED',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Stores this app sells through (docs §5). */
export const SUBSCRIPTION_STORES = ['APP_STORE', 'PLAY_STORE'] as const;

export type SubscriptionStore = (typeof SUBSCRIPTION_STORES)[number];

/**
 * RevenueCat webhook event types this project recognizes by name (docs §25).
 *
 * `REFUND` was REMOVED in Sprint 4: it does not exist as a standalone
 * RevenueCat webhook event (verified against RevenueCat's official webhook
 * docs — revenuecat.com/docs/integrations/webhooks/event-types-and-fields).
 * Refunds arrive as `CANCELLATION` + `cancel_reason=CUSTOMER_SUPPORT`.
 * `REFUND_REVERSED` is a real, separate RevenueCat event and is recognized
 * for the financial ledger without changing the subscription mirror.
 */
export const REVENUECAT_WEBHOOK_EVENT_TYPES = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'TRANSFER',
  'REFUND_REVERSED',
] as const;

export type RevenueCatWebhookEventType = (typeof REVENUECAT_WEBHOOK_EVENT_TYPES)[number];

/**
 * The subset of `REVENUECAT_WEBHOOK_EVENT_TYPES` whose payloads are
 * normalized and written as commercial subscription events. `TRANSFER` is
 * handled separately as an identity signal (never normalized directly),
 * while `UNCANCELLATION` remains acknowledged as unsupported.
 */
export const SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
] as const;

export type SupportedRevenueCatWebhookEventType =
  (typeof SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES)[number];

/** Prefix RevenueCat uses for its own anonymous App User IDs (pre-login activity). */
export const RC_ANONYMOUS_ID_PREFIX = '$RCAnonymousID:';

/** Firestore collection holding the user documents billing writes into. */
export const USERS_COLLECTION = 'users';

/** Nested map field on `users/{uid}` this module is exclusively responsible for (docs §25/§26/§27). */
export const SUBSCRIPTION_FIELD = 'subscription';

/**
 * Dot-path to the initial-Paywall marker this module also resolves (never
 * clears) the first time a webhook event confirms `entitlementActive: true`
 * for a uid — see the `UserProfile.metadata` doc comment in
 * src/services/userProfile.ts for the full null/absent/timestamp semantics.
 * A sibling top-level field to `subscription`, written in the SAME
 * transaction/write as the subscription mirror, never on its own.
 */
export const COMMERCIAL_GATE_RESOLVED_AT_PATH = 'metadata.commercialGateResolvedAt';

/**
 * Sub-field names accessed directly (not via `validateSubscriptionPayload`)
 * by `applySubscriptionEventAtomically`'s transaction (subscriptionSync.ts,
 * Sprint 4.1) when reading the currently-stored mirror to decide
 * duplicate/stale/conflict. Centralized here for the same reason as
 * `SUBSCRIPTION_FIELD` — no hand-typed field-name strings elsewhere.
 */
export const SUBSCRIPTION_LAST_EVENT_ID_FIELD = 'lastEventId';
export const SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD = 'lastEventTimestampMs';

/** Path helper so no other module hand-builds `users/${uid}` template strings. */
export function userDocPath(uid: string): string {
  return `${USERS_COLLECTION}/${uid}`;
}
