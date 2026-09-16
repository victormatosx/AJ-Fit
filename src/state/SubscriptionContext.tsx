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
import { doc, onSnapshot } from 'firebase/firestore';
import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
  SubscriptionOption,
} from 'react-native-purchases';
import { useAuth } from './AuthContext';
import { db } from '../lib/firebase';
import {
  addCustomerInfoListener,
  removeCustomerInfoListener,
  configureRevenueCat,
  loginRevenueCat,
  logoutRevenueCat,
  invalidateCustomerInfoCache,
  refreshCustomerInfo as fetchCustomerInfo,
  getOfferings as fetchOfferings,
  purchasePackage as purchasePackageService,
  purchaseSubscriptionOption as purchaseSubscriptionOptionService,
  restorePurchases as restorePurchasesService,
  manageSubscription as manageSubscriptionService,
  isOfflineError,
  isOfferingsUnavailableError,
  classifyRevenueCatFailure,
  logSubscriptionEvent,
  maskSubscriptionUid,
  extractSubscriptionSignal,
  PREMIUM_ENTITLEMENT_ID,
  type PurchaseOutcome,
  type RestoreOutcome,
  type ManageSubscriptionOutcome,
} from '../services/revenueCatService';
import {
  createInitialSubscriptionLifecycleState,
  createIdentityScopedSingleFlight,
  reduceSubscriptionLifecycle,
  selectIdentityCustomerInfo,
  shouldRevalidateOnAppStateChange,
  hasMeaningfulSubscriptionChange,
  POST_MANAGE_REVALIDATION_DELAYS_MS,
  type SubscriptionErrorKind,
  type SubscriptionLifecycleEvent,
  type SubscriptionPhase,
} from '../lib/subscriptionLifecycle';
import { logInfo } from '../lib/logger';
import { useDevSubscriptionOverrideContext } from '../dev/DevSubscriptionOverrideContext';
import { applyDevSubscriptionOverride } from '../dev/subscriptionOverride';

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
  /**
   * Effective CustomerInfo for the current Firebase UID, or null while it is
   * unresolved. In every non-development build this is exactly what
   * RevenueCat returned. In a development build with the Dev Subscription
   * Override active (`src/dev/`), this is the real CustomerInfo transformed
   * by that override — the real snapshot itself is untouched internally.
   */
  customerInfo: CustomerInfo | null;
  /** Derived from `customerInfo.entitlements.active[premium]` — never separate state. */
  isPremium: boolean;
  /** Untouched RevenueCat snapshot retained for development diagnostics. */
  realCustomerInfo: CustomerInfo | null;
  /** Explicit alias for `customerInfo`, after the optional DEV transform. */
  effectiveCustomerInfo: CustomerInfo | null;
  /** Premium access derived only from the untouched RevenueCat snapshot. */
  realIsPremium: boolean;
  /** Explicit alias for `isPremium`, used by the app and Premium Gate. */
  effectiveIsPremium: boolean;
  /** `'development_override'` only when a Dev Subscription Override is actively reshaping `customerInfo`. */
  subscriptionSource: 'revenuecat' | 'development_override';
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
  /** Opens the official Store management surface resolved from CustomerInfo. */
  manageSubscription: (input: {
    store: string | null;
    managementURL: string | null;
  }) => Promise<ManageSubscriptionOutcome>;
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

  // Pending timers for the bounded post-manage revalidation window (see
  // `startPostManageRevalidation` below). Declared this early, alongside the
  // listener cleanup, so the identity-sync effect and the unmount effect can
  // both clear it deterministically — an identity change or unmount must
  // never leave an orphaned `setTimeout` scheduled for a stale uid/generation.
  const postManageWindowRef = useRef<{ timers: ReturnType<typeof setTimeout>[] }>({ timers: [] });

  const clearPostManageWindow = useCallback(() => {
    postManageWindowRef.current.timers.forEach((timer) => clearTimeout(timer));
    postManageWindowRef.current.timers = [];
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
        logInfo('subscription', 'customer_info_evaluated', {
          uid: listenerUid,
          originalAppUserId: info.originalAppUserId,
          source: 'listener',
          requestDate: info.requestDate,
          ...extractSubscriptionSignal(info),
        });
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

  const activeEntitlementSignal = useRef<{
    uid: string;
    generation: number;
    unsubscribe: () => void;
  } | null>(null);

  const detachEntitlementSignalListener = useCallback(() => {
    if (!activeEntitlementSignal.current) return;
    activeEntitlementSignal.current.unsubscribe();
    activeEntitlementSignal.current = null;
  }, []);

  /**
   * Realtime invalidation signal ONLY — `entitlementSignals/{uid}` (written
   * exclusively by `adminGrantFreeAccess`/`adminRevokeFreeAccess` once a
   * grant/revoke is actually confirmed by RevenueCat AND durably recorded,
   * see `functions/src/adminUsers/adminFreeAccess.ts`'s `touchEntitlementSignal`)
   * carries no Premium data whatsoever. This listener never reads a field
   * from the snapshot and never calls `applyLifecycleEvent` itself — its
   * only job is deciding WHEN to ask RevenueCat again. `entitlements.active
   * ['premium']`, read via the existing `invalidateCustomerInfoCache` +
   * `fetchCustomerInfo` pair below, remains the only thing that can change
   * `isPremium` — that already happens through `attachCustomerInfoListener`
   * above (the native SDK's own update listener), exactly like the
   * cold-start invalidate-then-fetch a few lines down. No new state path.
   */
  const attachEntitlementSignalListener = useCallback(
    (listenerUid: string, generation: number) => {
      detachEntitlementSignalListener();
      // The FIRST snapshot after attaching only reflects whatever the
      // document already contained when the listener was set up (from
      // cache or an immediate server read) — never a NEW administrative
      // event that happened while THIS session was already watching. It is
      // deliberately ignored so every cold start/login doesn't force a
      // redundant RevenueCat round-trip on top of the one already issued a
      // few lines below in the identity-sync effect.
      let receivedFirstSnapshot = false;
      const unsubscribe = onSnapshot(
        doc(db, 'entitlementSignals', listenerUid),
        () => {
          if (
            !mounted.current ||
            identityGeneration.current !== generation ||
            currentUid.current !== listenerUid ||
            syncedUid.current !== listenerUid
          ) {
            return;
          }
          if (!receivedFirstSnapshot) {
            receivedFirstSnapshot = true;
            return;
          }
          logSubscriptionEvent('subscription_entitlement_signal_received', listenerUid);
          // Fire-and-forget, same shape as the cold-start invalidate-then-
          // fetch below: never blocks anything, never surfaces an error (a
          // missed signal simply falls back to the existing AppState
          // foreground refresh), and re-checks identity/generation before
          // applying the network round-trip's side effect, since Firestore
          // and RevenueCat calls resolve independently and an
          // identity/logout switch can complete while either is in flight.
          void invalidateCustomerInfoCache().then(() => {
            if (
              !mounted.current ||
              identityGeneration.current !== generation ||
              currentUid.current !== listenerUid ||
              syncedUid.current !== listenerUid
            ) {
              return undefined;
            }
            return fetchCustomerInfo().catch(() => {});
          });
        },
        () => {
          // Permission-denied (e.g. mid-logout) or transient offline errors
          // are expected here and never surfaced — the AppState foreground
          // refresh remains the fallback path regardless of this listener's
          // health.
        },
      );
      activeEntitlementSignal.current = { uid: listenerUid, generation, unsubscribe };
    },
    [detachEntitlementSignalListener],
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
      detachEntitlementSignalListener();
      clearPostManageWindow();
      applyLifecycleEvent({ type: 'auth-waiting', generation });
      return;
    }

    const identityUid = uid;
    const generation = ++identityGeneration.current;
    syncedUid.current = undefined;
    refreshSeq.current += 1;
    detachCustomerInfoListener();
    detachEntitlementSignalListener();
    clearPostManageWindow();
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
        logInfo('subscription', 'revenuecat_configuration_ready', { uid: identityUid });

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
          logInfo('subscription', 'customer_info_evaluated', {
            uid: identityUid,
            originalAppUserId: info.originalAppUserId,
            source: 'login',
            requestDate: info.requestDate,
            ...extractSubscriptionSignal(info),
          });
          syncedUid.current = identityUid;
          applyLifecycleEvent({
            type: 'identity-resolved',
            uid: identityUid,
            generation,
            customerInfo: info,
          });
          attachCustomerInfoListener(identityUid, generation);
          attachEntitlementSignalListener(identityUid, generation);

          // Fire-and-forget: an administrative grant/revoke (Acesso Premium
          // Gratuito Administrativo) can happen while the app is closed.
          // `logIn` above may have returned a cached CustomerInfo snapshot
          // predating that change. Invalidating the SDK cache and reading
          // once more — right after the listener above is attached — lets
          // that SAME listener's own generation/uid-checked handler pick up
          // a fresher CustomerInfo on THIS cold start if one is available,
          // instead of only on the next foreground transition. Never
          // awaited (must not delay bootstrap) and never surfaced as an
          // error (see `invalidateCustomerInfoCache`'s doc comment — this is
          // an optimization, not a correctness requirement, and offline
          // devices simply keep whatever `info` was already applied above).
          //
          // This chain runs OUTSIDE `enqueueSdkOperation`'s serialization
          // (it is deliberately not awaited, so it does not block the
          // queue) — a logout/re-login for a DIFFERENT uid can start and
          // finish while this is still in flight, since `Purchases` is a
          // single native-module-wide identity. The re-check below,
          // mirroring every other resume point in this effect
          // (`mounted`/`identityGeneration`/`currentUid`), ensures the
          // extra `getCustomerInfo()` is only issued if this cold start's
          // identity is STILL the current one by the time the cache
          // invalidation round-trip completes — otherwise it would query
          // CustomerInfo for whichever uid the SDK has since switched to,
          // wastefully and outside this identity's own listener/generation.
          void invalidateCustomerInfoCache().then(() => {
            if (
              !mounted.current ||
              generation !== identityGeneration.current ||
              identityUid !== currentUid.current
            ) {
              return undefined;
            }
            return fetchCustomerInfo().catch(() => {});
          });
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
    attachEntitlementSignalListener,
    detachEntitlementSignalListener,
    clearPostManageWindow,
    enqueueSdkOperation,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      identityGeneration.current += 1;
      refreshSeq.current += 1;
      detachCustomerInfoListener();
      detachEntitlementSignalListener();
      clearPostManageWindow();
    };
  }, [detachCustomerInfoListener, detachEntitlementSignalListener, clearPostManageWindow]);

  const refreshSingleFlight = useRef(createIdentityScopedSingleFlight()).current;

  /**
   * Shared refresh core behind both the public `refreshCustomerInfo()` (pull
   * to refresh, AppState foreground revalidation, retry) and the post-manage
   * revalidation window below. `reason: 'manual'` preserves the exact
   * pre-existing contract (throws so callers can show an error notice);
   * `'post-manage'` is a silent, best-effort attempt — a bounded background
   * revalidation must never surface an uncaught rejection or a jarring error
   * state for something the user didn't explicitly ask for. Returns the
   * fetched `CustomerInfo` (or `null` when the fetch didn't happen/apply) so
   * the post-manage window can compare it against its baseline without
   * depending on `lifecycleRef` having flushed by the time this resolves.
   */
  const doRefresh = useCallback(
    async (reason: 'manual' | 'post-manage'): Promise<CustomerInfo | null> => {
      const refreshUid = currentUid.current;
      const generation = identityGeneration.current;
      const confirmed = selectIdentityCustomerInfo(lifecycleRef.current, refreshUid);
      if (!refreshUid || syncedUid.current !== refreshUid || !confirmed) {
        if (reason === 'manual') {
          throw new Error('CustomerInfo ainda não confirmado para a identidade atual.');
        }
        return null;
      }

      return refreshSingleFlight.run(`${refreshUid}:${generation}`, async () => {
        const seq = ++refreshSeq.current;
        applyLifecycleEvent({ type: 'refresh-started', uid: refreshUid, generation });
        logSubscriptionEvent('customer_info_refresh_started', refreshUid);

        return enqueueSdkOperation(async () => {
          try {
            if (
              !mounted.current ||
              seq !== refreshSeq.current ||
              generation !== identityGeneration.current ||
              refreshUid !== currentUid.current ||
              syncedUid.current !== refreshUid
            ) {
              return null;
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
              return null;
            }
            logInfo('subscription', 'customer_info_evaluated', {
              uid: refreshUid,
              originalAppUserId: info.originalAppUserId,
              source: reason === 'post-manage' ? 'post_manage_refresh' : 'refresh',
              requestDate: info.requestDate,
              ...extractSubscriptionSignal(info),
            });
            applyLifecycleEvent({
              type: 'customer-info-updated',
              uid: refreshUid,
              generation,
              customerInfo: info,
            });
            logSubscriptionEvent('customer_info_refresh_completed', refreshUid);
            return info;
          } catch (err) {
            if (
              !mounted.current ||
              generation !== identityGeneration.current ||
              refreshUid !== currentUid.current
            ) {
              return null;
            }
            logSubscriptionEvent('customer_info_refresh_failed', refreshUid);
            applyLifecycleEvent({
              type: 'refresh-failed',
              uid: refreshUid,
              generation,
              error: classifyRevenueCatFailure(err),
            });
            if (reason === 'manual') throw err;
            return null;
          }
        });
      });
    },
    [applyLifecycleEvent, enqueueSdkOperation, refreshSingleFlight],
  );

  const refreshCustomerInfo = useCallback(async () => {
    await doRefresh('manual');
  }, [doRefresh]);

  /**
   * Bounded, self-terminating revalidation window for the comprehensive gap
   * identified by the RevenueCat cancellation audit: `showManageSubscriptions()`
   * resolving tells us only that the native Apple sheet closed, never what the
   * user did in it, and Apple → RevenueCat propagation is async (observed
   * ~8min in Sandbox). This is NOT permanent polling — see
   * `POST_MANAGE_REVALIDATION_DELAYS_MS`'s doc comment for the schedule and
   * the early-stop rule. Every attempt reuses `doRefresh('post-manage')`
   * (same singleflight + identity guards as any other refresh), so a
   * concurrent AppState-triggered refresh or listener push can never
   * corrupt/duplicate work — they simply coalesce or race harmlessly to the
   * same `applyLifecycleEvent`.
   */
  const runPostManageRefreshAttempt = useCallback(
    async (attemptUid: string, generation: number, sheetClosedAt: number, attemptIndex: number) => {
      if (
        !mounted.current ||
        generation !== identityGeneration.current ||
        currentUid.current !== attemptUid ||
        syncedUid.current !== attemptUid
      ) {
        return;
      }
      const maskedUid = maskSubscriptionUid(attemptUid);
      logInfo('subscription', 'subscription_post_manage_refresh_started', {
        uid: maskedUid,
        attempt: attemptIndex,
        elapsedMs: Date.now() - sheetClosedAt,
      });
      const baseline = extractSubscriptionSignal(
        selectIdentityCustomerInfo(lifecycleRef.current, attemptUid),
      );
      const info = await doRefresh('post-manage');
      if (
        !mounted.current ||
        generation !== identityGeneration.current ||
        currentUid.current !== attemptUid ||
        syncedUid.current !== attemptUid
      ) {
        return;
      }
      const nextSignal = extractSubscriptionSignal(info);
      const changed = nextSignal ? hasMeaningfulSubscriptionChange(baseline, nextSignal) : false;
      logInfo('subscription', 'subscription_post_manage_refresh_completed', {
        uid: maskedUid,
        attempt: attemptIndex,
        elapsedMs: Date.now() - sheetClosedAt,
        changed,
      });
      // Renewal status already changed — the remaining scheduled attempts in
      // this window exist only to catch a still-pending Apple→RevenueCat
      // update, so there is nothing left for them to find.
      if (changed) clearPostManageWindow();
    },
    [clearPostManageWindow, doRefresh],
  );

  const startPostManageRevalidation = useCallback(
    (manageUid: string | null, generation: number, sheetClosedAt: number) => {
      clearPostManageWindow();
      if (!manageUid) return;
      POST_MANAGE_REVALIDATION_DELAYS_MS.forEach((delayMs, attemptIndex) => {
        const timer = setTimeout(() => {
          void runPostManageRefreshAttempt(manageUid, generation, sheetClosedAt, attemptIndex);
        }, delayMs);
        postManageWindowRef.current.timers.push(timer);
      });
    },
    [clearPostManageWindow, runPostManageRefreshAttempt],
  );

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
      // Diagnostic-only (dev-gated by `logInfo`): confirms whether
      // `showManageSubscriptions()` actually drives AppState through
      // inactive/background, which the RevenueCat cancellation audit left
      // unverified on a real device.
      logInfo('subscription', 'app_state_transition', {
        uid: maskSubscriptionUid(currentUid.current),
        previous: previousState,
        next: nextState,
        triggersRevalidation: shouldRefresh,
      });
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

  const realCustomerInfo = selectIdentityCustomerInfo(lifecycle, uid);
  // `configured`/`loading` reflect only the REAL RevenueCat resolution — the
  // Dev Override never fakes "RevenueCat is configured", it only reshapes
  // entitlement content once the real identity has already resolved.
  const configured = !initializing && (uid === null || realCustomerInfo !== null);
  const loading =
    initializing || (uid !== null && !configured && lifecycle.phase !== 'error');

  // Single seam: RevenueCat -> Real State -> Dev Override -> Effective
  // State -> App. `devOverride` is hard-pinned to `'REAL'` outside
  // development builds (DevSubscriptionOverrideContext), and
  // `applyDevSubscriptionOverride` itself re-checks the same allow-gate, so
  // `customerInfo` here is byte-for-byte `realCustomerInfo` in production.
  const { override: devOverride } = useDevSubscriptionOverrideContext();
  const effectiveCustomerInfo = useMemo(
    () => applyDevSubscriptionOverride(realCustomerInfo, devOverride),
    [realCustomerInfo, devOverride],
  );
  // Backward-compatible public names remain the effective commercial state.
  const customerInfo = effectiveCustomerInfo;
  const subscriptionSource: 'revenuecat' | 'development_override' =
    effectiveCustomerInfo !== realCustomerInfo ? 'development_override' : 'revenuecat';

  const realIsPremium = useMemo(
    () => Boolean(realCustomerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID]),
    [realCustomerInfo],
  );
  const isPremium = useMemo(
    () => Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID]),
    [customerInfo],
  );
  const effectiveIsPremium = isPremium;

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

  /**
   * `manageSubscriptionService` (react-native-purchases `showManageSubscriptions()`)
   * resolves as soon as the native Apple sheet closes — it carries no
   * information about what the user did inside it. Bracketing the call with
   * `subscription_manage_opened`/`_closed` and starting the bounded
   * revalidation window here (rather than in the service or the screen) is
   * deliberate: this is the one seam that already knows the current identity
   * (`currentUid`/`identityGeneration`) and already owns `doRefresh` — the
   * screen must keep calling this same abstraction, never the SDK directly.
   */
  const manageSubscription = useCallback(
    async (input: { store: string | null; managementURL: string | null }) => {
      const manageUid = currentUid.current;
      const generation = identityGeneration.current;
      logSubscriptionEvent('subscription_manage_opened', manageUid);
      const outcome = await manageSubscriptionService(input);
      const sheetClosedAt = Date.now();
      logSubscriptionEvent('subscription_manage_closed', manageUid);
      // Only a real store surface was presented (Apple sheet or an opened
      // management URL) — 'unavailable'/'error' never left the app, so there
      // is nothing to revalidate for.
      if (outcome.status === 'opened') {
        startPostManageRevalidation(manageUid, generation, sheetClosedAt);
      }
      return outcome;
    },
    [startPostManageRevalidation],
  );

  const value = useMemo<SubscriptionCtx>(
    () => ({
      loading,
      configured,
      customerInfo,
      isPremium,
      realCustomerInfo,
      effectiveCustomerInfo,
      realIsPremium,
      effectiveIsPremium,
      subscriptionSource,
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
      manageSubscription,
    }),
    [
      loading,
      configured,
      customerInfo,
      isPremium,
      realCustomerInfo,
      effectiveCustomerInfo,
      realIsPremium,
      effectiveIsPremium,
      subscriptionSource,
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
      manageSubscription,
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
