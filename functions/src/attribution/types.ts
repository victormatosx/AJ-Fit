import type { Timestamp } from 'firebase-admin/firestore';
import type { PromoCodePlatform, PromoPurchasePlan } from './constants';

/**
 * Types for the attribution/promo-code module. See
 * docs/13_assinaturas_e_billing.md §33 ("Arquitetura de Atribuição de
 * Usuários") for the original architecture decision and §8/§34 for the
 * business rules these types encode. `constants.ts`'s doc comment on
 * `COUPON_REDEMPTIONS_COLLECTION` explains the one real deviation from §33
 * this task introduces: a mutable per-uid lifecycle record instead of an
 * append-only event log.
 */

/**
 * A Google Play base plan authorization for one promotional plan. Exactly
 * TWO valid non-null shapes exist (FASE 5.3/5.7) — `basePlanId` is always
 * required, and `offerId`/`offeringIdentifier` are mutually exclusive:
 *
 * - LEGACY (`offerId` set, `offeringIdentifier` null) — pre-5.3 influencer
 *   coupons: identifies one exact `SubscriptionOption`
 *   (`` `${basePlanId}:${offerId}` ``) the client must purchase explicitly
 *   via `purchaseSubscriptionOption`, and the webhook must correlate
 *   exactly on both fields — unchanged behavior, preserved byte-for-byte
 *   for every existing catalog/redemption document.
 * - NEW (`offeringIdentifier` set, `offerId` null) — FASE 5.7: the coupon
 *   selects only the promotional BASE PLAN (e.g. `monthly-promo`/
 *   `annual-promo`) and the RevenueCat Offering the client must resolve
 *   that base plan's `PurchasesPackage` from (e.g. `coupon_discount` — a
 *   catalog value, never hardcoded here or assumed universal). The client
 *   purchases via `purchasePackage`, never forcing a specific
 *   `SubscriptionOption`; which one applies (the `trial-7d-new-subscriber`
 *   offer if the user is eligible, or the bare base plan otherwise) is
 *   decided entirely by Google Play/RevenueCat. Correlation matches on
 *   `basePlanId` alone (see `googlePlayOfferCorrelation.ts`) —
 *   `offeringIdentifier` is a CLIENT-side concern only (which Offering to
 *   search), irrelevant to the webhook, which never receives it.
 *
 * `offerId` and `offeringIdentifier` both set, or both null while
 * `basePlanId` is set, are REJECTED at admin write time
 * (`promoCodeAdminValidation.ts`) and resolve to `null` for the whole plan
 * at catalog read time (`promoCodeCatalog.ts`'s `resolveAndroidOfferPair`)
 * — an ambiguous or incomplete config is never partially trusted.
 */
export interface AndroidSubscriptionOfferConfig {
  basePlanId: string;
  offerId: string | null;
  offeringIdentifier: string | null;
}

/**
 * FASE 4C.3A — the Android promotional-offer configuration authorized for
 * one `couponRedemptions/{uid}` record AT THE MOMENT it was applied
 * (`validatePromoCode`/`applyPromoCodeAttributionTransactionally`), snapshot
 * into the redemption itself rather than re-read from `promoCodes/{code}`
 * later. This is deliberate: the catalog can change (an admin edits/
 * deactivates a code) AFTER a user applied it but BEFORE the store confirms
 * the purchase — the webhook must correlate against what was authorized
 * WHEN THE USER APPLIED THE CODE, never against the catalog's current
 * state.
 */
export interface PromoCodeAndroidOfferSnapshot {
  monthly: AndroidSubscriptionOfferConfig | null;
  annual: AndroidSubscriptionOfferConfig | null;
}

/**
 * FASE 1 (migração Promo SKU + Introductory Offer) — the iOS promotional
 * authorization for one campaign: which RevenueCat Offering (never Current)
 * and which two App Store Connect promotional product identifiers (each
 * carrying its own Apple Introductory Offer, configured externally in App
 * Store Connect — this backend never grants a trial itself, docs §6/§34)
 * this campaign is authorized to route a user through.
 *
 * This is the only active iOS promotional catalog contract. Historical
 * Apple Offer Code fields may coexist in old Firestore documents, but are
 * intentionally outside this model and ignored by active readers.
 *
 * All three fields are required together — a campaign is either fully
 * configured for the iOS promotional flow or not configured at all
 * (`iosPromotion === null`). There is no "monthly only" partial state like
 * the Android/legacy-Apple pairs: `offeringIdentifier` covers both plans,
 * so a partial config (e.g. `monthlyProductId` set without `annualProductId`)
 * is a data-integrity problem in the catalog document itself, not a valid
 * campaign, and `promoCodeCatalog.ts`'s parser fails the WHOLE document
 * rather than exposing part of it.
 */
export interface IOSPromotionConfig {
  /** RevenueCat Offering identifier (e.g. `"promo_7d"`) — never `default`/Current; only ever what the backend derived from the catalog, never client-supplied (docs §12/§34). */
  offeringIdentifier: string;
  /** App Store Connect product identifier for the monthly promotional SKU (e.g. `"ajfit_premium_monthly_promo"`). */
  monthlyProductId: string;
  /** App Store Connect product identifier for the annual promotional SKU (e.g. `"ajfit_premium_annual_promo"`). */
  annualProductId: string;
}

/**
 * FASE 2 — short-lived, backend-authored evidence that this uid was allowed
 * to attempt one promotional iOS purchase. It is nested in the authoritative
 * `couponRedemptions/{uid}` record, so there can be only one active intent per
 * uid and campaign attribution remains colocated with its authorization.
 */
interface PromoPurchaseIntentBase {
  /** Derived from the redemption snapshot; never accepted from the client. */
  campaignId: string;
  /** The only business choice accepted from the authenticated client. */
  plan: PromoPurchasePlan;
  /** Derived from `iosPromotion.{monthly,annual}ProductId`. */
  expectedProductId: string;
  /** Derived from `iosPromotion.offeringIdentifier`. */
  offeringIdentifier: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}

export interface PendingPromoPurchaseIntent extends PromoPurchaseIntentBase {
  status: 'purchase_pending';
}

/** FASE 3 — immutable audit evidence left by the matching webhook transaction. */
export interface ConfirmedPromoPurchaseIntent extends PromoPurchaseIntentBase {
  status: 'purchase_confirmed';
  /** RevenueCat's event clock for the webhook that confirmed this intent. */
  confirmedAt: Timestamp;
  /** Stable RevenueCat webhook event ID used to recognize an exact retry. */
  revenueCatEventId: string;
}

export type PromoPurchaseIntent = PendingPromoPurchaseIntent | ConfirmedPromoPurchaseIntent;

/**
 * Server-managed lifecycle record for one Firebase uid's promo-code
 * attribution. Lives in `couponRedemptions/{uid}` (doc ID == uid — see
 * `COUPON_REDEMPTIONS_COLLECTION`/`couponRedemptionDocPath` in
 * constants.ts). THE source of truth for attribution (docs §8/§24/§33).
 *
 * Written exclusively by the backend (Admin SDK) — the client never writes
 * this collection (see firestore.rules).
 *
 * FASE 4C.3A: `androidOffer` was added — the commercial snapshot the
 * webhook correlates a real purchase against before confirming/locking
 * (see `googlePlayOfferCorrelation.ts`). `trialStartedAt`/`convertedAt`/
 * `lockedAt` are still only ever set by `applyAttributionRevenueCatEvent`
 * (the RevenueCat webhook confirmation path), and now ONLY when that
 * correlation succeeds — see that function's doc comment.
 */
export interface CouponRedemption {
  /** Firebase uid — coupons are tied to accounts, never bare emails (docs §8). Same value as the document ID. */
  uid: string;
  /** Normalized code currently attributed to this uid (see `normalizePromoCode`). */
  couponCode: string;
  /** Marketing campaign this code belongs to (docs §34: used to pick a RevenueCat Offering — never to grant access directly). */
  campaignId: string;
  /** Influencer this code is attributed to. */
  influencerId: string;
  /**
   * The Android offer configuration authorized for `couponCode` AT
   * APPLICATION TIME — see `PromoCodeAndroidOfferSnapshot`'s doc comment
   * for why this is a snapshot, never re-derived from the live catalog.
   * Always present going forward (written on every apply/swap); ABSENT on
   * documents created before Fase 4C.3A — `attributionSync.ts`'s defensive
   * reader treats that absence as `null` (fail-closed, docs §20: never
   * silently reconstructed from the catalog).
   */
  androidOffer: PromoCodeAndroidOfferSnapshot;
  /**
   * FASE 1 — the iOS promotional (Offering/SKU) authorization for
   * `couponCode` AT APPLICATION TIME, snapshotted verbatim from the catalog
   * exactly like `androidOffer` above
   * (see `IOSPromotionConfig`'s doc comment for why editing
   * `promoCodes/{code}` later must never silently change an already-applied
   * redemption). Historical documents may still contain the retired
   * `appleOffer`/`appleOfferCorrelation` fields; active code deliberately
   * ignores them. `null` when the campaign has no iOS promotional
   * configuration (expected for a campaign that only targets Android, or
   * during the migration before a campaign has been configured for the new
   * flow). Frozen forever once `lockedAt` is set, same as every other
   * snapshot field — `applyAttributionRevenueCatEvent` never writes it.
   */
  iosPromotion: IOSPromotionConfig | null;
  /** FASE 2/3 — absent until authorization; preserved as confirmed audit evidence after match. */
  purchaseIntent?: PromoPurchaseIntent;
  /** Immutable commercial origin captured from the correlated INITIAL_PURCHASE; ownership transfers never rewrite it. */
  subscriptionOrigin?: {
    transactionKey: string;
    originalTransactionId: string;
    transactionId: string;
    revenueCatEventId: string;
    store: string;
    productId: string;
    confirmedAt: Timestamp;
  };
  /** When the CURRENT `couponCode` was applied — reset on every swap while pending. */
  appliedAt: Timestamp;
  /** When this uid's first-ever promo code was applied — preserved across swaps, unlike `appliedAt`. */
  createdAt: Timestamp;
  /** Server timestamp of the most recent write to this document. */
  updatedAt: Timestamp;
  /**
   * FASE 5.5 — HISTORICAL/INFORMATIONAL ONLY, never a business condition:
   * set once by `applyAttributionRevenueCatEvent` when the purchase this
   * `couponCode` is attributed to (correlation matched — see
   * `googlePlayOfferCorrelation.ts`/Apple purchase-intent correlation)
   * happened to be reported by the Store as `period_type === 'TRIAL'`. The
   * coupon never causes, grants, or influences whether a trial occurs — the
   * Store decides that identically for every subscriber, coupon or not (see
   * docs §34's FASE 5.5 update). This field only records, for this one
   * attributed sale, which kind of period it started with. The live/current
   * trial state of the account is `SubscriptionMirror.trialEndsAt`
   * (`../billing/types.ts`), never this field.
   */
  trialStartedAt: Timestamp | null;
  /** Set only by `applyAttributionRevenueCatEvent`, once the store confirms a paid conversion correlated to `androidOffer` (or a later trial-conversion `RENEWAL` — see that module's doc comment). Means "this attributed sale converted to paid", nothing about trial. */
  convertedAt: Timestamp | null;
  /**
   * Non-null means this uid's attribution is LOCKED — the sale is
   * commercially attributed to `couponCode` for commission/analytics
   * purposes. `applyPromoCodeAttributionTransactionally` refuses to replace
   * `couponCode`/`androidOffer` once this is set (docs §8: "atribuição
   * comercial definitiva" only after the store proves a real purchase
   * happened AND (Fase 4C.3A) offer correlation matched). Set for ANY
   * correlated `INITIAL_PURCHASE` — trial or paid — never conditioned on
   * `trialStartedAt`; this is purely about "was this sale attributed to
   * this coupon", never about trial.
   */
  lockedAt: Timestamp | null;
}

/**
 * Read-optimized MIRROR of a user's CURRENT attribution, denormalized onto
 * `users/{uid}.attribution` (docs §8: "Não precisa permanecer visível ao
 * usuário após o cadastro" — internal/admin use only, never shown to the
 * user as-is). Never the source of truth; always derived from the
 * corresponding `CouponRedemption` — same relationship `subscription` has
 * with RevenueCat's CustomerInfo (docs §26/§27), applied to attribution.
 *
 * MUST NEVER be merged into or read from `SubscriptionMirror`
 * (../billing/types.ts) — docs §33 is explicit that billing and marketing
 * are separate responsibilities.
 */
export interface AttributionSnapshot {
  couponCode?: string;
  campaignId?: string;
  influencerId?: string;
  appliedAt?: Timestamp;
}

/**
 * Server-side promo/influencer code catalog document
 * (`promoCodes/{normalizedCode}` — doc ID is the code itself, see
 * `PROMO_CODES_COLLECTION` in constants.ts). Administrable independently of
 * app releases; created/edited only by a future admin surface — NOT part of
 * this change (no writer function exists yet, only the reader/parser in
 * `promoCodeCatalog.ts`).
 *
 * Every active field here is required (not optional like
 * `SubscriptionMirror`'s fields): unlike a webhook-driven mirror that
 * accumulates fields over time, this is an admin-authored catalog entry
 * that should always be written complete. Historical Firestore documents
 * may still carry retired Apple Offer Code fields; the parser tolerates but
 * does not expose or use them.
 *
 * FASE 4C.1: `androidBasePlanIdMonthly`/`androidBasePlanIdAnnual` were
 * added alongside the pre-existing `androidOfferIdMonthly`/
 * `androidOfferIdAnnual` (kept, never renamed). A RevenueCat/Google Play
 * `SubscriptionOption.id` is `basePlanId:offerId` — the `offerId` alone
 * (the pre-4C.1 shape) cannot unambiguously identify one, since the same
 * `offerId` string could in principle exist under a different base plan.
 *
 * FASE 5.3: `androidOfferIdMonthly`/`androidOfferIdAnnual` became OPTIONAL.
 * `androidBasePlanIdMonthly`/`androidBasePlanIdAnnual` remain required
 * whenever a plan is configured for Android — `offerId` alone without a
 * `basePlanId` is still rejected as a data-integrity problem (never valid).
 * A `basePlanId` with NO `offerId` is now a fully valid, INTENTIONAL config:
 * it means the coupon only selects the promotional base plan, leaving offer
 * selection (trial or not) to Google Play/RevenueCat. See
 * `AndroidSubscriptionOfferConfig`'s doc comment. Each plan's pair is
 * resolved by `promoCodeCatalog.ts`'s `resolveAndroidOfferPair` — see that
 * function's doc comment for the exact fail-closed policy.
 *
 * FASE 5.7: `androidOfferingIdentifierMonthly`/`androidOfferingIdentifierAnnual`
 * were added alongside `androidOfferIdMonthly`/`androidOfferIdAnnual` — a
 * `basePlanId` alone (FASE 5.3's original new-style shape) told the webhook
 * enough to correlate a purchase, but never told the CLIENT which
 * RevenueCat Offering to search for that base plan's `PurchasesPackage` in.
 * Optional on read for backward compatibility — every `promoCodes` document
 * written before this phase lacks these fields entirely, and that absence
 * must parse as `null`. Mutually exclusive with the corresponding
 * `androidOfferId*` field per plan — see `AndroidSubscriptionOfferConfig`'s
 * doc comment for the exact two valid shapes and `resolveAndroidOfferPair`
 * for the fail-closed policy on an ambiguous (both set) or incomplete
 * (neither set, `basePlanId` alone) pair.
 */
export interface PromoCodeDocument {
  /** Normalized code — identical to the document ID, kept as a field too for exports/queries that read documents without their ID. */
  code: string;
  /** Kill switch — overrides `startsAt`/`endsAt` when `false`. */
  active: boolean;
  /** Code only valid from this instant onward. `null` = no lower bound. */
  startsAt: Timestamp | null;
  /** Code only valid up to this instant. `null` = no upper bound (docs: "código sem expiração"). */
  endsAt: Timestamp | null;
  influencerId: string;
  campaignId: string;
  /** Optional human-facing label used only by the admin surface. Never participates in store routing or attribution. */
  internalName?: string | null;
  /** Google Play base plan ID for the monthly plan (e.g. `"monthly"`, or `"monthly-promo"` under the FASE 5.7 new shape). */
  androidBasePlanIdMonthly: string | null;
  /** LEGACY shape half-pair — mutually exclusive with `androidOfferingIdentifierMonthly` (FASE 5.7). */
  androidOfferIdMonthly: string | null;
  /** NEW shape half-pair (FASE 5.7) — the RevenueCat Offering identifier to resolve the monthly promotional base plan's package from (e.g. `"coupon_discount"`, a catalog value, never assumed/hardcoded). Mutually exclusive with `androidOfferIdMonthly`. */
  androidOfferingIdentifierMonthly: string | null;
  /** Google Play base plan ID for the annual plan (e.g. `"annual"`, or `"annual-promo"` under the FASE 5.7 new shape). */
  androidBasePlanIdAnnual: string | null;
  /** LEGACY shape half-pair — mutually exclusive with `androidOfferingIdentifierAnnual` (FASE 5.7). */
  androidOfferIdAnnual: string | null;
  /** NEW shape half-pair (FASE 5.7) — the RevenueCat Offering identifier to resolve the annual promotional base plan's package from. Mutually exclusive with `androidOfferIdAnnual`. */
  androidOfferingIdentifierAnnual: string | null;
  /**
   * FASE 1 — see `IOSPromotionConfig`'s doc comment. `null` until an admin
   * configures the iOS promotional Offering/SKU for this campaign. NEW
   * field — optional on read for backward compatibility (see
   * `promoCodeCatalog.ts`'s `parsePromoCodeDocument`): every `promoCodes`
   * document written before this phase lacks it entirely, and that absence
   * must parse as `null`, never reject the whole document.
   */
  iosPromotion: IOSPromotionConfig | null;
  /**
   * Administrative acknowledgement only. A non-null value means an admin
   * declared the RevenueCat Offering + App Store promotional SKUs/
   * Introductory Offers configured externally. It is NOT an Apple API
   * verification. Historical documents legitimately omit both fields.
   */
  appleConfigurationConfirmedAt?: Timestamp | null;
  appleConfigurationConfirmedBy?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** uid of the admin who created this entry. */
  createdBy: string;
  notes: string | null;
}

/** Untrusted request payload for `validatePromoCode` — every field read defensively, nothing assumed present/typed. */
export interface ValidatePromoCodeRequestData {
  code?: unknown;
  /** Optional context hint, never trusted to select store config on its own without allowlist validation (see `constants.ts`'s `PROMO_CODE_PLATFORMS`). */
  platform?: unknown;
}

/**
 * Public Android contract returned by `validatePromoCode`. Unlike the
 * persisted `AndroidSubscriptionOfferConfig`, the inactive variant key is
 * ABSENT rather than serialized as `null`, so the client can discriminate
 * the two mutually-exclusive purchase routes by exact object shape.
 */
export type AndroidSubscriptionOfferWireConfig =
  | { basePlanId: string; offerId: string }
  | { basePlanId: string; offeringIdentifier: string };

/**
 * Store configuration returned to the Android client. This is deliberately
 * distinct from `PromoCodeAndroidOfferSnapshot`: storage keeps both nullable
 * keys for historical/webhook correlation, while the wire emits only the
 * keys belonging to the active LEGACY or NEW variant.
 */
export interface PromoCodePlatformStoreConfig {
  monthly: AndroidSubscriptionOfferWireConfig | null;
  annual: AndroidSubscriptionOfferWireConfig | null;
}

/**
 * Successful response contract for `validatePromoCode`. Deliberately does
 * NOT include anything resembling a granted trial/entitlement — see
 * `eligibility` below, which is the explicit, machine-readable statement
 * that the Store is the only authority on real trial eligibility (docs §34).
 */
export interface ValidatePromoCodeResponseData {
  valid: true;
  /** The normalized code, safe to echo back (the client already knows it — this is not new information). */
  code: string;
  benefit: {
    campaignId: string;
    influencerId: string;
    /** Deliberately non-committal — never "trial", never a duration. Describes the campaign kind, not a promise. */
    kind: 'promotional_campaign';
  };
  /**
   * Store configuration needed to select the right RevenueCat Offering.
   * Only the platform(s) requested via `platform` are populated; the other
   * is `null`. If `platform` was omitted, both are populated so the client
   * can decide. NEVER derived from client-supplied `offerId`/`productId` —
   * always read from the server-side `promoCodes` catalog.
   */
  storeConfig: {
    android: PromoCodePlatformStoreConfig | null;
  };
  /**
   * FASE 1 — the new iOS promotional (Offering/SKU) authorization,
   * deliberately a SIBLING of `storeConfig`, never nested inside it:
   * This field is the only active iOS promotional contract. It is `null`
   * when iOS wasn't requested, or when the
   * campaign has no iOS promotional configuration at all. NEVER implies
   * Premium, a purchase, or a granted trial — see `eligibility` below.
   */
  iosPromotion: IOSPromotionConfig | null;
  eligibility: {
    determinedBy: 'store';
    guaranteed: false;
    disclaimer: 'A elegibilidade final para qualquer período de teste gratuito é determinada exclusivamente pela loja (App Store/Google Play) via RevenueCat, nunca por este backend.';
  };
}

/** Strictly untrusted callable payload. Runtime validation accepts only `plan`. */
export interface AuthorizePromoPurchaseRequestData {
  plan?: unknown;
}

/** Minimal wire contract needed by the future client integration. */
export interface AuthorizePromoPurchaseResponseData {
  authorized: true;
  purchaseIntent: {
    plan: PromoPurchasePlan;
    offeringIdentifier: string;
    expectedProductId: string;
    status: 'purchase_pending';
    /** ISO-8601 representation of the backend-authored Firestore timestamp. */
    expiresAt: string;
  };
}

export type { PromoCodePlatform, PromoPurchasePlan };
