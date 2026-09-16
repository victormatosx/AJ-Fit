import { Linking, Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesError,
  type PurchasesOfferings,
  type PurchasesPackage,
  type SubscriptionOption,
} from 'react-native-purchases';
import type { IOSIntroEligibilityState } from '../lib/iosIntroOffer';
import { PREMIUM_ENTITLEMENT_ID } from '../lib/subscriptionConstants';
import type {
  SubscriptionErrorKind,
  SubscriptionFailure,
  SubscriptionRevalidationSignal,
} from '../lib/subscriptionLifecycle';
import { logError, logInfo } from '../lib/logger';

/**
 * RevenueCat infrastructure (docs/13_assinaturas_e_billing.md).
 *
 * Sprint 1: SDK bootstrap + identity bridging (login/logout by UID).
 * Sprint 2 added CustomerInfo reads. Sprint 3 (App Store rejection fix —
 * buttons with no action) adds Offerings, Purchase and Restore. This is
 * infrastructure only: no entitlement gating/access-control logic is added
 * here — that stays a separate, later sprint per docs §10/§11.
 *
 * Mirrors the shape of src/services/auth.ts / socialAuth.ts / profilePhoto.ts:
 * plain functions talking directly to the SDK, no class, no repository.
 */

/**
 * The single entitlement identifier for this app (docs/13_assinaturas_e_billing.md §5).
 * Presence in `CustomerInfo.entitlements.active` is the ONLY source of truth
 * for Premium access — never Firestore, never a commercial `status` string.
 */
export { PREMIUM_ENTITLEMENT_ID } from '../lib/subscriptionConstants';

/**
 * Public RevenueCat SDK keys, one per store. These keys are safe to ship in
 * the client bundle (same trust level as the Firebase web config in
 * src/lib/firebase.ts) but are still kept out of source via EXPO_PUBLIC_ env
 * vars, consistent with how Firebase config is sourced in this project.
 */
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

function currentApiKey(): string | undefined {
  return Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
}

export function maskSubscriptionUid(uid: string | null | undefined): string | undefined {
  if (!uid) return undefined;
  if (uid.length <= 6) return '***';
  return `${uid.slice(0, 3)}…${uid.slice(-3)}`;
}

export function logSubscriptionEvent(event: string, uid?: string | null): void {
  logInfo('subscription', event, { uid: maskSubscriptionUid(uid) });
}

export function logRevenueCatError(scope: string, err: unknown): void {
  logError(`revenueCat:${scope}`, err);
}

export function classifyRevenueCatFailure(err: unknown): SubscriptionFailure {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as PurchasesError).code
      : undefined;

  let kind: SubscriptionErrorKind = 'temporary';
  if (isOfflineError(err)) kind = 'offline';
  else if (code === PURCHASES_ERROR_CODE.CONFIGURATION_ERROR) kind = 'configuration';
  else if (
    code === PURCHASES_ERROR_CODE.INVALID_APP_USER_ID_ERROR ||
    code === PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR
  ) {
    kind = 'identity';
  }

  const message =
    kind === 'configuration'
      ? 'Não foi possível configurar a verificação da assinatura.'
      : kind === 'identity'
        ? 'Não foi possível confirmar a identidade da assinatura.'
        : kind === 'offline'
          ? 'Sem conexão para verificar a assinatura desta conta.'
          : 'Não foi possível verificar a assinatura agora.';

  return { kind, message };
}

// Shared, module-scoped "configuration ready" promise. This is the single
// choke point every other function in this file goes through (via
// `ensureConfigured()` below) before touching any other `Purchases.*` method
// — see that function's doc comment for the full race-condition rationale
// (forensic audit: "There is no singleton instance" reported by Apple
// review). `null` means "not configured (yet)"; a resolved promise means
// `Purchases.configure()` has already been called; a call in flight is
// represented by the pending promise itself, so concurrent callers all await
// the exact same configuration attempt instead of racing separate ones.
let configurationPromise: Promise<void> | null = null;

/**
 * Initializes the RevenueCat SDK for the current platform. Idempotent: a
 * second call while already configured just returns the same resolved
 * promise. If a previous call failed (e.g. missing API key), the failure is
 * NOT cached — a later call can still succeed once the misconfiguration is
 * fixed.
 *
 * Does NOT log the user in — the SDK starts with an anonymous RevenueCat
 * App User ID until `loginRevenueCat(uid)` is called.
 *
 * STRUCTURAL GUARANTEE (root-cause fix for the "There is no singleton
 * instance" race — see the forensic audit): `Purchases.configure()` below is
 * called synchronously, as the very first statement of this function body,
 * with NO `await`/microtask boundary preceding it. That is deliberate and
 * load-bearing:
 *
 * React Native serializes calls to the same native module in the order they
 * are dispatched from JS — this is the exact guarantee every RevenueCat
 * integration (including this SDK's own official quickstart) relies on when
 * it calls `Purchases.configure()` once at startup and then uses the SDK
 * freely afterward with no manual "wait until ready" step. That guarantee
 * only holds if `configure()` is truly the FIRST `Purchases.*`/`RNPurchases.*`
 * call this app makes. The previous implementation broke it by `await`-ing
 * `Purchases.setLogLevel(...)` (an unrelated, unnecessary wait — `setLogLevel`
 * does not require prior configuration) before calling `configure()`, which
 * yielded the JS thread and let React mount + fire
 * `SubscriptionContext`'s identity-sync effect (calling `Purchases.logIn`/
 * `logOut`/`getCustomerInfo`) BEFORE `configure()`'s JS call had even
 * happened. This function no longer awaits anything before `configure()`.
 *
 * This alone is enough (App.tsx's module-scope bootstrap call runs before
 * React ever mounts), but every other exported function below ALSO awaits
 * `ensureConfigured()` as its first step, so readiness is guaranteed by
 * construction — not by call order alone — for every current and future
 * call site, not only the one in App.tsx.
 */
export function configureRevenueCat(): Promise<void> {
  if (configurationPromise) return configurationPromise;

  const apiKey = currentApiKey();

  if (!apiKey) {
    const err = new Error(
      'RevenueCat não configurado: defina EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / ' +
        'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY no arquivo .env (veja .env.example) ' +
        'e reinicie o servidor com `npx expo start -c`.',
    );
    (err as Error & { code?: PURCHASES_ERROR_CODE }).code =
      PURCHASES_ERROR_CODE.CONFIGURATION_ERROR;
    logRevenueCatError('configure', err);
    return Promise.reject(err); // not cached — a later call can retry
  }

  try {
    // Must stay the first statement in this try — no `await` above it.
    Purchases.configure({ apiKey });
  } catch (err) {
    logRevenueCatError('configure', err);
    return Promise.reject(err); // not cached — a later call can retry
  }

  // SDK-internal log verbosity only. Deliberately fire-and-forget and AFTER
  // `configure()`: it doesn't require prior configuration and must never
  // delay or fail the shared configuration promise other functions depend on.
  Purchases.setLogLevel(revenueCatLogLevel()).catch((err) =>
    logRevenueCatError('configure:setLogLevel', err),
  );

  configurationPromise = Promise.resolve();
  return configurationPromise;
}

export function revenueCatLogLevel(): LOG_LEVEL {
  const debugEnabled =
    __DEV__ && process.env.EXPO_PUBLIC_REVENUECAT_DEBUG_LOGS === '1';
  return debugEnabled ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN;
}

/**
 * Every other function in this file awaits this before calling any other
 * `Purchases.*` method — the structural guarantee described in
 * `configureRevenueCat()`'s doc comment. Not a timing/delay mechanism: this
 * either returns an already-resolved promise (the overwhelmingly common
 * case — App.tsx's module-scope bootstrap call has already run by the time
 * React mounts and any of these functions can be invoked) or, defensively,
 * triggers configuration itself if some future call site is ever reached
 * without that bootstrap having run — never allowing an unconfigured call to
 * reach the native SDK either way.
 */
function ensureConfigured(): Promise<void> {
  return configureRevenueCat();
}

/**
 * Identifies the current Firebase user to RevenueCat, using the Firebase UID
 * as the RevenueCat App User ID (docs/13_assinaturas_e_billing.md §9/§30).
 *
 * Called only by SubscriptionContext, reacting to `useAuth()`'s `user` — never
 * by a screen, and never by AuthContext itself (identity stays AuthContext's
 * job; RevenueCat sync is SubscriptionContext's).
 */
export async function loginRevenueCat(uid: string): Promise<CustomerInfo> {
  try {
    await ensureConfigured();
    logInfo('subscription', 'revenuecat_login_requested', { uid });
    const { customerInfo } = await Purchases.logIn(uid);
    logInfo('subscription', 'revenuecat_login_resolved', {
      uid,
      originalAppUserId: customerInfo.originalAppUserId,
      premiumActive: Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]),
      requestDate: customerInfo.requestDate,
    });
    return customerInfo;
  } catch (err) {
    logRevenueCatError('login', err);
    throw err;
  }
}

/**
 * Logs the current user out of RevenueCat, returning it to an anonymous
 * App User ID. Mirrors `signOutUser` in src/services/auth.ts, but is called
 * from SubscriptionContext (reacting to `user` becoming null), not from
 * `signOutUser` itself — same reasoning as `loginRevenueCat` above.
 */
export async function logoutRevenueCat(): Promise<void> {
  try {
    await ensureConfigured();
    // Firebase resolving to `null` also happens on a signed-out cold start.
    // In that case RevenueCat may already own an anonymous App User ID and
    // `logOut()` would be both unnecessary and invalid. Read the SDK's actual
    // identity state instead of inferring it from Firebase.
    if (await Purchases.isAnonymous()) return;

    await Purchases.logOut();
  } catch (err) {
    // Defensive fallback for an identity change outside this app-owned queue
    // between `isAnonymous()` and `logOut()`. The normal anonymous path is
    // handled proactively above and never invokes `logOut()`.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as PurchasesError).code === PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR
    ) {
      return;
    }
    logRevenueCatError('logout', err);
    throw err;
  }
}

/**
 * Reads the current CustomerInfo from the SDK (cache-or-network, per
 * RevenueCat's own resolution — no separate force-refresh path is used here).
 * This is the ONLY thing that determines Premium access
 * (docs/13_assinaturas_e_billing.md §2/§10/§27) — never Firestore.
 */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  try {
    await ensureConfigured();
    const info = await Purchases.getCustomerInfo();
    return info;
  } catch (err) {
    logRevenueCatError('getCustomerInfo', err);
    throw err;
  }
}

/**
 * Marks the SDK's local CustomerInfo cache as stale so the NEXT read hits
 * RevenueCat's network instead of returning a cached snapshot. This is the
 * exact, officially-documented use case in `react-native-purchases`' own
 * type declarations (`Purchases.invalidateCustomerInfoCache`): "useful for
 * cases where customer information might have been updated outside of the
 * app, like if a promotional subscription is granted through the RevenueCat
 * dashboard" — precisely the Acesso Premium Gratuito Administrativo flow.
 *
 * Deliberately best-effort and fire-and-forget at every call site: it never
 * blocks bootstrap, and if the device is offline the SDK simply keeps
 * serving the last-known CustomerInfo (unaffected — this only changes what
 * happens on the NEXT successful network read, it doesn't force one or fail
 * without connectivity). Failures are logged, never thrown, since callers
 * treat this as an optimization, not a correctness requirement — the
 * existing login/foreground refresh + listener flow already converges on
 * the correct CustomerInfo without it, just not necessarily on the very
 * first cold-start read after an out-of-app grant/revoke.
 */
export async function invalidateCustomerInfoCache(): Promise<void> {
  try {
    await ensureConfigured();
    await Purchases.invalidateCustomerInfoCache();
  } catch (err) {
    logRevenueCatError('invalidateCustomerInfoCache', err);
  }
}

/**
 * Re-fetches CustomerInfo at the sync points required by
 * docs/13_assinaturas_e_billing.md §6 (login, logout, explicit refresh).
 * Delegates to `getCustomerInfo` — same SDK call, kept as a distinct export
 * so call sites document *why* they're reading CustomerInfo (a defined sync
 * point vs. an incidental one-off read).
 */
export async function refreshCustomerInfo(): Promise<CustomerInfo> {
  return getCustomerInfo();
}

export type SubscriptionSignal = SubscriptionRevalidationSignal & {
  expirationDate: string | null;
};

/**
 * Reduces a full `CustomerInfo` down to the fields the post-manage
 * revalidation window (SubscriptionContext) and diagnostic logging actually
 * need. Reads the premium entitlement the same way `resolveStatus`
 * (lib/subscriptionCenter.ts) does — active entitlement first, falling back
 * to the last-known one for `willRenew`/`unsubscribeDetectedAt` — but this
 * function is deliberately kept independent of `resolveSubscriptionCenterModel`:
 * it has no Offerings/mirror inputs and does not decide UI status, only
 * extracts the raw signal used to detect "did anything renewal-relevant
 * change" and to log it safely (never the full CustomerInfo/receipt data).
 */
export function extractSubscriptionSignal(info: CustomerInfo | null): SubscriptionSignal | null {
  if (!info) return null;
  const activeEntitlement = info.entitlements.active[PREMIUM_ENTITLEMENT_ID] ?? null;
  const entitlement = activeEntitlement ?? info.entitlements.all[PREMIUM_ENTITLEMENT_ID] ?? null;
  return {
    premiumActive: Boolean(activeEntitlement),
    willRenew: typeof entitlement?.willRenew === 'boolean' ? entitlement.willRenew : null,
    unsubscribeDetected: Boolean(entitlement?.unsubscribeDetectedAt),
    expirationDate: entitlement?.expirationDate ?? null,
  };
}

/**
 * Subscribes to CustomerInfo changes the SDK becomes aware of on THIS
 * device. Per RevenueCat's own docs (revenuecat.com/docs/customers/
 * customer-info): "CustomerInfo updates are not pushed to your app from the
 * RevenueCat backend, updates can only happen from an outbound network
 * request to RevenueCat" — i.e. this listener fires as a result of THIS
 * app's own `getCustomerInfo()` calls, purchases, or restores actually
 * reaching the RevenueCat backend and returning a changed snapshot. It is
 * NOT a realtime push channel: a promotional grant/revoke made externally
 * (RevenueCat dashboard/API) does not reach an already-open, idle app on
 * its own — something in this app must first issue one of those outbound
 * calls (see `invalidateCustomerInfoCache`/`refreshCustomerInfo`,
 * `SubscriptionContext.tsx`'s AppState foreground refresh and its
 * `entitlementSignals/{uid}` Firestore listener) before this fires.
 * Callers must hold onto `listener` and pass the same reference to
 * `removeCustomerInfoListener` on cleanup.
 */
export function addCustomerInfoListener(listener: CustomerInfoUpdateListener): void {
  Purchases.addCustomerInfoUpdateListener(listener);
}

export function removeCustomerInfoListener(listener: CustomerInfoUpdateListener): void {
  Purchases.removeCustomerInfoUpdateListener(listener);
}

/**
 * Fetches the Offerings configured in the RevenueCat dashboard (docs
 * §5/§9: offering `default`, packages `$rc_monthly`/`$rc_annual`). Always
 * live data from the SDK — never mocked, never hardcoded plan/price data.
 */
export async function getOfferings(): Promise<PurchasesOfferings> {
  try {
    await ensureConfigured();
    const offerings = await Purchases.getOfferings();
    return offerings;
  } catch (err) {
    // isOfferingsUnavailableError: expected while the store hasn't made the
    // products resolvable yet (see that function's doc comment) — not a real
    // failure, so no console.error. The caller (SubscriptionContext) still
    // throws this through to the screen's fallback state.
    if (!isOfferingsUnavailableError(err)) {
      logRevenueCatError('offerings', err);
    }
    throw err;
  }
}

/**
 * iOS-only StoreKit/RevenueCat introductory eligibility. Missing products are
 * preserved as UNKNOWN; the caller decides the fail-closed UI policy.
 */
export async function checkIOSIntroEligibility(
  productIdentifiers: string[],
): Promise<Record<string, IOSIntroEligibilityState>> {
  if (Platform.OS !== 'ios') {
    return Object.fromEntries(
      productIdentifiers.map((id) => [id, { status: 'unknown' } as const]),
    );
  }
  try {
    await ensureConfigured();
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIdentifiers);
    const mapped = Object.fromEntries(
      productIdentifiers.map((id) => {
        const status = result[id]?.status;
        const state: IOSIntroEligibilityState =
          status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
            ? { status: 'eligible' }
            : status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE
              ? { status: 'ineligible' }
              : status ===
                    INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS
                ? { status: 'no_intro_offer' }
                : { status: 'unknown' };
        return [id, state];
      }),
    );
    const counts = Object.values(mapped).reduce<Record<string, number>>((acc, state) => {
      acc[state.status] = (acc[state.status] ?? 0) + 1;
      return acc;
    }, {});
    logInfo('subscription', 'intro_eligibility_checked', { counts });
    return mapped;
  } catch (err) {
    logRevenueCatError('introEligibility', err);
    throw err;
  }
}

function isCancelledError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as PurchasesError).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

/**
 * True when the SDK error indicates no usable connection to the store/
 * RevenueCat backend, as opposed to a genuine failure (misconfiguration,
 * store rejection, etc). Used to show a distinct "sem internet" state
 * instead of a generic error.
 */
export function isOfflineError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as PurchasesError).code;
  return (
    code === PURCHASES_ERROR_CODE.NETWORK_ERROR ||
    code === PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR
  );
}

/**
 * True when the SDK error is RevenueCat's `CONFIGURATION_ERROR` (code 23).
 * In `getOfferings()`, this is the documented signal that the dashboard
 * offering references store products StoreKit/Play can't resolve yet — the
 * expected state while `AJ Fit Premium Mensal/Anual` are still "Em revisão"
 * in App Store Connect, not a dashboard/entitlement misconfiguration on our
 * side (offering id, product ids and the `premium` entitlement are never
 * referenced by identifier in this client — see docs §5/§9). Callers use
 * this to show a friendly "assinaturas em processamento" fallback instead of
 * a technical error. If this keeps firing after Apple approves the
 * products, that would indicate a real dashboard misconfiguration worth
 * investigating — this function only classifies the error, it doesn't
 * assume which cause is true.
 */
export function isOfferingsUnavailableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return (err as PurchasesError).code === PURCHASES_ERROR_CODE.CONFIGURATION_ERROR;
}

export type PurchaseOutcome =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; offline: boolean };

/**
 * Buys a package (docs §9 step 7-10). User cancellation is a normal,
 * expected outcome — modeled as data (`{ status: 'cancelled' }`), not an
 * error, so screens don't have to special-case a thrown exception for it.
 * Any other failure is surfaced as `{ status: 'error' }` with a message safe
 * to show the user; the raw error is still logged via `logRevenueCatError`.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    await ensureConfigured();
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if (isCancelledError(err)) {
      return { status: 'cancelled' };
    }
    logRevenueCatError('purchase', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Não foi possível concluir a compra.',
      offline: isOfflineError(err),
    };
  }
}

/**
 * Fase 4C.3 — buys a specific, backend-authorized `SubscriptionOption`
 * (Android Google Play promotional offer, e.g.
 * `monthly:influencer-trial-7d`) instead of letting RevenueCat pick a
 * package's default option. `option` MUST already be the exact result of
 * `findAuthorizedSubscriptionOption` (`lib/subscriptionOffer.ts`) — this
 * function does no matching/validation of its own, mirroring
 * `purchasePackage`'s own contract of trusting its caller for WHICH item to
 * buy while owning only the SDK call + outcome classification.
 *
 * Deliberately returns the exact same `PurchaseOutcome` shape as
 * `purchasePackage` — same cancellation/error/offline classification, same
 * `CustomerInfo` on success — so `SubscriptionContext` can route either
 * through one identical post-purchase pipeline (see `purchaseOption`
 * there). Never called directly from a screen.
 */
export async function purchaseSubscriptionOption(option: SubscriptionOption): Promise<PurchaseOutcome> {
  try {
    await ensureConfigured();
    const { customerInfo } = await Purchases.purchaseSubscriptionOption(option);
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if (isCancelledError(err)) {
      return { status: 'cancelled' };
    }
    logRevenueCatError('purchaseSubscriptionOption', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Não foi possível concluir a compra.',
      offline: isOfflineError(err),
    };
  }
}

export type RestoreOutcome =
  | { status: 'restored'; customerInfo: CustomerInfo; hasPremium: boolean }
  | { status: 'error'; message: string; offline: boolean; offeringsUnavailable: boolean };

/**
 * Restores purchases from the store (docs §20). Always resolves with the
 * refreshed CustomerInfo on success — "no purchases to restore" is not an
 * SDK error, it's just `hasPremium: false`, which the caller renders as its
 * own state instead of treating it as a failure.
 */
export async function restorePurchases(): Promise<RestoreOutcome> {
  try {
    await ensureConfigured();
    const customerInfo = await Purchases.restorePurchases();
    const hasPremium = Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
    return { status: 'restored', customerInfo, hasPremium };
  } catch (err) {
    const offeringsUnavailable = isOfferingsUnavailableError(err);
    // Same expected/known scenario as getOfferings() above — not a real
    // failure, so no console.error in that case.
    if (!offeringsUnavailable) {
      logRevenueCatError('restore', err);
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Não foi possível restaurar as compras.',
      offline: isOfflineError(err),
      offeringsUnavailable,
    };
  }
}

export type ManageSubscriptionOutcome =
  | { status: 'opened' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

/**
 * Opens the store-owned subscription management surface without inventing a
 * destination. App Store purchases use RevenueCat's native iOS sheet; every
 * other store uses the exact per-subscription `managementURL` returned in
 * CustomerInfo. A missing URL is represented explicitly, never replaced by a
 * hardcoded store URL.
 */
export async function manageSubscription({
  store,
  managementURL,
}: {
  store: string | null;
  managementURL: string | null;
}): Promise<ManageSubscriptionOutcome> {
  try {
    if (Platform.OS === 'ios' && store === 'APP_STORE') {
      await ensureConfigured();
      await Purchases.showManageSubscriptions();
      return { status: 'opened' };
    }

    if (!managementURL) return { status: 'unavailable' };
    await Linking.openURL(managementURL);
    return { status: 'opened' };
  } catch (err) {
    logRevenueCatError('manageSubscription', err);
    return {
      status: 'error',
      message: 'Não foi possível abrir o gerenciamento da assinatura.',
    };
  }
}
