import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { useAuth } from './AuthContext';
import {
  loginRevenueCat,
  logoutRevenueCat,
  refreshCustomerInfo as fetchCustomerInfo,
  getOfferings as fetchOfferings,
  purchasePackage as purchasePackageService,
  restorePurchases as restorePurchasesService,
  logRevenueCatError,
  isOfflineError,
  isOfferingsUnavailableError,
  PREMIUM_ENTITLEMENT_ID,
  type PurchaseOutcome,
  type RestoreOutcome,
} from '../services/revenueCatService';

/**
 * RevenueCat state context (docs/13_assinaturas_e_billing.md).
 *
 * Exposes application STATE only — never the SDK lifecycle calls themselves.
 * `configureRevenueCat` stays in App.tsx (module-level bootstrap, runs
 * exactly once, before this Provider ever mounts — see the top of App.tsx).
 * `loginRevenueCat` / `logoutRevenueCat` are called from *inside* this
 * Provider, reacting to `useAuth()`'s `user`, never exposed on the public
 * context value and never called from a screen. AuthContext stays the single
 * owner of identity; this Provider only reacts to it to keep RevenueCat's
 * CustomerInfo in sync (docs §6, §9, §30).
 *
 * `customerInfo` is the primary source of truth (docs §2/§10/§27) — Firestore
 * is never read here. `isPremium` is derived from it on every render via
 * `useMemo`, never stored as independent state, so it can't drift out of
 * sync with `customerInfo`.
 *
 * Sprint 3 (App Store rejection fix) adds Offerings/purchase/restore state,
 * as planned in useSubscription.ts's original comment. Still infrastructure
 * only — `isPremium` here is read-only telemetry for the screen; no gating
 * logic reads it yet.
 *
 * Mirrors the shape of AuthContext.tsx / AppState.tsx: createContext + a
 * Provider component + a `use*` accessor hook that throws outside it.
 */

type SubscriptionCtx = {
  /** True while RevenueCat identity/CustomerInfo is being (re)synced. */
  loading: boolean;
  /** True once CustomerInfo has been fetched at least once this session. */
  configured: boolean;
  /** Last CustomerInfo fetched from RevenueCat, or null before the first sync. */
  customerInfo: CustomerInfo | null;
  /** Derived from `customerInfo.entitlements.active[premium]` — never separate state. */
  isPremium: boolean;
  /** Re-fetches CustomerInfo on demand (e.g. pull-to-refresh in a future screen). */
  refreshCustomerInfo: () => Promise<void>;
  /** Last Offerings fetched, or null before the first `loadOfferings()` call. */
  offerings: PurchasesOfferings | null;
  /** True while Offerings are being (re)fetched. */
  offeringsLoading: boolean;
  /** Message from the last failed `loadOfferings()` call, or null. */
  offeringsError: string | null;
  /** True when the last `loadOfferings()` failure looked like a connectivity issue. */
  offeringsOffline: boolean;
  /**
   * True when the last `loadOfferings()` failure was RevenueCat's
   * CONFIGURATION_ERROR (code 23) — the store products aren't resolvable yet
   * (e.g. still "Em revisão" in App Store Connect). Distinct from
   * `offeringsError`: screens should render a friendly fallback for this,
   * not a technical error message.
   */
  offeringsUnavailable: boolean;
  /** Fetches Offerings from RevenueCat. Safe to call repeatedly (e.g. retry). */
  loadOfferings: () => Promise<void>;
  /** Buys a package; updates `customerInfo` in place on success. */
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseOutcome>;
  /** Restores purchases from the store; updates `customerInfo` in place on success. */
  restore: () => Promise<RestoreOutcome>;
};

const SubscriptionContext = createContext<SubscriptionCtx | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  // Nested inside AuthProvider (see App.tsx), so `user`/`initializing` here are
  // always the current Firebase Auth state — this is what drives RevenueCat
  // identity, never the other way around.
  const { user, initializing } = useAuth();
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);

  // Monotonic token so a slower/older sync can never overwrite a newer one —
  // same pattern as AuthContext's `loadSeq` (e.g. a fast logout/login).
  const syncSeq = useRef(0);

  // Chains successive identity syncs so `loginRevenueCat`/`logoutRevenueCat`
  // for a fast account switch (A logs out, B logs in before A's call
  // settles) always reach the native SDK in the order `uid` actually
  // changed, never interleaved/out of order. `syncSeq` alone only protects
  // which *result* gets applied to React state — this protects the order of
  // the calls themselves.
  const pendingIdentitySync = useRef<Promise<void>>(Promise.resolve());

  // The one and only place `loginRevenueCat`/`logoutRevenueCat` are called.
  // Waits for Firebase to settle (`initializing`) so a cold start with a
  // persisted session doesn't fire a spurious logout before the real uid
  // resolves.
  useEffect(() => {
    if (initializing) return;
    const seq = ++syncSeq.current;
    setLoading(true);
    pendingIdentitySync.current = pendingIdentitySync.current
      .catch(() => {}) // a previous sync's rejection must not block this one
      .then(async () => {
        try {
          if (uid) {
            await loginRevenueCat(uid);
          } else {
            await logoutRevenueCat();
          }
          const info = await fetchCustomerInfo();
          if (seq !== syncSeq.current) return; // superseded by a newer sync
          setCustomerInfo(info);
          setConfigured(true);
        } catch (err) {
          // RevenueCat being unreachable/misconfigured must never crash the
          // app or block Firebase-driven navigation — just log and keep
          // whatever CustomerInfo we had (possibly null/stale).
          if (seq !== syncSeq.current) return;
          logRevenueCatError('context:sync', err);
        } finally {
          if (seq === syncSeq.current) setLoading(false);
        }
      });
  }, [uid, initializing]);

  const refreshCustomerInfo = useCallback(async () => {
    const seq = ++syncSeq.current;
    setLoading(true);
    try {
      const info = await fetchCustomerInfo();
      if (seq !== syncSeq.current) return;
      setCustomerInfo(info);
      setConfigured(true);
    } catch (err) {
      logRevenueCatError('context:refresh', err);
      throw err;
    } finally {
      if (seq === syncSeq.current) setLoading(false);
    }
  }, []);

  const isPremium = useMemo(
    () => Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID]),
    [customerInfo],
  );

  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [offeringsOffline, setOfferingsOffline] = useState(false);
  const [offeringsUnavailable, setOfferingsUnavailable] = useState(false);

  const loadOfferings = useCallback(async () => {
    setOfferingsLoading(true);
    setOfferingsError(null);
    setOfferingsOffline(false);
    setOfferingsUnavailable(false);
    try {
      const result = await fetchOfferings();
      setOfferings(result);
    } catch (err) {
      if (isOfferingsUnavailableError(err)) {
        // Not a real error state — the store hasn't made the products
        // resolvable yet. Leave `offeringsError` null so screens don't fall
        // into the technical-error branch.
        setOfferingsUnavailable(true);
      } else {
        setOfferingsError(
          err instanceof Error ? err.message : 'Não foi possível carregar os planos.',
        );
        setOfferingsOffline(isOfflineError(err));
      }
    } finally {
      setOfferingsLoading(false);
    }
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    const outcome = await purchasePackageService(pkg);
    if (outcome.status === 'purchased') {
      setCustomerInfo(outcome.customerInfo);
    }
    return outcome;
  }, []);

  const restore = useCallback(async () => {
    const outcome = await restorePurchasesService();
    if (outcome.status === 'restored') {
      setCustomerInfo(outcome.customerInfo);
    }
    return outcome;
  }, []);

  const value = useMemo<SubscriptionCtx>(
    () => ({
      loading,
      configured,
      customerInfo,
      isPremium,
      refreshCustomerInfo,
      offerings,
      offeringsLoading,
      offeringsError,
      offeringsOffline,
      offeringsUnavailable,
      loadOfferings,
      purchase,
      restore,
    }),
    [
      loading,
      configured,
      customerInfo,
      isPremium,
      refreshCustomerInfo,
      offerings,
      offeringsLoading,
      offeringsError,
      offeringsOffline,
      offeringsUnavailable,
      loadOfferings,
      purchase,
      restore,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscriptionContext() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscriptionContext outside SubscriptionProvider');
  return ctx;
}
