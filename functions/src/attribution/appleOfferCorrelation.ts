/**
 * FASE iOS-1 — Apple/App Store equivalent of `googlePlayOfferCorrelation.ts`.
 * Originally a deliberate placeholder (`correlateAppleOffer` always returned
 * `unsupported`) because no confirmed, deterministic mapping existed between
 * a real `APP_STORE` webhook event and "this transaction used offer code X".
 *
 * ============================================================================
 * FASE iOS-6 — REAL EVIDENCE OBTAINED, REAL CORRELATION IMPLEMENTED
 * ============================================================================
 *
 * A real Apple Sandbox Offer Code redemption (docs/13_assinaturas_e_billing.md's
 * FASE iOS-5 section: new Sandbox tester, new Sandbox Code, App Store Connect
 * offer "Influencer Trial 7D") produced an `INITIAL_PURCHASE` webhook whose
 * `event.offer_code` field was `"Influencer Trial 7D"` — the App Store
 * Connect Offer's own reference/name, NOT the individual, single-use Sandbox
 * Code the user typed into `Purchases.presentCodeRedemptionSheet()` (that
 * code is never reported to this backend at all — StoreKit/RevenueCat only
 * report which OFFER was used, never which of its many redemption codes).
 *
 * This resolves the classification D ("impossible to prove deterministically
 * with the currently available payload/evidence", FASE iOS-1's audit) that
 * blocked this module: `event.offer_code` DOES carry a deterministic,
 * store-confirmed identity for an Apple Offer Code redemption — the Offer's
 * reference/name — exactly the evidence FASE iOS-1's doc comment said would
 * unblock this.
 *
 * `product_id` for App Store is a flat SKU string (e.g.
 * `"ajfit_premium_monthly"`) with no embedded plan/offer segment (confirmed,
 * same as FASE iOS-1's audit already established) — so, unlike Google Play
 * (whose `product_id` alone encodes `basePlanId`), correlating Apple requires
 * BOTH `product_id` AND `offer_code` to match the SAME plan's authorized
 * pair. Matching on `offer_code` alone would risk a monthly offer reference
 * colliding with an unrelated annual product (or vice versa) if two plans
 * ever reused the same Offer reference string — never assumed impossible,
 * always checked.
 *
 * `appleOfferCorrelation` (the config compared against) is a SNAPSHOT taken
 * when the promo code was applied (`validatePromoCode.ts` →
 * `couponRedemptions/{uid}.appleOfferCorrelation`), never the live
 * `promoCodes` catalog — same rationale as `googlePlayOfferCorrelation.ts`
 * (docs regra 4/6: the catalog can change after application but before the
 * store confirms purchase).
 */

import type { AppleOfferCorrelationConfig, PromoCodeAppleCorrelationSnapshot } from './types';

export type AppleOfferCorrelationResult =
  | { status: 'matched'; plan: 'monthly' | 'annual' }
  | { status: 'not_matched' }
  /**
   * Distinct from `not_matched`: this means no Apple correlation config was
   * ever stored for this redemption at all (`appleOfferCorrelation` snapshot
   * itself `null` — includes every `couponRedemptions` document created
   * before FASE iOS-6, and any code whose catalog entry never configured a
   * real Apple Offer). `not_matched` means a comparison WAS attempted and
   * failed (wrong product, wrong offer reference, or matched a different
   * plan). Both are treated identically by
   * `decideInitialPurchaseAttributionConfirmation` (neither is `matched`, so
   * neither ever confirms/locks attribution) — the distinction exists purely
   * for logging/observability.
   */
  | { status: 'unsupported' };

/**
 * THE correlation algorithm (FASE iOS-6). Pure — zero Firestore/RevenueCat
 * SDK dependency, same shape discipline as `correlateGooglePlayOffer`.
 *
 * Matches ONLY on exact equality of BOTH `productId` AND `offerReference`
 * against the SAME plan's authorized `AppleOfferCorrelationConfig` — a
 * monthly offer reference can never satisfy an annual product or vice versa.
 * Returns `not_matched` (never guesses/picks a "closest" plan) whenever the
 * event's `productId`/`offerCode` don't exactly match one plan's authorized
 * pair — including a coincidental string match on only ONE of the two
 * fields, which is never treated as proof.
 *
 * Returns `unsupported` (never `not_matched`) specifically when
 * `appleOfferCorrelation` itself is `null` — no config was ever stored for
 * this redemption, so no comparison was even attempted.
 *
 * `productId`/`offerCode` of `null` (event field absent/malformed) always
 * results in `not_matched` — mirrors `correlateGooglePlayOffer`'s treatment
 * of a missing `offerCode`, and is intentionally the SAME status as a real
 * mismatch (both mean "this specific event proves nothing"), never
 * `unsupported` (which is reserved for "nothing to compare against at all").
 *
 * Does not know anything about `store` — callers must only invoke this for a
 * confirmed App Store (`APP_STORE`) event; a non-Apple event should never
 * reach this function at all (see `applyAttributionRevenueCatEvent`).
 */
export function correlateAppleOffer(
  productId: string | null,
  offerCode: string | null,
  appleOfferCorrelation: PromoCodeAppleCorrelationSnapshot | null,
): AppleOfferCorrelationResult {
  if (appleOfferCorrelation === null) return { status: 'unsupported' };
  if (productId === null || offerCode === null) return { status: 'not_matched' };

  const plans: Array<'monthly' | 'annual'> = ['monthly', 'annual'];
  for (const plan of plans) {
    const authorized: AppleOfferCorrelationConfig | null = appleOfferCorrelation[plan];
    if (authorized && authorized.productId === productId && authorized.offerReference === offerCode) {
      return { status: 'matched', plan };
    }
  }

  return { status: 'not_matched' };
}
