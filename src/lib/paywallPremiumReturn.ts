export type PaywallPremiumReturnState = {
  /** The open Paywall has observed the subscription source of truth as non-Premium. */
  armed: boolean;
};

export type PaywallPremiumReturnTransition = {
  state: PaywallPremiumReturnState;
  shouldClose: boolean;
};

export const INITIAL_PAYWALL_PREMIUM_RETURN_STATE: PaywallPremiumReturnState = {
  armed: false,
};

/**
 * Tracks only the navigation-relevant `false -> true` Premium transition
 * while the on-demand Paywall is visible. Purchase/restore completion never
 * enters this state machine; its input is the existing RevenueCat-backed
 * `isPremium` value exposed by SubscriptionContext.
 */
export function resolvePaywallPremiumReturn(
  state: PaywallPremiumReturnState,
  input: { visible: boolean; isPremium: boolean },
): PaywallPremiumReturnTransition {
  if (!input.visible) {
    return { state: INITIAL_PAYWALL_PREMIUM_RETURN_STATE, shouldClose: false };
  }

  if (!input.isPremium) {
    return { state: { armed: true }, shouldClose: false };
  }

  if (state.armed) {
    return { state: INITIAL_PAYWALL_PREMIUM_RETURN_STATE, shouldClose: true };
  }

  return { state, shouldClose: false };
}
