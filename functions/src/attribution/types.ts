import type { Timestamp } from 'firebase-admin/firestore';
import type { PromoCodePlatform } from './constants';

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
 * A complete, unambiguous identifier for one Google Play `SubscriptionOption`
 * (FASE 4C.1) — the exact pair the client needs to compute
 * `` `${basePlanId}:${offerId}` `` and match it by equality against
 * `product.subscriptionOptions`. Never a pre-composed string: keeping the
 * `basePlanId:offerId` composition convention in ONE place (the future
 * client-side matching utility) instead of baked into stored strings.
 */
export interface AndroidSubscriptionOfferConfig {
  basePlanId: string;
  offerId: string;
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
 * FASE iOS-1 — the Apple offer-code configuration authorized for one
 * `couponRedemptions/{uid}` record AT THE MOMENT it was applied, mirroring
 * `PromoCodeAndroidOfferSnapshot`'s snapshot rationale (see that type's doc
 * comment) but with Apple's own, simpler shape: an App Store custom offer
 * code is a single flat string per plan (`promoCodes/{code}.appleOfferCode*`
 * in `types.ts`) — there is no Google-Play-style `basePlanId`/`offerId` pair
 * to compose, so this is intentionally NOT `PromoCodeAndroidOfferSnapshot`
 * with renamed fields. Never invent a `basePlanId` for iOS; never reuse an
 * `androidOffer` value here.
 *
 * `null` per plan means no Apple offer code is configured for that plan on
 * this catalog entry (expected today — Apple has not yet approved custom
 * offer codes for this app, per the business context in
 * `PromoCodeDocument.appleOfferCodeMonthly`/`appleOfferCodeAnnual`'s doc
 * comment).
 */
export interface PromoCodeAppleOfferSnapshot {
  offerCodeMonthly: string | null;
  offerCodeAnnual: string | null;
}

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
   * FASE iOS-1 — the Apple offer-code configuration authorized for
   * `couponCode` AT APPLICATION TIME, mirroring `androidOffer`'s snapshot
   * rationale (see `PromoCodeAppleOfferSnapshot`'s doc comment). Always
   * present going forward (written on every apply/swap, unconditionally —
   * same as `androidOffer`, regardless of which `platform` the client
   * requested); ABSENT on documents created before FASE iOS-1 —
   * `attributionSync.ts`'s defensive reader treats that absence as `null`
   * per plan (fail-closed, same policy as `androidOffer`'s legacy-schema
   * handling).
   *
   * As of FASE iOS-1, NOTHING ever reads this field to confirm attribution
   * — `attributionSync.ts`'s Apple correlation path
   * (`appleOfferCorrelation.ts`) cannot yet prove a real RevenueCat/App
   * Store event used a specific Apple offer code (see that module's doc
   * comment for exactly what evidence is missing). This field exists so the
   * snapshot is captured now and available once that correlation becomes
   * possible — never re-derived from the live catalog later.
   */
  appleOffer: PromoCodeAppleOfferSnapshot;
  /** When the CURRENT `couponCode` was applied — reset on every swap while pending. */
  appliedAt: Timestamp;
  /** When this uid's first-ever promo code was applied — preserved across swaps, unlike `appliedAt`. */
  createdAt: Timestamp;
  /** Server timestamp of the most recent write to this document. */
  updatedAt: Timestamp;
  /**
   * Set only by `applyAttributionRevenueCatEvent` once the store confirms
   * trial start for `couponCode` AND (Fase 4C.3A) the purchase is proven
   * to have used the exact offer in `androidOffer`.
   */
  trialStartedAt: Timestamp | null;
  /** Set only by `applyAttributionRevenueCatEvent`, once the store confirms a paid conversion correlated to `androidOffer` (or a later trial-conversion `RENEWAL` — see that module's doc comment). */
  convertedAt: Timestamp | null;
  /**
   * Non-null means this uid's attribution is LOCKED —
   * `applyPromoCodeAttributionTransactionally` refuses to replace
   * `couponCode`/`androidOffer` once this is set (docs §8: "atribuição
   * comercial definitiva" only after the store proves trial/subscription
   * start AND (Fase 4C.3A) offer correlation).
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
 * Every field here is required (not optional like `SubscriptionMirror`'s
 * fields): unlike a webhook-driven mirror that accumulates fields over
 * time, this is an admin-authored catalog entry that should always be
 * written complete. `android*`/`appleOfferCode*` are nullable because the
 * iOS custom offer codes do not exist yet (pending Apple approval per the
 * business context) — a code can be valid for Android only in the
 * meantime.
 *
 * FASE 4C.1: `androidBasePlanIdMonthly`/`androidBasePlanIdAnnual` were
 * added alongside the pre-existing `androidOfferIdMonthly`/
 * `androidOfferIdAnnual` (kept, never renamed). A RevenueCat/Google Play
 * `SubscriptionOption.id` is `basePlanId:offerId` — the `offerId` alone
 * (the pre-4C.1 shape) cannot unambiguously identify one, since the same
 * `offerId` string could in principle exist under a different base plan.
 * Each plan's pair is validated for completeness by
 * `promoCodeCatalog.ts`'s `resolveAndroidOfferPair` — see that function's
 * doc comment for the fail-closed policy on a partial pair (one field set,
 * the other `null`).
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
  /** Google Play base plan ID for the monthly plan (e.g. `"monthly"`) — half of the pair identifying a `SubscriptionOption`. */
  androidBasePlanIdMonthly: string | null;
  androidOfferIdMonthly: string | null;
  /** Google Play base plan ID for the annual plan (e.g. `"annual"`). */
  androidBasePlanIdAnnual: string | null;
  androidOfferIdAnnual: string | null;
  /** Apple custom offer code — `null` until Apple approves custom offer codes for this app (business context, not yet available). */
  appleOfferCodeMonthly: string | null;
  appleOfferCodeAnnual: string | null;
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
 * Store configuration for Android returned to the CLIENT by
 * `validatePromoCode` — structurally identical to `PromoCodeAndroidOfferSnapshot`
 * (the same shape is also what gets snapshotted into `couponRedemptions/{uid}.androidOffer`),
 * kept as a distinct type name because the two serve different audiences
 * (one is a wire response contract, the other a Firestore document field) —
 * `null` per plan means that plan/offer isn't configured (or isn't a
 * complete, unambiguous pair — see `resolveAndroidOfferPair` in
 * `promoCodeCatalog.ts`) for this code.
 */
export type PromoCodePlatformStoreConfig = PromoCodeAndroidOfferSnapshot;

/**
 * FASE iOS-1: this used to be its own duplicate-shape interface; now an
 * alias of `PromoCodeAppleOfferSnapshot` — same rationale as
 * `PromoCodePlatformStoreConfig` being an alias of
 * `PromoCodeAndroidOfferSnapshot` (one shape, two audiences: wire response
 * vs. Firestore snapshot field).
 */
export type ApplePromoCodePlatformStoreConfig = PromoCodeAppleOfferSnapshot;

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
    ios: ApplePromoCodePlatformStoreConfig | null;
  };
  eligibility: {
    determinedBy: 'store';
    guaranteed: false;
    disclaimer: 'A elegibilidade final para qualquer período de teste gratuito é determinada exclusivamente pela loja (App Store/Google Play) via RevenueCat, nunca por este backend.';
  };
}

export type { PromoCodePlatform };
