/**
 * Example RevenueCat webhook event payloads for local tests (Sprint 4
 * "estratégia de testes locais"). Field names/shapes match RevenueCat's
 * official webhook documentation
 * (revenuecat.com/docs/integrations/webhooks/event-types-and-fields),
 * verified during this Sprint's implementation — not fabricated shapes.
 *
 * Each fixture is the `event` object only (the inner object of the real
 * `{ api_version, event }` webhook envelope) — that's what
 * `normalizeSubscription`/`handleRevenueCatWebhook` work with after
 * unwrapping.
 *
 * `REFUND` deliberately has no dedicated fixture: it is not a real
 * RevenueCat event (confirmed against the official docs during this
 * Sprint — see docs/13_assinaturas_e_billing.md §25). The refund scenario
 * is instead represented by `cancellationRefundEvent`, a `CANCELLATION`
 * event with `cancel_reason: "CUSTOMER_SUPPORT"`.
 */

const UID = 'sample-firebase-uid-123';
const PRODUCT_MONTHLY = 'ajfit_premium_monthly';
const PRODUCT_ANNUAL = 'ajfit_premium_annual';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse('2026-08-04T12:00:00.000Z');

export const initialPurchaseEvent = {
  id: 'evt_initial_purchase_001',
  type: 'INITIAL_PURCHASE',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'TRIAL',
  purchased_at_ms: NOW_MS,
  expiration_at_ms: NOW_MS + 7 * DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
};

export const renewalEvent = {
  id: 'evt_renewal_001',
  type: 'RENEWAL',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  purchased_at_ms: NOW_MS,
  expiration_at_ms: NOW_MS + 30 * DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
  is_trial_conversion: true,
};

export const cancellationVoluntaryEvent = {
  id: 'evt_cancellation_voluntary_001',
  type: 'CANCELLATION',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  // Auto-renewal turned off, but the current paid period has NOT ended yet —
  // access must remain until this date (docs §16).
  expiration_at_ms: NOW_MS + 12 * DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
  cancel_reason: 'UNSUBSCRIBE',
};

/** Represents what used to be modeled as a standalone "REFUND" event — see file header. */
export const cancellationRefundEvent = {
  id: 'evt_cancellation_refund_001',
  type: 'CANCELLATION',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  // A refund typically ends access immediately — RevenueCat reflects this by
  // reporting an expiration at/before the event time, not the original
  // period end.
  expiration_at_ms: NOW_MS - 60 * 1000,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
  cancel_reason: 'CUSTOMER_SUPPORT',
};

export const expirationEvent = {
  id: 'evt_expiration_001',
  type: 'EXPIRATION',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  expiration_at_ms: NOW_MS - DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
  expiration_reason: 'UNSUBSCRIBE',
};

export const billingIssueEvent = {
  id: 'evt_billing_issue_001',
  type: 'BILLING_ISSUE',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  // The original period technically already ended, but Google Play's grace
  // period (docs §17) keeps access alive for a few more days.
  expiration_at_ms: NOW_MS - DAY_MS,
  grace_period_expiration_at_ms: NOW_MS + 6 * DAY_MS,
  store: 'PLAY_STORE',
  entitlement_ids: ['premium'],
};

export const productChangeEvent = {
  id: 'evt_product_change_001',
  type: 'PRODUCT_CHANGE',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY, // old product
  new_product_id: PRODUCT_ANNUAL, // new product
  period_type: 'NORMAL',
  expiration_at_ms: NOW_MS + 365 * DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
};

/** Missing `app_user_id` — used to test "invalid payload" handling. */
export const invalidPayloadMissingAppUserId = {
  id: 'evt_invalid_001',
  type: 'INITIAL_PURCHASE',
  event_timestamp_ms: NOW_MS,
  product_id: PRODUCT_MONTHLY,
};

/** Recognized RevenueCat event name, but not one this backend processes (docs §25 scope). */
export const unsupportedEventTypeEvent = {
  id: 'evt_uncancellation_001',
  type: 'UNCANCELLATION',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  entitlement_ids: ['premium'],
};

/** Cancellation while still in the trial period (docs §15). */
export const cancellationDuringTrialEvent = {
  id: 'evt_cancellation_trial_001',
  type: 'CANCELLATION',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'TRIAL',
  // Trial isn't over yet — access must remain until this date (docs §15).
  expiration_at_ms: NOW_MS + 3 * DAY_MS,
  store: 'APP_STORE',
  entitlement_ids: ['premium'],
  cancel_reason: 'UNSUBSCRIBE',
};

/** PRODUCT_CHANGE without `new_product_id` — RevenueCat omits it for some immediate Google Play changes. */
export const productChangeWithoutNewProductIdEvent = {
  id: 'evt_product_change_002',
  type: 'PRODUCT_CHANGE',
  event_timestamp_ms: NOW_MS,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  period_type: 'NORMAL',
  expiration_at_ms: NOW_MS + 30 * DAY_MS,
  store: 'PLAY_STORE',
  entitlement_ids: ['premium'],
};

/** `event_timestamp_ms` missing entirely. */
export const missingTimestampEvent = {
  id: 'evt_missing_ts_001',
  type: 'RENEWAL',
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  entitlement_ids: ['premium'],
};

/** `event_timestamp_ms` present but not a valid positive integer. */
export const invalidTimestampEvent = {
  id: 'evt_invalid_ts_001',
  type: 'RENEWAL',
  event_timestamp_ms: -5,
  app_user_id: UID,
  product_id: PRODUCT_MONTHLY,
  entitlement_ids: ['premium'],
};

export const SAMPLE_UID = UID;
/** Reference instants for ordering tests (duplicate/stale/conflict/processed). */
export const EARLIER_MS = NOW_MS - DAY_MS;
export const LATER_MS = NOW_MS + DAY_MS;
export { NOW_MS };
