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
  addCustomerInfoListener,
  removeCustomerInfoListener,
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
 * as planned in useSubscription.ts's original comment. The root router now
 * consumes this identity-scoped state for the Premium gate.
 *
 * Mirrors the shape of AuthContext.tsx / AppState.tsx: createContext + a
 * Provider component + a `use*` accessor hook that throws outside it.
 */

type SubscriptionCtx = {
  /** True while RevenueCat identity/CustomerInfo is being (re)synced. */
  loading: boolean;
  /** True once CustomerInfo has been fetched for the current Firebase UID. */
  configured: boolean;
  /** CustomerInfo for the current Firebase UID, or null while it is unresolved. */
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

type IdentitySnapshot = {
  uid: string | null;
  customerInfo: CustomerInfo;
};

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  // Nested inside AuthProvider (see App.tsx), so `user`/`initializing` here are
  // always the current Firebase Auth state — this is what drives RevenueCat
  // identity, never the other way around.
  const { user, initializing } = useAuth();
  const uid = user?.uid ?? null;

  const [syncing, setSyncing] = useState(true);
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(null);

  // Updated during render, before effects, so consumers cannot observe a new
  // Firebase UID together with the previous UID's Premium authorization.
  const currentUid = useRef<string | null>(uid);
  currentUid.current = uid;

  // Set only after logIn/logOut + CustomerInfo have completed for an identity.
  // CustomerInfo listener events are ignored while this does not match the
  // Firebase UID currently being rendered.
  const syncedUid = useRef<string | null | undefined>(undefined);

  // Monotonic token so a slower/older sync can never overwrite a newer one —
  // same pattern as AuthContext's `loadSeq` (e.g. a fast logout/login).
  const syncSeq = useRef(0);
  const refreshSeq = useRef(0);

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
    syncedUid.current = undefined;
    setSnapshot(null);
    setSyncing(true);
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
          syncedUid.current = uid;
          setSnapshot({ uid, customerInfo: info });
        } catch (err) {
          // Fail closed: without CustomerInfo for this exact Firebase UID the
          // gate remains unresolved. Never fall back to another UID's data.
          if (seq !== syncSeq.current) return;
          logRevenueCatError('context:sync', err);
        } finally {
          if (seq === syncSeq.current) setSyncing(false);
        }
      });
  }, [uid, initializing]);

  // Keeps `customerInfo` live for changes the SDK becomes aware of on its
  // own (renewals, cancellations, promotional grants, cross-device changes)
  // — not just the sync points this Provider triggers itself above. Runs for
  // the Provider's whole lifetime; RevenueCat's recommended pattern for
  // React Native.
  useEffect(() => {
    const listener = (info: CustomerInfo) => {
      const listenerUid = currentUid.current;
      if (syncedUid.current !== listenerUid) return;
      setSnapshot((current) =>
        current?.uid === listenerUid ? { uid: listenerUid, customerInfo: info } : current,
      );
    };
    addCustomerInfoListener(listener);
    return () => removeCustomerInfoListener(listener);
  }, []);

  const refreshCustomerInfo = useCallback(async () => {
    const refreshUid = currentUid.current;
    const seq = ++refreshSeq.current;
    setSyncing(true);
    try {
      // Never read CustomerInfo in parallel with an identity switch: wait for
      // the queued logIn/logOut operation that owns the SDK identity first.
      await pendingIdentitySync.current;
      if (
        seq !== refreshSeq.current ||
        refreshUid !== currentUid.current ||
        syncedUid.current !== refreshUid
      ) {
        return;
      }
      const info = await fetchCustomerInfo();
      if (seq !== refreshSeq.current || refreshUid !== currentUid.current) return;
      syncedUid.current = refreshUid;
      setSnapshot({ uid: refreshUid, customerInfo: info });
    } catch (err) {
      logRevenueCatError('context:refresh', err);
      throw err;
    } finally {
      if (seq === refreshSeq.current && refreshUid === currentUid.current) setSyncing(false);
    }
  }, []);

  const configured = !initializing && snapshot?.uid === uid;
  const customerInfo = configured ? snapshot.customerInfo : null;
  const loading = initializing || syncing || !configured;

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
    const purchaseUid = currentUid.current;
    const startedForSyncedIdentity = syncedUid.current === purchaseUid;
    const outcome = await purchasePackageService(pkg);
    if (
      outcome.status === 'purchased' &&
      startedForSyncedIdentity &&
      currentUid.current === purchaseUid &&
      syncedUid.current === purchaseUid
    ) {
      setSnapshot({ uid: purchaseUid, customerInfo: outcome.customerInfo });
    }
    return outcome;
  }, []);

  const restore = useCallback(async () => {
    const restoreUid = currentUid.current;
    const startedForSyncedIdentity = syncedUid.current === restoreUid;
    const outcome = await restorePurchasesService();
    if (
      outcome.status === 'restored' &&
      startedForSyncedIdentity &&
      currentUid.current === restoreUid &&
      syncedUid.current === restoreUid
    ) {
      setSnapshot({ uid: restoreUid, customerInfo: outcome.customerInfo });
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
