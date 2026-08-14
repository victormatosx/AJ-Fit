import { useSubscriptionContext } from '../state/SubscriptionContext';

/**
 * Thin accessor over SubscriptionContext (docs/13_assinaturas_e_billing.md).
 * Exposes: `loading` / `configured` / `customerInfo` / `isPremium` /
 * `refreshCustomerInfo()` / `offerings` / `offeringsLoading` /
 * `offeringsError` / `loadOfferings()` / `purchase()` / `restore()`. SDK
 * lifecycle calls (configure/login/logout) are intentionally NOT exposed
 * here; see SubscriptionContext.tsx for why.
 */
export function useSubscription() {
  return useSubscriptionContext();
}
