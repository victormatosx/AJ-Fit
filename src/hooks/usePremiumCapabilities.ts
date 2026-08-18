import { useMemo } from 'react';
import { useSubscription } from './useSubscription';
import {
  canPerformPremiumCapability,
  type PremiumAccessState,
  type PremiumCapability,
} from '../lib/premiumCapabilities';

/**
 * React entry point for Fase 2's authorization layer (see
 * `src/lib/premiumCapabilities.ts` for the full rationale). Derives its
 * decision from `useSubscription()` alone — `loading`/`configured`/
 * `isPremium`, already backed by RevenueCat's `CustomerInfo` through
 * `SubscriptionContext`. No independent state, no RevenueCat/Firestore/
 * AsyncStorage access here: this hook is a thin, memoized read of state that
 * already exists elsewhere, so it reacts automatically whenever
 * `CustomerInfo` changes upstream — no manual refresh, remount, or
 * logout/login required.
 */
export function usePremiumCapabilities() {
  const { loading, configured, isPremium } = useSubscription();

  const access: PremiumAccessState = useMemo(
    () => ({
      isPremium,
      resolved: !loading && configured,
    }),
    [isPremium, loading, configured],
  );

  const canPerform = useMemo(
    () => (capability: PremiumCapability) => canPerformPremiumCapability(capability, access),
    [access],
  );

  return { canPerform };
}
