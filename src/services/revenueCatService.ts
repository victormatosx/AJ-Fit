import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesError,
  type PurchasesOfferings,
  type PurchasesPackage,
  type SubscriptionOption,
} from 'react-native-purchases';
import type {
  SubscriptionErrorKind,
  SubscriptionFailure,
} from '../lib/subscriptionLifecycle';

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

function sanitizedErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\$RCAnonymousID:[\w-]+/g, '$RCAnonymousID:[redacted]')
    .replace(/\b[A-Za-z0-9_-]{16,}\b/g, '[redacted-id]')
    .slice(0, 240);
}

export function maskSubscriptionUid(uid: string | null | undefined): string | undefined {
  if (!uid) return undefined;
  if (uid.length <= 6) return '***';
  return `${uid.slice(0, 3)}…${uid.slice(-3)}`;
}

export function logSubscriptionEvent(event: string, uid?: string | null): void {
  console.info('[subscription]', {
    event,
    uid: maskSubscriptionUid(uid),
  });
}

export function logRevenueCatError(scope: string, err: unknown): void {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : undefined;
  console.error(`[revenueCat:${scope}]`, { code, message: sanitizedErrorMessage(err) });
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
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR).catch((err) =>
    logRevenueCatError('configure:setLogLevel', err),
  );

  configurationPromise = Promise.resolve();
  return configurationPromise;
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
    const { customerInfo } = await Purchases.logIn(uid);
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
    await Purchases.logOut();
  } catch (err) {
    // Calling logOut while the persisted SDK identity is already anonymous is
    // an idempotent signed-out state for this app, not a lifecycle failure.
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
 * Subscribes to CustomerInfo pushed by the SDK outside of an explicit call
 * in this file (renewals, cancellations, promotional grants, cross-device
 * changes) — RevenueCat's documented pattern for React Native so entitlement
 * state stays live without requiring an app restart or a manual refresh.
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

/**
 * FASE iOS-3 — iOS only. Presents Apple's native Offer Code redemption sheet
 * via `Purchases.presentCodeRedemptionSheet()`.
 *
 * AUDIT (iOS-3 Etapa A/B): confirmed against
 * `node_modules/react-native-purchases/dist/purchases.d.ts`
 * (react-native-purchases@10.6.0, the version actually installed) that this
 * method takes NO arguments and resolves `Promise<void>` — there is no
 * parameter anywhere in the installed SDK's purchase surface
 * (`purchasePackage`, `purchaseStoreProduct`, `purchaseSubscriptionOption`,
 * `purchaseDiscountedPackage`/`purchaseDiscountedProduct`) that accepts an
 * arbitrary Apple Offer Code string. `purchaseDiscountedPackage`/
 * `getPromotionalOffer` are a DIFFERENT Apple mechanism (Promotional
 * Offers — signed server-side, for offers tied to an existing/lapsed
 * subscriber) and do not apply to a code a user types into this app.
 * `presentCodeRedemptionSheet`'s own doc comment confirms it is "useful for
 * redeeming offer codes" and points at
 * https://docs.revenuecat.com/docs/ios-subscription-offers#offer-codes.
 * So: Apple Offer Codes, this SDK version, this mechanism ONLY — there is no
 * way to pre-fill or programmatically submit `appleStoreConfig`'s
 * `offerCodeMonthly`/`offerCodeAnnual` string; the sheet is StoreKit's own
 * native UI where the user selects/types the code themselves. Callers must
 * still show that code to the user beforehand (`PaywallScreen.tsx`) so they
 * know what to redeem — this function only opens Apple's UI, it never
 * "applies" anything on its own.
 *
 * The sheet's promise resolves once dismissed, for ANY reason — StoreKit
 * does not report whether the user actually completed a redemption or just
 * closed it (confirmed by the typings: the doc comment only mentions
 * rejection for "configure has not been called yet or there's an error
 * presenting the sheet", never for a user-dismissed-without-redeeming case).
 * So this function can never itself distinguish "redeemed" from
 * "cancelled" — it always re-fetches `CustomerInfo` after the sheet closes
 * and returns it as `status: 'purchased'`, mirroring `purchasePackage`'s
 * shape exactly so the caller's existing `performPurchase` pipeline (and
 * `classifyPurchaseResult`) makes the ONLY decision that matters: whether
 * `entitlements.active[premium]` actually turned on. This is intentional,
 * not a gap — docs/13_assinaturas_e_billing.md §2/§10/§27: entitlement state
 * is never inferred from whether an SDK call "succeeded", only from
 * CustomerInfo itself.
 */
export async function redeemOfferCode(): Promise<PurchaseOutcome> {
  try {
    await ensureConfigured();
    await Purchases.presentCodeRedemptionSheet();
    const customerInfo = await Purchases.getCustomerInfo();
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if (isCancelledError(err)) {
      return { status: 'cancelled' };
    }
    logRevenueCatError('redeemOfferCode', err);
    return {
      status: 'error',
      message:
        err instanceof Error ? err.message : 'Não foi possível abrir o resgate de código da App Store.',
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
