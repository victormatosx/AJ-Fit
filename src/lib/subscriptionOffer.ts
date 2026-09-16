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
// Android SubscriptionOption routing below remains independent. FASE 6
// removed the retired Apple Offer Code client route.
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

/**
 * FASE 6.4 — the price actually charged going forward, never a computed
 * estimate. `pkg.product.priceString` is documented as "the price value of
 * defaultOption for Google Play" — for Android, `defaultOption` can BE a
 * trial/introductory SubscriptionOption when the store deems the account
 * eligible, which would show the intro/zero price instead of the ongoing
 * recurring price. To avoid that, this prefers the BASE PLAN
 * SubscriptionOption's own `fullPricePhase` (documented: "the full price
 * PricingPhase... after free and intro trials") when one exists —
 * unambiguous regardless of which option ends up as `defaultOption`. iOS
 * products never populate `subscriptionOptions` (Google Play only per the
 * SDK), so this falls through to `product.priceString` there exactly as
 * before — no behavior change on iOS.
 */
export function packagePriceString(pkg: PurchasesPackage): string {
  const basePlanOption = pkg.product.subscriptionOptions?.find((option) => option.isBasePlan);
  return basePlanOption?.fullPricePhase?.price.formatted ?? pkg.product.priceString;
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

/**
 * The backend-authorized identity of one Google Play offer
 * (`functions/src/attribution/types.ts`'s `AndroidSubscriptionOfferConfig`,
 * FASE 5.7 — same type as `promoCodeState.ts`'s `AndroidSubscriptionOfferConfig`,
 * re-exported under this name for this module's existing call sites).
 *
 * FASE 6.2: `findAuthorizedSubscriptionOption`/`resolvePurchaseRoute` below
 * only implement the `'legacy'` shape (unchanged behavior, preserved
 * byte-for-byte). A `'new'`-shape offer is a valid, successfully-parsed
 * authorization — NOT malformed — but this module deliberately does not yet
 * resolve an Offering/package for it (that requires searching
 * `offerings.all` by `offeringIdentifier`+`basePlanId`, analogous to the iOS
 * promotional resolution above, and purchasing via `purchasePackage` —
 * FASE 6.3, not implemented here). Until then, routing a `'new'`-shape offer
 * through `findAuthorizedSubscriptionOption` fails closed to `not_found`
 * (blocked) rather than guessing or falling back to the standard package.
 */
export type AuthorizedAndroidOffer =
  | { kind: 'legacy'; basePlanId: string; offerId: string }
  | { kind: 'new'; basePlanId: string; offeringIdentifier: string };

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
  // FASE 6.2: a 'new'-shape offer is a valid authorization, but resolving
  // it is a Package-level operation (Offering + basePlanId), not a
  // SubscriptionOption lookup inside an already-selected package — see this
  // function's doc comment. Never guessed/forced through the legacy id
  // match below; fails closed exactly like "no authorization at all".
  if (authorized.kind !== 'legacy') return { status: 'not_found' };

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

export type AndroidTrialSignal = 'none' | 'possible';

/**
 * FASE 6.4 — whether the STORE currently exposes a free-trial offer for
 * this specific package's product, independent of any coupon. Google Play
 * Billing (unlike StoreKit) only returns `SubscriptionOfferDetails` the
 * querying account is eligible for — so an offer suboption
 * (`!isBasePlan`) with a non-null `freePhase` being present at all is
 * already a store-side signal, not something this client invents. Even so,
 * this deliberately returns a non-committal `'possible'`, never a
 * guaranteed `'eligible'`: there is no Android equivalent of iOS's
 * `checkTrialOrIntroductoryPriceEligibility` this client can call to
 * independently confirm it, and the definitive decision always happens at
 * `purchasePackage` time, decided entirely by Google Play/RevenueCat. Never
 * derived from whether a coupon is applied — computed identically for the
 * standard and any promotional package.
 */
export function resolveAndroidTrialSignal(pkg: PurchasesPackage): AndroidTrialSignal {
  const options = pkg.product.subscriptionOptions;
  if (!options) return 'none';
  const hasTrialOffer = options.some(
    (option) => !option.isBasePlan && subscriptionOptionHasFreeTrial(option),
  );
  return hasTrialOffer ? 'possible' : 'none';
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
      reason:
        | 'promo_not_found'
        | 'promo_ambiguous'
        | 'promo_no_options'
        | 'promo_plan_unavailable'
        // FASE 6.3 — 'new'-shape Android resolution failures, see
        // `resolveAndroidNewOfferPackage`.
        | 'promo_offering_missing'
        | 'promo_package_missing'
        | 'promo_package_ambiguous';
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
// FASE 6.3 — Android 'new'-shape (offeringIdentifier) resolution.
//
// Unlike LEGACY (a SubscriptionOption lookup inside the already-selected
// STANDARD package), a 'new'-shape offer names a DIFFERENT RevenueCat
// Offering entirely. This layer never touches `offerings.current`, never
// reuses the standard/selected package as the purchase target, and never
// selects a SubscriptionOption manually — `purchasePackage` on the resolved
// package lets Google Play/RevenueCat decide automatically whether
// `trial-7d-new-subscriber` (or any other configured offer) applies. No
// Offering/product-id/offer-id string is ever hardcoded here: everything
// comes from the backend authorization (`AuthorizedAndroidOffer`) and the
// live `PurchasesOfferings` catalog.
// ---------------------------------------------------------------------------

export type AndroidNewOfferCatalogError =
  | 'promo_offering_missing'
  | 'promo_package_missing'
  | 'promo_package_ambiguous';

export type AndroidNewOfferPackageResolution =
  | { status: 'resolved'; offering: PurchasesOffering; package: PurchasesPackage }
  | { status: 'error'; reason: AndroidNewOfferCatalogError };

/**
 * Identifies whether `pkg`'s product has a BASE PLAN `SubscriptionOption`
 * (`isBasePlan: true`, the SDK's own explicit, documented flag — never
 * inferred from `product.identifier`'s naming convention, which is a
 * `subId:basePlanId` string format that happens to be true today but is
 * not the primary identity contract) whose `id` equals the authorized
 * `basePlanId`. Per the SDK's `SubscriptionOption.id` doc comment: "If this
 * SubscriptionOption represents a base plan, this will be the basePlanId" —
 * so `isBasePlan && id === basePlanId` is the most direct, documented way
 * to confirm a package corresponds to a specific base plan, immune to any
 * offer-suboption (`basePlanId:offerId`) being mistaken for the base plan
 * itself.
 */
function packageMatchesBasePlan(pkg: PurchasesPackage, basePlanId: string): boolean {
  const options = pkg.product.subscriptionOptions;
  if (!options) return false;
  return options.some((option) => option.isBasePlan && option.id === basePlanId);
}

/**
 * FASE 6.3 — resolves the EXACT `PurchasesPackage` for a 'new'-shape Android
 * authorization:
 * 1. Looks up `offeringIdentifier` in `offerings.all` EXACTLY — never
 *    `offerings.current`, regardless of whether a "Current" Offering
 *    exists or what it contains.
 * 2. Within that Offering's `availablePackages` (never any other
 *    Offering's), finds every package whose product has the authorized
 *    `basePlanId` as a base plan (`packageMatchesBasePlan`).
 * 3. Fails closed to a distinct, typed `error` — never guesses, never
 *    falls back to the standard/current package — when: the Offering
 *    doesn't exist (`promo_offering_missing`); zero packages match
 *    (`promo_package_missing`); more than one package matches
 *    (`promo_package_ambiguous`, a catalog misconfiguration — e.g. the same
 *    base plan id accidentally present on two products in the same
 *    Offering).
 */
export function resolveAndroidNewOfferPackage(
  offerings: PurchasesOfferings | null,
  authorized: Extract<AuthorizedAndroidOffer, { kind: 'new' }>,
): AndroidNewOfferPackageResolution {
  const offering = offerings?.all?.[authorized.offeringIdentifier];
  if (!offering) return { status: 'error', reason: 'promo_offering_missing' };

  const matches = offering.availablePackages.filter((pkg) =>
    packageMatchesBasePlan(pkg, authorized.basePlanId),
  );

  if (matches.length === 0) return { status: 'error', reason: 'promo_package_missing' };
  if (matches.length > 1) return { status: 'error', reason: 'promo_package_ambiguous' };

  return { status: 'resolved', offering, package: matches[0] };
}

/**
 * FASE 6.3 — THE full Android purchase-routing decision for BOTH shapes,
 * built on top of (never replacing) `resolvePurchaseRoute`:
 *
 * - LEGACY (`authorizedOffer.kind === 'legacy'`): delegates verbatim to
 *   `resolvePurchaseRoute` — byte-for-byte unchanged behavior, `pkg` (the
 *   standard/selected package) remains the purchase target via
 *   `purchaseSubscriptionOption`.
 * - NEW (`authorizedOffer.kind === 'new'`): `pkg` is used ONLY upstream (by
 *   the caller) to determine which plan is selected — it is NEVER the
 *   purchase target here. The purchase target is whatever
 *   `resolveAndroidNewOfferPackage` resolves from `offerings`, independent
 *   of `pkg`. A resolution failure blocks the route; it never falls back
 *   to `pkg`.
 */
export function resolveAndroidPurchaseRoute(
  pkg: PurchasesPackage,
  promoApplied: boolean,
  authorizedOffer: AuthorizedAndroidOffer | null,
  offerings: PurchasesOfferings | null,
): PurchaseRoute {
  if (!promoApplied) return { kind: 'package', package: pkg };
  if (!authorizedOffer) return { kind: 'blocked', reason: 'promo_plan_unavailable' };

  if (authorizedOffer.kind === 'legacy') {
    return resolvePurchaseRoute(pkg, promoApplied, authorizedOffer);
  }

  const resolution = resolveAndroidNewOfferPackage(offerings, authorizedOffer);
  if (resolution.status === 'error') {
    return { kind: 'blocked', reason: resolution.reason };
  }
  return { kind: 'package', package: resolution.package };
}

/**
 * FASE 6.3 — Paywall DISPLAY override so a 'new'-shape plan never shows the
 * STANDARD package's price/terms while `purchasePackage` would actually buy
 * a different (promotional) product. For each standard package, if its plan
 * (monthly/annual) has a successfully-resolved 'new'-shape authorization,
 * the resolved promotional package REPLACES it in the returned list; every
 * other entry (unconfigured, or a resolution failure) is returned
 * unchanged. A resolution failure here is NOT a purchase decision — it only
 * means the browsing UI keeps showing the standard price for that plan; the
 * actual purchase is independently and always blocked by
 * `resolveAndroidPurchaseRoute` in that same failure case, so this function
 * degrading to the standard package on error can never result in buying the
 * wrong product.
 */
export function applyAndroidPromoPackageOverrides(
  standardPackages: PurchasesPackage[],
  offerings: PurchasesOfferings | null,
  androidStoreConfig: {
    monthly: AuthorizedAndroidOffer | null;
    annual: AuthorizedAndroidOffer | null;
  } | null,
): PurchasesPackage[] {
  if (!androidStoreConfig) return standardPackages;
  return standardPackages.map((pkg) => {
    const planKind = resolveAndroidPlanKind(pkg);
    const authorized = planKind ? androidStoreConfig[planKind] : null;
    if (!authorized || authorized.kind !== 'new') return pkg;
    const resolution = resolveAndroidNewOfferPackage(offerings, authorized);
    return resolution.status === 'resolved' ? resolution.package : pkg;
  });
}
