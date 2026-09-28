/**
 * RevenueCat is the sole authority on whether a financial event originated
 * from the App Store/Play Store sandbox or from real payment processing —
 * the backend NEVER infers this from the user, the app build, or any other
 * signal. `event.environment` on every RevenueCat webhook payload is exactly
 * `'PRODUCTION'` or `'SANDBOX'` (confirmed against the live payload shape in
 * `__tests__/fixtures.ts`). Anything else (missing, malformed, a value
 * RevenueCat hasn't documented) fails closed to `'UNKNOWN'` — it must never
 * silently become `'PRODUCTION'`, because that is exactly the contamination
 * this module exists to prevent.
 */

import type { Firestore, Query } from 'firebase-admin/firestore';

/** Owns this constant (moved from `subscriptionTransactions.ts`) to avoid a circular import; re-exported there for existing callers. */
export const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscriptionTransactions';

export const REVENUECAT_WEBHOOK_ENVIRONMENTS = ['PRODUCTION', 'SANDBOX', 'UNKNOWN'] as const;
export type RevenueCatWebhookEnvironment = (typeof REVENUECAT_WEBHOOK_ENVIRONMENTS)[number];

/** Fails closed to `'UNKNOWN'` — never guesses `'PRODUCTION'` from an absent/malformed value. */
export function normalizeRevenueCatEnvironment(value: unknown): RevenueCatWebhookEnvironment {
  if (value === 'PRODUCTION' || value === 'SANDBOX') return value;
  return 'UNKNOWN';
}

/**
 * The one sanctioned way to query `subscriptionTransactions` for real
 * revenue. Every commercial metric (MRR, ARR, conversion, churn, LTV,
 * coupon/influencer revenue, ...) must build on this query, never a bare
 * `.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION)` — a SANDBOX or
 * UNKNOWN row must never reach a production financial report by omission.
 */
export function productionSubscriptionTransactionsQuery(db: Firestore): Query {
  return db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).where('environment', '==', 'PRODUCTION');
}
