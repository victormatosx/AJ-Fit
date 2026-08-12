import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState as NativeAppState, type AppStateStatus } from 'react-native';
import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
  SubscriptionOption,
} from 'react-native-purchases';
import { useAuth } from './AuthContext';
import {
  addCustomerInfoListener,
  removeCustomerInfoListener,
  configureRevenueCat,
  loginRevenueCat,
  logoutRevenueCat,
  refreshCustomerInfo as fetchCustomerInfo,
  getOfferings as fetchOfferings,
  purchasePackage as purchasePackageService,
  purchaseSubscriptionOption as purchaseSubscriptionOptionService,
  restorePurchases as restorePurchasesService,
  logRevenueCatError,
  isOfflineError,
  isOfferingsUnavailableError,
  classifyRevenueCatFailure,
  logSubscriptionEvent,
  PREMIUM_ENTITLEMENT_ID,
  type PurchaseOutcome,
  type RestoreOutcome,
} from '../services/revenueCatService';
import {
  createInitialSubscriptionLifecycleState,
  createIdentityScopedSingleFlight,
  reduceSubscriptionLifecycle,
  selectIdentityCustomerInfo,
  shouldRevalidateOnAppStateChange,
  type SubscriptionErrorKind,
  type SubscriptionLifecycleEvent,
  type SubscriptionPhase,
} from '../lib/subscriptionLifecycle';

/**
 * RevenueCat state context (docs/13_assinaturas_e_billing.md).
 *
 * Exposes application STATE only — never the SDK lifecycle calls themselves.
 * `configureRevenueCat` is bootstrapped in App.tsx and explicitly awaited by
 * this Provider before identity synchronization.
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
  /** Detailed lifecycle phase; `error` never means "not Premium". */
  status: SubscriptionPhase;
  /** True only for a refresh of an already confirmed snapshot. */
  refreshing: boolean;
  /** Sanitized failure kind/message from the latest identity sync or refresh. */
  errorKind: SubscriptionErrorKind | null;
  error: string | null;
  /** Retries identity sync when unresolved, otherwise refreshes CustomerInfo. */
  retry: () => Promise<void>;
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
  /**
   * Fase 4C.3 — buys an already-resolved, backend-authorized promotional
   * `SubscriptionOption` (Android only). Same identity guard/CustomerInfo
   * pipeline as `purchase`; this Context has no concept of promo codes
   * beyond "here is the exact commercial object to buy".
   */
  purchaseOption: (option: SubscriptionOption) => Promise<PurchaseOutcome>;
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

  const [lifecycle, setLifecycle] = useState(() =>
    createInitialSubscriptionLifecycleState<CustomerInfo>(),
  );
  const lifecycleRef = useRef(lifecycle);

  const applyLifecycleEvent = useCallback(
    (event: SubscriptionLifecycleEvent<CustomerInfo>) => {
      setLifecycle((current) => {
        const next = reduceSubscriptionLifecycle(current, event);
        lifecycleRef.current = next;
        return next;
      });
    },
    [],
  );

  // Updated during render, before effects, so consumers cannot observe a new
  // Firebase UID together with the previous UID's Premium authorization.
  const currentUid = useRef<string | null>(uid);
  currentUid.current = uid;

  // Set only after logIn/logOut has completed for an identity.
  const syncedUid = useRef<string | null | undefined>(undefined);

  // Monotonic identity generation. Every async result and listener closure
  // captures this token as well as the UID.
  const identityGeneration = useRef(0);
  const refreshSeq = useRef(0);
  const mounted = useRef(true);
  const [retryNonce, setRetryNonce] = useState(0);

  // Serializes SDK operations that depend on identity. React state is
  // invalidated immediately on logout/account switch, but RevenueCat calls
  // still finish in deterministic order (purchase -> logout -> login B, for
  // example) instead of mutating the native singleton concurrently.
  const sdkOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueSdkOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = sdkOperationQueue.current.catch(() => undefined).then(operation);
    sdkOperationQueue.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const activeListener = useRef<{
    uid: string;
    generation: number;
    listener: (info: CustomerInfo) => void;
  } | null>(null);

  const detachCustomerInfoListener = useCallback(() => {
    if (!activeListener.current) return;
    removeCustomerInfoListener(activeListener.current.listener);
    activeListener.current = null;
  }, []);

  const attachCustomerInfoListener = useCallback(
    (listenerUid: string, generation: number) => {
      detachCustomerInfoListener();
      const listener = (info: CustomerInfo) => {
        if (
          !mounted.current ||
          identityGeneration.current !== generation ||
          currentUid.current !== listenerUid ||
          syncedUid.current !== listenerUid
        ) {
          logSubscriptionEvent('subscription_snapshot_discarded_stale_identity', listenerUid);
          return;
        }
        refreshSeq.current += 1;
        logSubscriptionEvent('customer_info_listener_update', listenerUid);
        applyLifecycleEvent({
          type: 'customer-info-updated',
          uid: listenerUid,
          generation,
          customerInfo: info,
        });
      };
      addCustomerInfoListener(listener);
      activeListener.current = { uid: listenerUid, generation, listener };
    },
    [applyLifecycleEvent, detachCustomerInfoListener],
  );

  // The one and only place `loginRevenueCat`/`logoutRevenueCat` are called.
  // Waits for Firebase to settle (`initializing`) so a cold start with a
  // persisted session doesn't fire a spurious logout before the real uid
  // resolves.
  useEffect(() => {
    mounted.current = true;
    if (initializing) {
      const generation = ++identityGeneration.current;
      syncedUid.current = undefined;
      refreshSeq.current += 1;
      detachCustomerInfoListener();
      applyLifecycleEvent({ type: 'auth-waiting', generation });
      return;
    }

    const identityUid = uid;
    const generation = ++identityGeneration.current;
    syncedUid.current = undefined;
    refreshSeq.current += 1;
    detachCustomerInfoListener();
    applyLifecycleEvent({ type: 'identity-changed', uid: identityUid, generation });
    logSubscriptionEvent('subscription_identity_sync_started', identityUid);

    void enqueueSdkOperation(async () => {
      try {
        if (
          !mounted.current ||
          generation !== identityGeneration.current ||
          identityUid !== currentUid.current
        ) {
          return;
        }

        applyLifecycleEvent({
          type: 'configuration-started',
          uid: identityUid,
          generation,
        });
        await configureRevenueCat();
        if (
          !mounted.current ||
          generation !== identityGeneration.current ||
          identityUid !== currentUid.current
        ) {
          return;
        }

        applyLifecycleEvent({
          type: 'identity-sync-started',
          uid: identityUid,
          generation,
        });

        if (identityUid) {
          // logIn itself returns CustomerInfo for the identified user, so no
          // duplicate getCustomerInfo request is needed during bootstrap.
          const info = await loginRevenueCat(identityUid);
          if (
            !mounted.current ||
            generation !== identityGeneration.current ||
            identityUid !== currentUid.current
          ) {
            logSubscriptionEvent(
              'subscription_snapshot_discarded_stale_identity',
              identityUid,
            );
            return;
          }
          syncedUid.current = identityUid;
          applyLifecycleEvent({
            type: 'identity-resolved',
            uid: identityUid,
            generation,
            customerInfo: info,
          });
          attachCustomerInfoListener(identityUid, generation);
        } else {
          await logoutRevenueCat();
          if (
            !mounted.current ||
            generation !== identityGeneration.current ||
            currentUid.current !== null
          ) {
            return;
          }
          syncedUid.current = null;
          applyLifecycleEvent({
            type: 'identity-resolved',
            uid: null,
            generation,
            customerInfo: null,
          });
        }
        logSubscriptionEvent('subscription_identity_sync_completed', identityUid);
      } catch (err) {
        if (
          !mounted.current ||
          generation !== identityGeneration.current ||
          identityUid !== currentUid.current
        ) {
          return;
        }
        // Without CustomerInfo confirmed for this exact Firebase UID, access
        // stays unresolved. No prior identity snapshot is retained.
        logRevenueCatError('context:sync', err);
        applyLifecycleEvent({
          type: 'identity-failed',
          uid: identityUid,
          generation,
          error: classifyRevenueCatFailure(err),
        });
      }
    });
  }, [
    uid,
    initializing,
    retryNonce,
    applyLifecycleEvent,
    attachCustomerInfoListener,
    detachCustomerInfoListener,
    enqueueSdkOperation,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      identityGeneration.current += 1;
      refreshSeq.current += 1;
      detachCustomerInfoListener();
    };
  }, [detachCustomerInfoListener]);

  const refreshSingleFlight = useRef(createIdentityScopedSingleFlight()).current;

  const refreshCustomerInfo = useCallback(async () => {
    const refreshUid = currentUid.current;
    const generation = identityGeneration.current;
    const confirmed = selectIdentityCustomerInfo(lifecycleRef.current, refreshUid);
    if (!refreshUid || syncedUid.current !== refreshUid || !confirmed) {
      throw new Error('CustomerInfo ainda não confirmado para a identidade atual.');
    }

    await refreshSingleFlight.run(`${refreshUid}:${generation}`, async () => {
      const seq = ++refreshSeq.current;
      applyLifecycleEvent({ type: 'refresh-started', uid: refreshUid, generation });
      logSubscriptionEvent('customer_info_refresh_started', refreshUid);

      await enqueueSdkOperation(async () => {
        try {
          if (
            !mounted.current ||
            seq !== refreshSeq.current ||
            generation !== identityGeneration.current ||
            refreshUid !== currentUid.current ||
            syncedUid.current !== refreshUid
          ) {
            return;
          }
          const info = await fetchCustomerInfo();
          if (
            !mounted.current ||
            seq !== refreshSeq.current ||
            generation !== identityGeneration.current ||
            refreshUid !== currentUid.current ||
            syncedUid.current !== refreshUid
          ) {
            logSubscriptionEvent('subscription_snapshot_discarded_stale_identity', refreshUid);
            return;
          }
          applyLifecycleEvent({
            type: 'customer-info-updated',
            uid: refreshUid,
            generation,
            customerInfo: info,
          });
          logSubscriptionEvent('customer_info_refresh_completed', refreshUid);
        } catch (err) {
          if (
            !mounted.current ||
            generation !== identityGeneration.current ||
            refreshUid !== currentUid.current
          ) {
            return;
          }
          logRevenueCatError('context:refresh', err);
          logSubscriptionEvent('customer_info_refresh_failed', refreshUid);
          applyLifecycleEvent({
            type: 'refresh-failed',
            uid: refreshUid,
            generation,
            error: classifyRevenueCatFailure(err),
          });
          throw err;
        }
      });
    });
  }, [applyLifecycleEvent, enqueueSdkOperation, refreshSingleFlight]);

  const retry = useCallback(async () => {
    const retryUid = currentUid.current;
    if (selectIdentityCustomerInfo(lifecycleRef.current, retryUid)) {
      await refreshCustomerInfo();
      return;
    }
    setRetryNonce((current) => current + 1);
  }, [refreshCustomerInfo]);

  useEffect(() => {
    let previousState: AppStateStatus | null = NativeAppState.currentState;
    const subscription = NativeAppState.addEventListener('change', (nextState) => {
      const shouldRefresh = shouldRevalidateOnAppStateChange(previousState, nextState);
      previousState = nextState;
      if (!shouldRefresh) return;

      const foregroundUid = currentUid.current;
      logSubscriptionEvent('subscription_foreground_revalidation', foregroundUid);
      if (selectIdentityCustomerInfo(lifecycleRef.current, foregroundUid)) {
        void refreshCustomerInfo().catch(() => {
          // The context already preserved the confirmed same-UID snapshot and
          // exposed a sanitized error. AppState callbacks must not reject.
        });
      } else if (foregroundUid && lifecycleRef.current.phase === 'error') {
        setRetryNonce((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, [refreshCustomerInfo]);

  const customerInfo = selectIdentityCustomerInfo(lifecycle, uid);
  const configured = !initializing && (uid === null || customerInfo !== null);
  const loading =
    initializing || (uid !== null && !configured && lifecycle.phase !== 'error');

  const isPremium = useMemo(
    () => Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID]),
    [customerInfo],
  );

  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [offeringsOffline, setOfferingsOffline] = useState(false);
  const [offeringsUnavailable, setOfferingsUnavailable] = useState(false);
  const offeringsSeq = useRef(0);

  useEffect(() => {
    offeringsSeq.current += 1;
    setOfferings(null);
    setOfferingsLoading(false);
    setOfferingsError(null);
    setOfferingsOffline(false);
    setOfferingsUnavailable(false);
  }, [uid]);

  const loadOfferings = useCallback(async () => {
    const offeringsUid = currentUid.current;
    const generation = identityGeneration.current;
    if (!offeringsUid || syncedUid.current !== offeringsUid) return;
    const seq = ++offeringsSeq.current;
    setOfferingsLoading(true);
    setOfferingsError(null);
    setOfferingsOffline(false);
    setOfferingsUnavailable(false);
    try {
      const result = await fetchOfferings();
      if (
        seq !== offeringsSeq.current ||
        generation !== identityGeneration.current ||
        offeringsUid !== currentUid.current
      ) {
        return;
      }
      setOfferings(result);
    } catch (err) {
      if (
        seq !== offeringsSeq.current ||
        generation !== identityGeneration.current ||
        offeringsUid !== currentUid.current
      ) {
        return;
      }
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
      if (
        seq === offeringsSeq.current &&
        generation === identityGeneration.current &&
        offeringsUid === currentUid.current
      ) {
        setOfferingsLoading(false);
      }
    }
  }, []);

  // Fase 4C.3: shared identity-guarded purchase pipeline. `purchase`
  // (normal Package) and `purchaseOption` (backend-authorized
  // SubscriptionOption, Android promo — Fase 4C.1/4C.2/4C.3A) are the ONLY
  // two entry points, and both funnel through this exact same guard +
  // CustomerInfo-application logic — no divergent behavior between the two
  // purchase paths beyond which RevenueCat SDK call is actually made.
  // `sdkCall` never receives anything this function doesn't already trust:
  // callers close over an already-resolved `PurchasesPackage`/
  // `SubscriptionOption`, this function has no opinion on WHICH item is
  // being bought, exactly like `purchasePackageService` itself.
  const performPurchase = useCallback(
    async (sdkCall: () => Promise<PurchaseOutcome>): Promise<PurchaseOutcome> => {
      const purchaseUid = currentUid.current;
      const generation = identityGeneration.current;
      const startedForSyncedIdentity =
        Boolean(purchaseUid) &&
        syncedUid.current === purchaseUid &&
        Boolean(selectIdentityCustomerInfo(lifecycleRef.current, purchaseUid));
      if (!purchaseUid || !startedForSyncedIdentity) {
        return {
          status: 'error',
          message: 'A identidade da assinatura ainda está sendo confirmada.',
          offline: false,
        } satisfies PurchaseOutcome;
      }
      refreshSeq.current += 1;
      const outcome = await enqueueSdkOperation(sdkCall);
      if (
        outcome.status === 'purchased' &&
        currentUid.current === purchaseUid &&
        syncedUid.current === purchaseUid &&
        identityGeneration.current === generation
      ) {
        applyLifecycleEvent({
          type: 'customer-info-updated',
          uid: purchaseUid,
          generation,
          customerInfo: outcome.customerInfo,
        });
      }
      return outcome;
    },
    [applyLifecycleEvent, enqueueSdkOperation],
  );

  const purchase = useCallback(
    (pkg: PurchasesPackage) => performPurchase(() => purchasePackageService(pkg)),
    [performPurchase],
  );

  // Fase 4C.3: `option` MUST already be the exact, backend-authorized
  // `SubscriptionOption` resolved by `findAuthorizedSubscriptionOption`/
  // `resolvePurchaseRoute` (lib/subscriptionOffer.ts) — this Context has no
  // knowledge of ARNALDO/HELLLEN/couponCode/campaignId/influencerId and
  // never will; it only ever receives the already-resolved commercial
  // object, same as `purchase` above receives an already-selected
  // `PurchasesPackage`. Promo-code identity/state stays entirely inside
  // `usePromoCode`/the Paywall.
  const purchaseOption = useCallback(
    (option: SubscriptionOption) => performPurchase(() => purchaseSubscriptionOptionService(option)),
    [performPurchase],
  );

  const restore = useCallback(async () => {
    const restoreUid = currentUid.current;
    const generation = identityGeneration.current;
    const startedForSyncedIdentity =
      Boolean(restoreUid) &&
      syncedUid.current === restoreUid &&
      Boolean(selectIdentityCustomerInfo(lifecycleRef.current, restoreUid));
    if (!restoreUid || !startedForSyncedIdentity) {
      return {
        status: 'error',
        message: 'A identidade da assinatura ainda está sendo confirmada.',
        offline: false,
        offeringsUnavailable: false,
      } satisfies RestoreOutcome;
    }
    refreshSeq.current += 1;
    const outcome = await enqueueSdkOperation(restorePurchasesService);
    if (
      outcome.status === 'restored' &&
      currentUid.current === restoreUid &&
      syncedUid.current === restoreUid &&
      identityGeneration.current === generation
    ) {
      applyLifecycleEvent({
        type: 'customer-info-updated',
        uid: restoreUid,
        generation,
        customerInfo: outcome.customerInfo,
      });
    }
    return outcome;
  }, [applyLifecycleEvent, enqueueSdkOperation]);

  const value = useMemo<SubscriptionCtx>(
    () => ({
      loading,
      configured,
      customerInfo,
      isPremium,
      status: lifecycle.phase,
      refreshing: lifecycle.refreshing,
      errorKind: lifecycle.error?.kind ?? null,
      error: lifecycle.error?.message ?? null,
      retry,
      refreshCustomerInfo,
      offerings,
      offeringsLoading,
      offeringsError,
      offeringsOffline,
      offeringsUnavailable,
      loadOfferings,
      purchase,
      purchaseOption,
      restore,
    }),
    [
      loading,
      configured,
      customerInfo,
      isPremium,
      lifecycle.phase,
      lifecycle.refreshing,
      lifecycle.error,
      retry,
      refreshCustomerInfo,
      offerings,
      offeringsLoading,
      offeringsError,
      offeringsOffline,
      offeringsUnavailable,
      loadOfferings,
      purchase,
      purchaseOption,
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
