import { isoDate, resolveSubscriptionPlan, safeBoolean, safeString } from '../adminUsers/presentation';

export type CouponSubscriptionState =
  | 'TRIAL'
  | 'ACTIVE'
  | 'CANCELS_AT_PERIOD_END'
  | 'BILLING_ISSUE'
  | 'EXPIRED'
  | 'UNKNOWN';

export interface CouponJourneyRecord {
  uid: string;
  couponCode: string | null;
  campaignId: string | null;
  influencerId: string | null;
  appliedAt: string | null;
  trialStartedAt: string | null;
  convertedAt: string | null;
  lockedAt: string | null;
  subscription: {
    status: string | null;
    entitlementActive: boolean | null;
    productId: string | null;
    plan: 'monthly' | 'annual' | 'unknown';
    store: string | null;
    startedAt: string | null;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    canceledAt: string | null;
    lastRenewedAt: string | null;
  };
  state: CouponSubscriptionState;
}

function objectMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveCouponSubscriptionState(
  status: string | null,
  entitlementActive: boolean | null,
): CouponSubscriptionState {
  if (status === 'TRIAL' && entitlementActive === true) return 'TRIAL';
  if (status === 'CANCELED' && entitlementActive === true) return 'CANCELS_AT_PERIOD_END';
  if (status === 'BILLING_ISSUE') return 'BILLING_ISSUE';
  if (status === 'EXPIRED' || (status === 'CANCELED' && entitlementActive === false)) return 'EXPIRED';
  if (status === 'ACTIVE' && entitlementActive === true) return 'ACTIVE';
  return 'UNKNOWN';
}

export function couponJourneyRecord(
  uid: string,
  redemptionValue: unknown,
  userValue: unknown,
): CouponJourneyRecord {
  const redemption = objectMap(redemptionValue);
  const user = objectMap(userValue);
  const subscription = objectMap(user.subscription);
  const status = safeString(subscription.status);
  const entitlementActive = safeBoolean(subscription.entitlementActive);
  const productId = safeString(subscription.productId);

  return {
    uid,
    couponCode: safeString(redemption.couponCode),
    campaignId: safeString(redemption.campaignId),
    influencerId: safeString(redemption.influencerId),
    appliedAt: isoDate(redemption.appliedAt),
    trialStartedAt: isoDate(redemption.trialStartedAt),
    convertedAt: isoDate(redemption.convertedAt),
    lockedAt: isoDate(redemption.lockedAt),
    subscription: {
      status,
      entitlementActive,
      productId,
      plan: resolveSubscriptionPlan(productId),
      store: safeString(subscription.store),
      startedAt: isoDate(subscription.startedAt),
      trialEndsAt: isoDate(subscription.trialEndsAt),
      currentPeriodEndsAt: isoDate(subscription.currentPeriodEndsAt),
      canceledAt: isoDate(subscription.canceledAt),
      lastRenewedAt: isoDate(subscription.lastRenewedAt),
    },
    state: resolveCouponSubscriptionState(status, entitlementActive),
  };
}

/**
 * FASE 5.5 — `trialsStarted`/`trialsActive` are scoped EXCLUSIVELY to
 * `records` (this influencer/campaign's coupon-attributed redemptions).
 * They are historical/informational counts of "how many sales attributed to
 * this coupon happened to start (or currently sit) in a Store trial
 * period" — never a measure of the coupon CAUSING or GRANTING those trials
 * (a subscriber with no coupon at all has the exact same trial eligibility;
 * see docs §34's FASE 5.5 update). These fields must NEVER be read as, or
 * extrapolated into, AJ Fit's app-wide trial totals — that number would
 * require querying `users/*.subscription` directly (`SubscriptionMirror`,
 * `../billing/types.ts`), entirely outside this coupon-scoped summary.
 *
 * - `trialsStarted`: count of `record.trialStartedAt !== null` —
 *   `couponRedemptions/{uid}.trialStartedAt` is itself already
 *   historical/informational (see `CouponRedemption`'s doc comment in
 *   `../attribution/types.ts`), so this is "attributed sales whose first
 *   correlated purchase was a Store trial", a closed historical fact.
 * - `trialsActive`: count of `record.state === 'TRIAL'` — this one reads
 *   the LIVE `SubscriptionMirror`-derived `state` (via
 *   `resolveCouponSubscriptionState`), so it reflects the CURRENT trial
 *   status of this coupon's attributed users right now, not a frozen
 *   historical count.
 */
export function summarizeCouponJourney(records: readonly CouponJourneyRecord[]) {
  const converted = records.filter((record) => record.convertedAt !== null);
  return {
    redemptions: records.length,
    trialsStarted: records.filter((record) => record.trialStartedAt !== null).length,
    trialsActive: records.filter((record) => record.state === 'TRIAL').length,
    paidConversions: converted.length,
    conversionRate: records.length === 0 ? null : converted.length / records.length,
    monthly: converted.filter((record) => record.subscription.plan === 'monthly').length,
    annual: converted.filter((record) => record.subscription.plan === 'annual').length,
    activePaid: converted.filter((record) => record.state === 'ACTIVE').length,
    scheduledCancellations: converted.filter((record) => record.state === 'CANCELS_AT_PERIOD_END').length,
    billingIssues: converted.filter((record) => record.state === 'BILLING_ISSUE').length,
    expired: converted.filter((record) => record.state === 'EXPIRED').length,
    renewalsObserved: converted.filter((record) => record.subscription.lastRenewedAt !== null).length,
    revenue: null,
    commission: null,
  };
}
