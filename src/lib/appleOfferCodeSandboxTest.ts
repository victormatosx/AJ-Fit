import type { PurchasesPackage } from 'react-native-purchases';
import { resolveAndroidPlanKind, type ApplePurchaseRoute } from './subscriptionOffer';

/**
 * FASE iOS-4 — Sandbox-only bypass so a real Apple Offer Code (one of the 10
 * single-use Sandbox Codes generated in App Store Connect for "Influencer
 * Trial 7D") can be redeemed end-to-end via
 * `Purchases.presentCodeRedemptionSheet()` BEFORE `promoCodes/ARNALDO.appleOfferCodeMonthly`
 * is populated with a real, reusable Apple Offer Code (deliberately still
 * `null` — a Custom Code hasn't been created yet, see
 * docs/13_assinaturas_e_billing.md's FASE iOS-4 section).
 *
 * This module NEVER touches `resolveAuthorizedAppleOfferCode`/
 * `resolveApplePurchaseRoute` (`subscriptionOffer.ts`) — those stay the sole
 * production authority. In ANY build where `isAppleOfferCodeSandboxTestEnabled()`
 * is `false` (every production/release/TestFlight/App Store build, by
 * construction — see that function's doc comment), `appleOfferCodeMonthly
 * === null` continues to resolve to
 * `{kind:'blocked', reason:'promo_plan_unavailable'}` exactly as before this
 * phase — `applyAppleOfferCodeSandboxOverride` below is a pure no-op in that
 * case, never a different code path.
 */
export type AppleSandboxOverrideRoute =
  | ApplePurchaseRoute
  | { kind: 'sandbox_offer_redemption'; package: PurchasesPackage };

/**
 * Pure truth table, injected params — kept separate from
 * `isAppleOfferCodeSandboxTestEnabled()` below so both branches (dev bundle
 * true/false, flag present/absent/invalid) are directly unit-testable
 * without needing to fake React Native's `__DEV__` global.
 *
 * `sandboxFlagValue` must be the EXACT string `'true'` — no truthy-string
 * leniency (`'1'`, `'TRUE'`, `'yes'` all resolve to disabled). Absence
 * (`undefined`) resolves to disabled. This is deliberate: an env var that
 * merely needs to be non-empty defaults dangerously (a build tool copying
 * `.env.example`'s key with a placeholder would enable it); requiring the
 * exact literal `'true'` cannot be satisfied by accident.
 */
export function computeAppleOfferCodeSandboxTestEnabled(
  isDevBundle: boolean,
  sandboxFlagValue: string | undefined,
): boolean {
  return isDevBundle === true && sandboxFlagValue === 'true';
}

/**
 * Structurally fail-closed by construction, not by convention:
 *
 * - `__DEV__` is a React Native/Metro BUNDLE-TIME flag, not a runtime value
 *   an app or user can flip — it is `false` in every release JS bundle.
 *   Every EAS profile in `eas.json` (`preview`, `production`) and any real
 *   App Store/TestFlight submission ships a release bundle; only a
 *   `developmentClient` build or `expo start` produces a `__DEV__ === true`
 *   bundle. This alone already makes the bypass impossible in a build Apple
 *   could ever receive.
 * - `EXPO_PUBLIC_ENABLE_APPLE_OFFER_CODE_SANDBOX_TEST` is a second,
 *   independent, explicit opt-in read from `.env` (gitignored — see
 *   `.gitignore`'s `# local env files` section — and never referenced in
 *   `eas.json`, which has no `env` block for any profile today). Absence,
 *   `undefined`, or any value other than the exact string `'true'` all
 *   resolve to disabled.
 *
 * Both must hold simultaneously (`&&`, never `||`) — deliberate
 * defense-in-depth: a single misconfiguration (e.g. a stray `.env`
 * accidentally bundled into a `preview` build) is not enough on its own,
 * because `__DEV__` would still be `false` for that release bundle.
 */
export function isAppleOfferCodeSandboxTestEnabled(): boolean {
  const isDevBundle = typeof __DEV__ !== 'undefined' && __DEV__;
  return computeAppleOfferCodeSandboxTestEnabled(
    isDevBundle,
    process.env.EXPO_PUBLIC_ENABLE_APPLE_OFFER_CODE_SANDBOX_TEST,
  );
}

/**
 * Pure. Only ever WIDENS a `'blocked'`/`'promo_plan_unavailable'` route into
 * `'sandbox_offer_redemption'` — never touches `'package'` or an
 * already-authorized `'offer_redemption'` (a real `appleOfferCodeMonthly`
 * always takes the normal production path; the bypass is never consulted
 * once a real code exists). Requires the plan to be RECOGNIZED
 * (`resolveAndroidPlanKind` non-`null`) even with the flag on — an
 * unrecognized `packageType` stays blocked regardless of the sandbox flag,
 * since `resolveApplePurchaseRoute` collapses "unrecognized plan" and "plan
 * recognized but no offer code" into the same `'promo_plan_unavailable'`
 * reason, and this override must never widen the former. `promoApplied` is
 * re-checked here independently of `route`'s own shape — defense-in-depth:
 * even if a future caller ever passed a contrived `'blocked'` route without
 * `promoApplied` being true, this still refuses to override it.
 */
export function applyAppleOfferCodeSandboxOverride(
  pkg: PurchasesPackage,
  route: ApplePurchaseRoute,
  params: { sandboxTestEnabled: boolean; promoApplied: boolean },
): AppleSandboxOverrideRoute {
  if (!params.sandboxTestEnabled) return route;
  if (!params.promoApplied) return route;
  if (route.kind !== 'blocked' || route.reason !== 'promo_plan_unavailable') return route;
  if (resolveAndroidPlanKind(pkg) === null) return route;
  return { kind: 'sandbox_offer_redemption', package: pkg };
}
