/**
 * Constants for the user-attribution / promo-code module
 * (docs/13_assinaturas_e_billing.md §8/§33/§34, "Arquitetura de Atribuição
 * de Usuários"). Attribution/marketing data is a SEPARATE responsibility
 * from billing (docs §33) — this module intentionally has zero imports from
 * `../billing/*`, even where a value would be identical (e.g.
 * `USERS_COLLECTION`), to keep the two fully decoupled in code, not just in
 * documentation.
 *
 * Sprint 3.6 shipped constants + types only. This module now (promo-codes
 * foundation task) adds the promo-code catalog constants and the first
 * real read/write logic (`normalize.ts`, `eligibility.ts`,
 * `promoCodeCatalog.ts`, `attributionSync.ts`, `validatePromoCode.ts`).
 */

/** Firestore collection holding the user documents this module's mirror field lives on. */
export const USERS_COLLECTION = 'users';

/**
 * Nested map field on `users/{uid}` — the read-optimized MIRROR of a user's
 * attribution. Never the source of truth (docs §33) — that's
 * `COUPON_REDEMPTIONS_COLLECTION`.
 */
export const ATTRIBUTION_FIELD = 'attribution';

/**
 * Top-level collection, one document per Firebase uid (doc ID == uid). THE
 * source of truth for a user's current promo-code attribution.
 *
 * REVISED from the original Sprint 3.6 design (docs/13 §33), which described
 * this as an append-only event log with an auto-generated ID per redemption.
 * The promo-codes foundation task explicitly redefines it as a
 * server-managed LIFECYCLE record instead: one mutable document per uid,
 * updated in place as the attribution moves from "pending" (just applied,
 * swappable) to "locked" (a real, correlated purchase confirmed by the
 * RevenueCat webhook — trial or paid, FASE 5.5: never conditioned on trial
 * specifically; a FUTURE phase at the time of this comment, not implemented
 * by this change). Keying by uid
 * (rather than an event id) is what makes "is this uid's attribution already
 * locked" and "replace uid's pending code" both a direct, transactional
 * document read+write with no query — see `attributionSync.ts`.
 *
 * Trade-off accepted deliberately: this design does not keep a history of
 * earlier codes a user applied before swapping (each swap overwrites the
 * previous pending state). docs/13 §33 still describes the original
 * event-log design and should be updated to match this decision in a
 * follow-up — not part of this change.
 */
export const COUPON_REDEMPTIONS_COLLECTION = 'couponRedemptions';

/**
 * Top-level collection holding the promo/influencer code catalog. Document
 * ID is the normalized code itself (see `normalizePromoCode` in
 * `normalize.ts`) — never a random ID — so lookup is a direct `get()` by
 * path, with no query and nothing for the client to list or enumerate.
 */
export const PROMO_CODES_COLLECTION = 'promoCodes';

/**
 * Business-rule cap on a NORMALIZED code's length (docs: influencer handles
 * like "ARNALDO", "HELLLEN" — generous enough for any realistic code).
 */
export const PROMO_CODE_MAX_LENGTH = 32;

/**
 * Hard cap on the RAW (pre-trim) input length accepted by
 * `normalizePromoCode`, checked before any string processing. Keeps the cost
 * of handling adversarial input (a client sending a multi-KB string) bounded
 * regardless of where whitespace sits, independent of `PROMO_CODE_MAX_LENGTH`.
 */
export const PROMO_CODE_MAX_RAW_INPUT_LENGTH = 256;

/**
 * Strict allowlist for a NORMALIZED code (after trim + uppercase). Anything
 * outside `A-Z0-9_-` is rejected — this is what actually blocks internal
 * spaces, `/` (an invalid/ambiguous Firestore document-ID segment), and any
 * invisible/zero-width/confusable Unicode character, regardless of what
 * `trim()`/`toUpperCase()` did to the raw input.
 */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]+$/;

/** Platforms the promo-code catalog can carry store configuration for. */
export const PROMO_CODE_PLATFORMS = ['ANDROID', 'IOS'] as const;
export type PromoCodePlatform = (typeof PROMO_CODE_PLATFORMS)[number];

/** Plans the caller may choose when authorizing an iOS promotional purchase. */
export const PROMO_PURCHASE_PLANS = ['monthly', 'annual'] as const;
export type PromoPurchasePlan = (typeof PROMO_PURCHASE_PLANS)[number];

/**
 * A purchase intent is created immediately before StoreKit. Ten minutes is
 * long enough for a normal store confirmation flow while keeping abandoned
 * evidence short-lived. Logical expiry is always checked in code; Firestore
 * TTL cleanup, if added later, is not part of the authorization boundary.
 */
export const PROMO_PURCHASE_INTENT_TTL_MS = 10 * 60 * 1000;

/** Path helper so no other module hand-builds `users/${uid}` template strings. */
export function userDocPath(uid: string): string {
  return `${USERS_COLLECTION}/${uid}`;
}

/** Path helper for the per-uid attribution lifecycle record — see `COUPON_REDEMPTIONS_COLLECTION`. */
export function couponRedemptionDocPath(uid: string): string {
  return `${COUPON_REDEMPTIONS_COLLECTION}/${uid}`;
}

/** Path helper for a promo code's catalog document — `normalizedCode` MUST already be normalized. */
export function promoCodeDocPath(normalizedCode: string): string {
  return `${PROMO_CODES_COLLECTION}/${normalizedCode}`;
}
