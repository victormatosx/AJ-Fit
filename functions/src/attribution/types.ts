import type { Timestamp } from 'firebase-admin/firestore';

/**
 * Types for the (not yet implemented) attribution/coupon module. See
 * docs/13_assinaturas_e_billing.md §33 ("Arquitetura de Atribuição de
 * Usuários") for the full architecture decision — event log
 * (`CouponRedemption`) as source of truth + denormalized mirror
 * (`AttributionSnapshot`) — and docs §8 for the business rules these types
 * encode. Also see docs §34 for how attribution is meant to influence which
 * RevenueCat Offering is shown, without ever affecting trial eligibility
 * (still exclusively decided by the store/RevenueCat).
 *
 * Sprint 3.6 scope: shapes only. No read/write/validation logic — that's a
 * future sprint, once the coupon system itself is scheduled.
 */

/**
 * One immutable event: a user redeemed a coupon/promo code. THE source of
 * truth for attribution (docs §8/§24/§33) — never overwritten, never
 * deleted. Lives in `couponRedemptions/{id}` (see
 * `COUPON_REDEMPTIONS_COLLECTION` in constants.ts).
 */
export interface CouponRedemption {
  /** Firebase uid — coupons are tied to accounts, never bare emails (docs §8). */
  uid: string;
  /** The code the user entered/followed. */
  couponCode: string;
  /** Marketing campaign this code belongs to, if any (docs §34: used to pick a RevenueCat Offering — never to grant access directly). */
  campaignId?: string;
  /** Influencer this code is attributed to, if any. */
  influencerId?: string;
  /** Free-form acquisition channel, e.g. "instagram", "tiktok", "referral". */
  source?: string;
  /** When the redemption was recorded (server timestamp). */
  redeemedAt: Timestamp;
}

/**
 * Read-optimized MIRROR of a user's attribution, denormalized onto
 * `users/{uid}.attribution` (docs §8: "Não precisa permanecer visível ao
 * usuário após o cadastro" — internal/admin use only, never shown to the
 * user as-is). Never the source of truth; always derived from the
 * corresponding `CouponRedemption` — the same relationship `subscription`
 * has with RevenueCat's CustomerInfo (docs §26/§27), applied to attribution
 * instead of billing.
 *
 * MUST NEVER be merged into or read from `SubscriptionMirror`
 * (../billing/types.ts) — docs §33 is explicit that billing and marketing
 * are separate responsibilities.
 */
export interface AttributionSnapshot {
  couponCode?: string;
  campaignId?: string;
  influencerId?: string;
  source?: string;
  redeemedAt?: Timestamp;
}
