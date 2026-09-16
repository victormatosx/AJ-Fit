import type { CustomerInfo } from 'react-native-purchases';
import type { IOSIntroEligibilityState } from './iosIntroOffer';
import type { IOSSubscriptionPlan } from './subscriptionOffer';
import { logInfo } from './logger';

/**
 * FASE 6.5 — cross-platform purchase route taxonomy. Previously iOS-only
 * (`'standard' | 'promo'`); extended so Android's purchase routing
 * (`subscriptionOffer.ts`'s `PurchaseRoute`) is equally observable, without
 * ever distinguishing LEGACY vs NEW by coupon code/campaign — only by which
 * SDK call the route actually leads to:
 * - `'standard'`: no promo authorized — `purchasePackage` on the
 *   standard/current package (either platform).
 * - `'legacy_subscription_option'`: Android-only, pre-5.3 influencer
 *   coupons — `purchaseSubscriptionOption` on an explicit SubscriptionOption.
 * - `'promo_package'`: a resolved promotional package — `purchasePackage`
 *   on it. Covers BOTH iOS's promotional Offering/SKU route and Android's
 *   FASE 5.7/6.3 `offeringIdentifier`+`basePlanId` route: the SDK call and
 *   the commercial shape (a real Offering/package, never a forced offer)
 *   are identical, so one value correctly describes both.
 */
export type SubscriptionPurchaseRoute = 'standard' | 'legacy_subscription_option' | 'promo_package';
export type SubscriptionIntroEligibility =
  | 'eligible'
  | 'ineligible'
  | 'unknown'
  | 'no_intro_offer_exists'
  | 'error';
export type SubscriptionPurchaseErrorCategory =
  | 'store_error'
  | 'network_error'
  | 'configuration_error'
  | 'authorization_error'
  | 'unknown';

/**
 * FASE 6.5 — allowlisted reasons a purchase route was BLOCKED, mirroring
 * `subscriptionOffer.ts`'s `PurchaseRoute['blocked']['reason']` plus the
 * iOS-only blocked reasons `PaywallScreen.tsx`'s `EffectivePurchaseRoute`
 * adds on top of it. Deliberately a closed allowlist, never the raw string
 * a caller happens to pass — `normalizeBlockedReasonForDiagnostic` maps
 * anything unrecognized to `'unknown'` rather than transporting it verbatim
 * (same fail-closed principle as `classifyPromoCodeError`).
 */
export type SubscriptionPurchaseBlockedReason =
  | 'promo_not_found'
  | 'promo_ambiguous'
  | 'promo_no_options'
  | 'promo_plan_unavailable'
  | 'promo_offering_missing'
  | 'promo_package_missing'
  | 'promo_package_ambiguous'
  | 'promo_ios_unavailable'
  | 'promo_authorization_invalid'
  | 'promo_catalog_error'
  | 'unknown';

const KNOWN_BLOCKED_REASONS: readonly SubscriptionPurchaseBlockedReason[] = [
  'promo_not_found',
  'promo_ambiguous',
  'promo_no_options',
  'promo_plan_unavailable',
  'promo_offering_missing',
  'promo_package_missing',
  'promo_package_ambiguous',
  'promo_ios_unavailable',
  'promo_authorization_invalid',
  'promo_catalog_error',
];

/** Never transports an arbitrary/unexpected string verbatim — anything outside the allowlist becomes `'unknown'`. */
export function normalizeBlockedReasonForDiagnostic(reason: string): SubscriptionPurchaseBlockedReason {
  return (KNOWN_BLOCKED_REASONS as readonly string[]).includes(reason)
    ? (reason as SubscriptionPurchaseBlockedReason)
    : 'unknown';
}

export interface SubscriptionPurchaseContext {
  route: SubscriptionPurchaseRoute;
  plan: IOSSubscriptionPlan;
}

export type SubscriptionDiagnosticEvent =
  | ({ event: 'subscription_purchase_route_resolved' } & SubscriptionPurchaseContext)
  /** FASE 6.5 — `plan` is `null` only when the selected package itself can't be mapped to monthly/annual (should not normally happen). Never carries the offering/product/coupon identity that caused the block. */
  | {
      event: 'subscription_purchase_route_blocked';
      plan: IOSSubscriptionPlan | null;
      reason: SubscriptionPurchaseBlockedReason;
    }
  | {
      event: 'subscription_intro_eligibility';
      plan: IOSSubscriptionPlan;
      eligibility: SubscriptionIntroEligibility;
      hasValidFreeIntro: boolean;
    }
  | {
      event: 'promo_purchase_intent_authorized';
      plan: IOSSubscriptionPlan;
      authorized: true;
    }
  | {
      event: 'promo_purchase_intent_failed';
      plan: IOSSubscriptionPlan;
      errorCategory: 'authorization_error';
    }
  | ({ event: 'subscription_purchase_started' } & SubscriptionPurchaseContext)
  | ({ event: 'subscription_purchase_cancelled' } & SubscriptionPurchaseContext)
  | ({ event: 'subscription_purchase_completed'; premiumActive: boolean } & SubscriptionPurchaseContext)
  | ({ event: 'subscription_purchase_failed'; errorCategory: SubscriptionPurchaseErrorCategory } & SubscriptionPurchaseContext);

type ObservablePurchaseOutcome =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error'; offline: boolean };

/**
 * E2E diagnostics with an allowlisted event union. Logging is best-effort and
 * can never interrupt route selection, authorization or the purchase itself.
 */
export function logSubscriptionDiagnostic(event: SubscriptionDiagnosticEvent): void {
  try {
    logInfo('subscription:diagnostic', event.event, { ...event });
  } catch {
    // Observability must never alter subscription behavior.
  }
}

export function normalizeIntroEligibilityForDiagnostic(
  state: IOSIntroEligibilityState,
): SubscriptionIntroEligibility {
  if (state.status === 'no_intro_offer') return 'no_intro_offer_exists';
  if (state.status === 'idle' || state.status === 'checking') return 'unknown';
  return state.status;
}

export function logSubscriptionPurchaseOutcome(
  context: SubscriptionPurchaseContext,
  outcome: ObservablePurchaseOutcome,
  entitlementId: string,
): void {
  if (outcome.status === 'cancelled') {
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_cancelled',
      ...context,
    });
    return;
  }
  if (outcome.status === 'error') {
    logSubscriptionDiagnostic({
      event: 'subscription_purchase_failed',
      ...context,
      errorCategory: outcome.offline ? 'network_error' : 'store_error',
    });
    return;
  }
  logSubscriptionDiagnostic({
    event: 'subscription_purchase_completed',
    ...context,
    premiumActive: Boolean(outcome.customerInfo.entitlements.active[entitlementId]),
  });
}
