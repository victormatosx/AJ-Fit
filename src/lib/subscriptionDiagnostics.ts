import type { CustomerInfo } from 'react-native-purchases';
import type { IOSIntroEligibilityState } from './iosIntroOffer';
import type { IOSSubscriptionPlan } from './subscriptionOffer';

export type SubscriptionPurchaseRoute = 'standard' | 'promo';
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

export interface SubscriptionPurchaseContext {
  route: SubscriptionPurchaseRoute;
  plan: IOSSubscriptionPlan;
}

export type SubscriptionDiagnosticEvent =
  | ({ event: 'subscription_purchase_route_resolved' } & SubscriptionPurchaseContext)
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
    console.info('[subscription:diagnostic]', event);
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
