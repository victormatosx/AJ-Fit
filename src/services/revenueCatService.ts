import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';

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
export const PREMIUM_ENTITLEMENT_ID = 'premium';

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

export function logRevenueCatError(scope: string, err: unknown): void {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[revenueCat:${scope}]`, { code, message });
}

// Module-scoped guard against re-configuring the SDK. App.tsx calls
// `configureRevenueCat()` exactly once at module-evaluation time, but that
// call site itself can re-run more than expected under Fast Refresh/Hot
// Reload (editing App.tsx re-executes its top-level code without restarting
// the whole bundle). The guard lives here, not in App.tsx, so it protects
// every current and future call site — a screen calling this by mistake
// would also be a no-op instead of a duplicate `Purchases.configure`.
let hasConfigured = false;

/**
 * Initializes the RevenueCat SDK for the current platform. Idempotent: a
 * second call is a no-op as long as the first one succeeded. If the first
 * call failed (e.g. missing API key), a later call can still succeed once
 * the misconfiguration is fixed.
 *
 * Does NOT log the user in — the SDK starts with an anonymous RevenueCat
 * App User ID until `loginRevenueCat(uid)` is called.
 */
export async function configureRevenueCat(): Promise<void> {
  if (hasConfigured) return;

  const apiKey = currentApiKey();
  if (!apiKey) {
    throw new Error(
      'RevenueCat não configurado: defina EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / ' +
        'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY no arquivo .env (veja .env.example) ' +
        'e reinicie o servidor com `npx expo start -c`.',
    );
  }

  try {
    // SDK-internal log verbosity only — never touches our own console.log/
    // console.error calls below (those stay in every build). DEBUG floods
    // the console with per-request SDK internals; ERROR keeps Release quiet
    // while still surfacing anything the SDK itself considers a failure.
    await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey });
    hasConfigured = true;
    console.log('[revenueCat:configure] SDK configurado', { platform: Platform.OS });
  } catch (err) {
    logRevenueCatError('configure', err);
    throw err;
  }
}

/**
 * Identifies the current Firebase user to RevenueCat, using the Firebase UID
 * as the RevenueCat App User ID (docs/13_assinaturas_e_billing.md §9/§30).
 *
 * Called only by SubscriptionContext, reacting to `useAuth()`'s `user` — never
 * by a screen, and never by AuthContext itself (identity stays AuthContext's
 * job; RevenueCat sync is SubscriptionContext's).
 */
export async function loginRevenueCat(uid: string): Promise<void> {
  try {
    await Purchases.logIn(uid);
    console.log('[revenueCat:login] identificado', { uid });
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
    await Purchases.logOut();
    console.log('[revenueCat:logout] usuário deslogado (App User ID anônimo)');
  } catch (err) {
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
    const info = await Purchases.getCustomerInfo();
    console.log('[revenueCat:customerInfo]', {
      activeEntitlements: Object.keys(info.entitlements.active),
    });
    return info;
  } catch (err) {
    logRevenueCatError('getCustomerInfo', err);
    throw err;
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

/**
 * Fetches the Offerings configured in the RevenueCat dashboard (docs
 * §5/§9: offering `default`, packages `$rc_monthly`/`$rc_annual`). Always
 * live data from the SDK — never mocked, never hardcoded plan/price data.
 */
export async function getOfferings(): Promise<PurchasesOfferings> {
  try {
    const offerings = await Purchases.getOfferings();
    console.log('[revenueCat:offerings]', {
      current: offerings.current?.identifier ?? null,
      packages: offerings.current?.availablePackages.map((p) => p.identifier) ?? [],
    });
    return offerings;
  } catch (err) {
    if (isOfferingsUnavailableError(err)) {
      // Expected while the store hasn't made the products resolvable yet
      // (see isOfferingsUnavailableError's doc comment) — not a real failure,
      // so no console.error. The caller (SubscriptionContext) still throws
      // this through to the screen's fallback state.
      console.log('[revenueCat:offerings] indisponíveis (produtos ainda não resolvidos pela loja)');
    } else {
      logRevenueCatError('offerings', err);
    }
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
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    console.log('[revenueCat:purchase] concluída', {
      product: pkg.product.identifier,
      activeEntitlements: Object.keys(customerInfo.entitlements.active),
    });
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if (isCancelledError(err)) {
      console.log('[revenueCat:purchase] cancelada pelo usuário', {
        product: pkg.product.identifier,
      });
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
    const customerInfo = await Purchases.restorePurchases();
    const hasPremium = Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]);
    console.log('[revenueCat:restore] concluída', { hasPremium });
    return { status: 'restored', customerInfo, hasPremium };
  } catch (err) {
    const offeringsUnavailable = isOfferingsUnavailableError(err);
    if (offeringsUnavailable) {
      // Same expected/known scenario as getOfferings() above — informative
      // log only, no console.error. The caller (PremiumScreen) also logs its
      // own "[premium] Offerings ainda indisponíveis" line for this case.
      console.log('[revenueCat:restore] offerings indisponíveis (produtos ainda não resolvidos pela loja)');
    } else {
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
