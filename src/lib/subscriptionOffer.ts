import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesOfferings,
  PurchasesPackage,
  SubscriptionOption,
} from 'react-native-purchases';
import {
  parseIOSPromotionAuthorization,
  type IOSPromotionAuthorization,
} from './promoCodeState';

export function getCurrentOfferingPackages(
  offerings: PurchasesOfferings | null,
): PurchasesPackage[] {
  return offerings?.current?.availablePackages ?? [];
}

export type OfferingViewState =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error'
  | 'empty'
  | 'unavailable';

export function resolveOfferingViewState({
  offerings,
  loading,
  error,
  offline,
  unavailable,
}: {
  offerings: PurchasesOfferings | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  unavailable: boolean;
}): OfferingViewState {
  if ((!offerings && !error && !unavailable) || (loading && !offerings)) return 'loading';
  if (unavailable) return 'unavailable';

  const packages = getCurrentOfferingPackages(offerings);
  if (error && packages.length === 0) return offline ? 'offline' : 'error';
  return packages.length > 0 ? 'ready' : 'empty';
}

/** Keeps a valid user selection, otherwise follows the Offering's own order. */
export function resolveSelectedPackage(
  packages: PurchasesPackage[],
  selectedId: string | null,
): PurchasesPackage | null {
  return packages.find((pkg) => pkg.identifier === selectedId) ?? packages[0] ?? null;
}

// ---------------------------------------------------------------------------
// FASE 4 — explicit iOS Offering + promotional SKU resolution.
//
// This layer deliberately stops at returning a verified PurchasesPackage.
// It never calls purchasePackage and never creates a purchase intent. The
// legacy Apple Offer Code and Android SubscriptionOption routes below remain
// independent and unchanged during this migration phase.
// ---------------------------------------------------------------------------

export type IOSSubscriptionPlan = 'monthly' | 'annual';

export type IOSOfferingRoute =
  | { kind: 'standard' }
  | { kind: 'promotional'; authorization: IOSPromotionAuthorization }
  | { kind: 'blocked'; reason: 'promo_authorization_invalid' };

/**
 * Builds the commercial route exclusively from the backend field. There is
 * intentionally no `promoApplied`, coupon text, campaign name, or SKU
 * heuristic parameter in this API, so those values cannot authorize a
 * promotional Offering by accident.
 */
export function resolveIOSOfferingRoute(iosPromotion: unknown): IOSOfferingRoute {
  const parsed = parseIOSPromotionAuthorization(iosPromotion);
  if (parsed.status === 'absent') return { kind: 'standard' };
  if (parsed.status === 'invalid') {
    return { kind: 'blocked', reason: 'promo_authorization_invalid' };
  }
  return { kind: 'promotional', authorization: parsed.authorization };
}

export type IOSCatalogResolutionError =
  | 'promo_authorization_invalid'
  | 'promo_offering_missing'
  | 'promo_package_missing'
  | 'promo_package_type_mismatch'
  | 'promo_product_mismatch'
  | 'promo_package_ambiguous'
  | 'standard_offering_missing'
  | 'standard_package_missing';

export type IOSOfferingResolution =
  | {
      status: 'resolved';
      route: Exclude<IOSOfferingRoute, { kind: 'blocked' }>;
      offering: PurchasesOffering;
    }
  | { status: 'error'; reason: IOSCatalogResolutionError };

/** Selects Current for standard, or the exact backend-authorized key in `all` for promotion. */
export function resolveIOSOffering(
  offerings: PurchasesOfferings | null,
  route: IOSOfferingRoute,
): IOSOfferingResolution {
  if (route.kind === 'blocked') return { status: 'error', reason: route.reason };
  if (route.kind === 'standard') {
    return offerings?.current
      ? { status: 'resolved', route, offering: offerings.current }
      : { status: 'error', reason: 'standard_offering_missing' };
  }

  const offering = offerings?.all?.[route.authorization.offeringIdentifier];
  return offering
    ? { status: 'resolved', route, offering }
    : { status: 'error', reason: 'promo_offering_missing' };
}

export type IOSPackageResolution =
  | {
      status: 'resolved';
      route: Exclude<IOSOfferingRoute, { kind: 'blocked' }>;
      offering: PurchasesOffering;
      package: PurchasesPackage;
    }
  | { status: 'error'; reason: IOSCatalogResolutionError };

const PACKAGE_TYPE_BY_IOS_PLAN = {
  monthly: 'MONTHLY',
  annual: 'ANNUAL',
} as const;

/** Maps only the two plans this Paywall supports; every other package type is non-routable. */
export function resolveIOSPlanKind(pkg: PurchasesPackage): IOSSubscriptionPlan | null {
  if (pkg.packageType === 'MONTHLY') return 'monthly';
  if (pkg.packageType === 'ANNUAL') return 'annual';
  return null;
}

/**
 * Resolves a package inside an already-resolved Offering. Promotional
 * packages require BOTH the expected packageType and exact authorized
 * product identifier; every inconsistency is a typed error with no fallback.
 */
export function resolveIOSPackage(
  offeringResolution: IOSOfferingResolution,
  plan: IOSSubscriptionPlan,
): IOSPackageResolution {
  if (offeringResolution.status === 'error') return offeringResolution;

  const { route, offering } = offeringResolution;
  const expectedPackageType = PACKAGE_TYPE_BY_IOS_PLAN[plan];
  const packagesForType = offering.availablePackages.filter(
    (pkg) => pkg.packageType === expectedPackageType,
  );

  if (route.kind === 'standard') {
    const pkg = packagesForType[0];
    return pkg
      ? { status: 'resolved', route, offering, package: pkg }
      : { status: 'error', reason: 'standard_package_missing' };
  }

  const expectedProductId =
    plan === 'monthly'
      ? route.authorization.monthlyProductId
      : route.authorization.annualProductId;
  const exactMatches = packagesForType.filter(
    (pkg) => pkg.product.identifier === expectedProductId,
  );

  if (exactMatches.length === 1) {
    return { status: 'resolved', route, offering, package: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    return { status: 'error', reason: 'promo_package_ambiguous' };
  }

  const productExistsUnderWrongType = offering.availablePackages.some(
    (pkg) =>
      pkg.product.identifier === expectedProductId && pkg.packageType !== expectedPackageType,
  );
  if (productExistsUnderWrongType) {
    return { status: 'error', reason: 'promo_package_type_mismatch' };
  }
  if (packagesForType.length === 0) {
    return { status: 'error', reason: 'promo_package_missing' };
  }
  return { status: 'error', reason: 'promo_product_mismatch' };
}

export function resolveIOSSubscriptionPackage(
  offerings: PurchasesOfferings | null,
  route: IOSOfferingRoute,
  plan: IOSSubscriptionPlan,
): IOSPackageResolution {
  return resolveIOSPackage(resolveIOSOffering(offerings, route), plan);
}

export type IOSPromotionalCatalogResolution =
  | {
      status: 'resolved';
      route: Extract<IOSOfferingRoute, { kind: 'promotional' }>;
      offering: PurchasesOffering;
      monthlyPackage: PurchasesPackage;
      annualPackage: PurchasesPackage;
    }
  | { status: 'error'; reason: IOSCatalogResolutionError };

/**
 * FASE 5 requires the promotional Offering to be commercially coherent for
 * both plans before replacing the visible Current catalog. A partial catalog
 * never produces a one-plan Paywall and never falls back to standard SKUs.
 */
export function resolveIOSPromotionalCatalog(
  offerings: PurchasesOfferings | null,
  route: IOSOfferingRoute,
): IOSPromotionalCatalogResolution {
  if (route.kind === 'blocked') return { status: 'error', reason: route.reason };
  if (route.kind !== 'promotional') {
    return { status: 'error', reason: 'promo_authorization_invalid' };
  }

  const monthly = resolveIOSSubscriptionPackage(offerings, route, 'monthly');
  if (monthly.status === 'error') return monthly;
  const annual = resolveIOSSubscriptionPackage(offerings, route, 'annual');
  if (annual.status === 'error') return annual;

  return {
    status: 'resolved',
    route,
    offering: monthly.offering,
    monthlyPackage: monthly.package,
    annualPackage: annual.package,
  };
}

export function packageTitle(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'ANNUAL':
      return 'Anual';
    case 'MONTHLY':
      return 'Mensal';
    case 'WEEKLY':
      return 'Semanal';
    case 'SIX_MONTH':
      return 'Semestral';
    case 'THREE_MONTH':
      return 'Trimestral';
    case 'TWO_MONTH':
      return 'Bimestral';
    case 'LIFETIME':
      return 'Vitalício';
    default:
      return pkg.product.title;
  }
}

export function packagePeriodLabel(pkg: PurchasesPackage): string {
  if (pkg.packageType === 'LIFETIME') return 'pagamento único';

  const period = pkg.product.subscriptionPeriod;
  const match = period?.match(/^P(\d+)([DWMY])$/);
  if (!match) return '';

  const amount = Number(match[1]);
  const labels = {
    D: ['dia', 'dias'],
    W: ['semana', 'semanas'],
    M: ['mês', 'meses'],
    Y: ['ano', 'anos'],
  } as const;
  const [singular, plural] = labels[match[2] as keyof typeof labels];
  return amount === 1 ? `por ${singular}` : `a cada ${amount} ${plural}`;
}

export function packagePriceString(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

type PurchaseResult =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error' };

type RestoreResult =
  | { status: 'restored'; customerInfo: CustomerInfo }
  | { status: 'error' };

export type PurchaseResultKind = 'premium' | 'missing-entitlement' | 'cancelled' | 'error';
export type RestoreResultKind = 'premium' | 'missing-entitlement' | 'error';

function hasActiveEntitlement(customerInfo: CustomerInfo, entitlementId: string): boolean {
  return Boolean(customerInfo.entitlements.active[entitlementId]);
}

export function classifyPurchaseResult(
  result: PurchaseResult,
  entitlementId: string,
): PurchaseResultKind {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'error') return 'error';
  return hasActiveEntitlement(result.customerInfo, entitlementId)
    ? 'premium'
    : 'missing-entitlement';
}

export function classifyRestoreResult(
  result: RestoreResult,
  entitlementId: string,
): RestoreResultKind {
  if (result.status === 'error') return 'error';
  return hasActiveEntitlement(result.customerInfo, entitlementId)
    ? 'premium'
    : 'missing-entitlement';
}

// ---------------------------------------------------------------------------
// Fase 4C.2 — promo-code SubscriptionOption matching (Android only).
//
// react-native-purchases@10.6.0's `SubscriptionOption.id` is documented and
// confirmed (Fase 4C audit, and now proven on a real Android device — Fase
// 4C.4D/4C.4E) to be `basePlanId` alone (a base plan) or `basePlanId:offerId`
// (an offer under that base plan) — never anything else. This is the ONLY
// identity comparison used below; never `.includes`/`.endsWith`/
// `.startsWith`, never `tags` as a primary identifier (tags are exposed as a
// UX/analytics signal only — `rc-ignore-offer` in particular must NOT be
// filtered out here, it only affects the SDK's own automatic `defaultOption`
// selection, never explicit `subscriptionOptions` lookups — confirmed both by
// RevenueCat's docs and by the device catalog dump, which still listed the
// tagged offer in `subscriptionOptions`), never `defaultOption`, never array
// position. See `findAuthorizedSubscriptionOption`'s doc comment below for
// the Fase 4C.4E fix to the (non-primary) `storeProductId` defense check.
// ---------------------------------------------------------------------------

/** The backend-authorized identity of one Google Play offer (functions/src/attribution/types.ts's `AndroidSubscriptionOfferConfig`, duplicated client-side — see `promoCodeService.ts`). */
export interface AuthorizedAndroidOffer {
  basePlanId: string;
  offerId: string;
}

export type SubscriptionOptionMatchResult =
  | { status: 'match'; option: SubscriptionOption }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matchCount: number }
  | { status: 'no_options' };

/**
 * Locates EXACTLY one `SubscriptionOption` matching a backend-authorized
 * `(basePlanId, offerId)` pair inside `pkg.product.subscriptionOptions`.
 * Fail-closed by construction: every outcome other than exactly one match
 * is a distinct, non-`match` status — the caller decides what to do, but
 * this function never picks a "best guess" among 0 or >1 candidates.
 *
 * FASE 4C.4E — root-cause fix for a false `not_found` proven on a real
 * Android device (Fase 4C.4D smoke test): the secondary defense-in-depth
 * check used to be `option.productId === pkg.product.identifier`, which
 * compares two DIFFERENT semantic levels and can never be true for a real
 * Google Play base-plan product. Per the installed
 * `@revenuecat/purchases-typescript-internal` typings (offerings.d.ts) —
 * confirmed against the device log:
 *   - `SubscriptionOption.productId` is documented, and was observed on
 *     device, as the bare subscription id alone — `"ajfit_premium"`, never
 *     scoped to a base plan.
 *   - `SubscriptionOption.storeProductId` is documented as `subId:basePlanId`
 *     — this is what actually equals `pkg.product.identifier` for a Google
 *     Play base-plan product (RevenueCat's own Android product identifiers
 *     are named this way — e.g. `"ajfit_premium:monthly"`,
 *     `"ajfit_premium:annual"`, matching the dashboard/`revenueCatService.ts`
 *     package→product mapping).
 * So the old condition compared `"ajfit_premium"` against
 * `"ajfit_premium:monthly"` — never equal — and silently rejected every
 * correct match, even though `id` equality (the primary identity check) was
 * already correct. The pre-4C.4E unit tests never caught this because their
 * mocks defaulted BOTH sides to the same bare constant, which happens to be
 * true for `productId` but was never actually what `pkg.product.identifier`
 * looks like on a real Android base-plan device. Fixed to
 * `option.storeProductId === pkg.product.identifier`, which compares the
 * same semantic level on both sides.
 *
 * Still defense-in-depth, not the primary identity check (Fase 4C.2 §13):
 * since `options` is read from `pkg.product.subscriptionOptions` itself,
 * every option already structurally belongs to `pkg.product` — the SDK has
 * no documented mechanism to put a foreign product's option in this array,
 * so this check is redundant by construction today. It costs nothing and
 * guards against a class of bug neither audit can rule out for a future SDK
 * version (or a caller upstream passing a mismatched `pkg`/`authorized`
 * pair) — it is not treated as, and must never become, the actual
 * authorization boundary. `id` equality against
 * `` `${basePlanId}:${offerId}` `` remains the sole, sufficient identity
 * check per the Fase 4C audit.
 */
export function findAuthorizedSubscriptionOption(
  pkg: PurchasesPackage,
  authorized: AuthorizedAndroidOffer | null,
): SubscriptionOptionMatchResult {
  if (!authorized) return { status: 'not_found' };

  const options = pkg.product.subscriptionOptions;
  if (!options || options.length === 0) return { status: 'no_options' };

  const wantedId = `${authorized.basePlanId}:${authorized.offerId}`;
  const matches = options.filter(
    (option) => option.id === wantedId && option.storeProductId === pkg.product.identifier,
  );

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous', matchCount: matches.length };
  return { status: 'match', option: matches[0] };
}

/**
 * UX-only signal (Fase 4C.2 §15) — NEVER used to authorize or reject a
 * match. `findAuthorizedSubscriptionOption` alone decides whether an
 * option is authorized; whether it happens to carry a free-trial pricing
 * phase is a separate, informational fact a future screen may want to
 * display ("Oferta promocional disponível"), not a gate.
 */
export function subscriptionOptionHasFreeTrial(option: SubscriptionOption): boolean {
  return option.freePhase !== null;
}

export type AndroidPlanKind = 'monthly' | 'annual';

/**
 * Maps a selected `PurchasesPackage` to which half of
 * `storeConfig.android` applies — fail-closed (§16): any `packageType`
 * other than the two RevenueCat predefined identifiers this app actually
 * sells (`MONTHLY`/`ANNUAL` — see `packageTitle` above) returns `null`,
 * never a guess.
 */
export function resolveAndroidPlanKind(pkg: PurchasesPackage): AndroidPlanKind | null {
  if (pkg.packageType === 'MONTHLY') return 'monthly';
  if (pkg.packageType === 'ANNUAL') return 'annual';
  return null;
}

/**
 * Combines plan-kind resolution with the applied code's Android
 * `storeConfig` to get the offer authorized FOR THIS SPECIFIC PACKAGE, or
 * `null` if the package can't be safely mapped or no config exists for
 * that plan (§16, fail-closed).
 *
 * Deliberately a pure, DERIVED computation rather than something stored in
 * `PromoCodeState` — recomputed fresh from whatever `selectedPackage` is
 * current on every render, so a package/plan switch (mensal ⇄ anual)
 * invalidates itself automatically by never having cached a match to begin
 * with (Fase 4C.2 §9's "Offering/package relevante mudar" requirement is
 * satisfied by construction, not by an explicit invalidation step).
 */
export function resolveAuthorizedAndroidOffer(
  pkg: PurchasesPackage,
  androidStoreConfig: {
    monthly: AuthorizedAndroidOffer | null;
    annual: AuthorizedAndroidOffer | null;
  } | null,
): AuthorizedAndroidOffer | null {
  if (!androidStoreConfig) return null;
  const planKind = resolveAndroidPlanKind(pkg);
  if (!planKind) return null;
  return androidStoreConfig[planKind];
}

// ---------------------------------------------------------------------------
// Fase 4C.3 — the purchase-routing decision. Two legitimate paths only
// (§4): no promo code applied → the normal Package; a promo code applied →
// the promotional SubscriptionOption, ONLY when it can be proven to exist
// unambiguously. Never a third, silent path from "promotional but
// unprovable" back down to "normal price" — see `PurchaseRoute`'s
// `'blocked'` variant, which the caller must render as a stop, not as a
// license to call `purchasePackage` instead (§5).
// ---------------------------------------------------------------------------

export type PurchaseRoute =
  | { kind: 'package'; package: PurchasesPackage }
  | { kind: 'subscription_option'; option: SubscriptionOption }
  | {
      kind: 'blocked';
      reason: 'promo_not_found' | 'promo_ambiguous' | 'promo_no_options' | 'promo_plan_unavailable';
    };

/**
 * Pure. `pkg` is the already-selected package (caller guards a null
 * selection before invoking — same precondition `handlePurchase` already
 * has today). `authorizedOffer` is `null` in exactly two situations that
 * this function deliberately treats the same way (`'promo_plan_unavailable'`):
 * no promo config exists for `pkg`'s plan at all, OR a plan/code mismatch
 * (see `resolveAuthorizedAndroidOffer`) — both mean "no commercial
 * authorization exists for this exact package", which is a DIFFERENT,
 * earlier failure than `'promo_not_found'` (a real authorization exists,
 * but the live RevenueCat catalog doesn't currently expose a matching
 * `SubscriptionOption` for it — e.g. Store/RevenueCat sync lag).
 *
 * Reuses `findAuthorizedSubscriptionOption` verbatim — this function does
 * no matching of its own, only routes based on its result.
 */
export function resolvePurchaseRoute(
  pkg: PurchasesPackage,
  promoApplied: boolean,
  authorizedOffer: AuthorizedAndroidOffer | null,
): PurchaseRoute {
  if (!promoApplied) return { kind: 'package', package: pkg };

  if (!authorizedOffer) {
    return { kind: 'blocked', reason: 'promo_plan_unavailable' };
  }

  const match = findAuthorizedSubscriptionOption(pkg, authorizedOffer);
  switch (match.status) {
    case 'match':
      return { kind: 'subscription_option', option: match.option };
    case 'not_found':
      return { kind: 'blocked', reason: 'promo_not_found' };
    case 'ambiguous':
      return { kind: 'blocked', reason: 'promo_ambiguous' };
    case 'no_options':
      return { kind: 'blocked', reason: 'promo_no_options' };
  }
}

// ---------------------------------------------------------------------------
// FASE iOS-3 — Apple Offer Code routing. Structurally different from the
// Android section above, not a port of it: an App Store custom offer code is
// a single flat string per plan (`PromoCodeAppleStoreConfig` in
// `promoCodeState.ts` — no `basePlanId`, the App Store has no equivalent
// concept), and there is no live SDK catalog to match it against —
// `SubscriptionOption`/`pkg.product.subscriptionOptions` is a Google
// Play-only concept (confirmed in the installed
// `@revenuecat/purchases-typescript-internal` typings, same audit trail
// `findAuthorizedSubscriptionOption`'s doc comment above already
// references). The only officially supported mechanism this SDK version
// (react-native-purchases@10.6.0) exposes for redeeming an Apple Offer Code
// is `Purchases.presentCodeRedemptionSheet()` — StoreKit's native sheet,
// which the user completes themselves; there is no API to submit a specific
// code string programmatically (see `revenueCatService.ts`'s
// `redeemOfferCode` doc comment for the full audit). So, unlike the Android
// path, resolving a route here never proves a live match — it only proves
// the backend-authorized catalog has an offer code configured for the
// selected plan, which is the one fact the client can know before handing
// control to Apple's own UI.
// ---------------------------------------------------------------------------

/** Matches `PromoCodeAppleStoreConfig` (promoCodeState.ts) — duplicated field-for-field for the same reason `AuthorizedAndroidOffer` duplicates its backend counterpart above. */
export interface AuthorizedAppleOfferCodes {
  offerCodeMonthly: string | null;
  offerCodeAnnual: string | null;
}

/**
 * Mirrors `resolveAuthorizedAndroidOffer` for the Apple side. Reuses
 * `resolveAndroidPlanKind` as-is — despite its name, that function only maps
 * RevenueCat's own `packageType` (`MONTHLY`/`ANNUAL`) to a plan kind, which
 * has nothing to do with which store sold the package; duplicating that
 * three-line switch here would be the actual antipattern. Fail-closed the
 * same way as the Android version: an unmappable `packageType` or no
 * catalog entry for that plan both resolve to `null`, never a guess.
 */
export function resolveAuthorizedAppleOfferCode(
  pkg: PurchasesPackage,
  appleStoreConfig: AuthorizedAppleOfferCodes | null,
): string | null {
  if (!appleStoreConfig) return null;
  const planKind = resolveAndroidPlanKind(pkg);
  if (!planKind) return null;
  return planKind === 'monthly' ? appleStoreConfig.offerCodeMonthly : appleStoreConfig.offerCodeAnnual;
}

export type ApplePurchaseRoute =
  | { kind: 'package'; package: PurchasesPackage }
  | { kind: 'offer_redemption'; offerCode: string; package: PurchasesPackage }
  | { kind: 'blocked'; reason: 'promo_plan_unavailable' };

/**
 * Pure. Mirrors `resolvePurchaseRoute`'s two-legitimate-paths shape: no
 * promo applied → normal package purchase; promo applied → Apple Offer Code
 * redemption ONLY when the backend-authorized catalog proves a code exists
 * for the selected plan. Never falls back to `'package'` once `promoApplied`
 * is true and no code exists for that plan — that would silently sell the
 * non-promotional price after a promo code was already confirmed valid by
 * the backend, exactly the failure mode this routing exists to prevent.
 * `'offer_redemption'` never means "redeemed" — it only means "there is a
 * code to present via `presentCodeRedemptionSheet()`"; whether the user
 * actually completes it in Apple's sheet is unknowable here and is decided
 * later, exclusively by `CustomerInfo.entitlements.active` (see
 * `classifyPurchaseResult` above — reused verbatim, never duplicated, for
 * the Apple redemption outcome too).
 */
export function resolveApplePurchaseRoute(
  pkg: PurchasesPackage,
  promoApplied: boolean,
  authorizedOfferCode: string | null,
): ApplePurchaseRoute {
  if (!promoApplied) return { kind: 'package', package: pkg };
  if (!authorizedOfferCode) return { kind: 'blocked', reason: 'promo_plan_unavailable' };
  return { kind: 'offer_redemption', offerCode: authorizedOfferCode, package: pkg };
}
