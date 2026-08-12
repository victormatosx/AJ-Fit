/**
 * FASE iOS-1 — Apple/App Store equivalent of `googlePlayOfferCorrelation.ts`,
 * with a materially different outcome: this module does NOT implement a
 * working correlation. It exists so `attributionSync.ts` has an explicit,
 * typed APP_STORE code path (instead of silently falling into the generic
 * "unknown store" branch), and so a future phase has one exact place to add
 * the real algorithm once — and only once — the evidence below is resolved.
 *
 * ============================================================================
 * WHY THIS RETURNS `unsupported`, NEVER `matched` (Fase iOS-1 audit, Passo 2)
 * ============================================================================
 *
 * `googlePlayOfferCorrelation.ts`'s correlation is possible because two
 * conditions both hold, confirmed against RevenueCat's own webhook docs
 * (event-types-and-fields):
 *
 * EVIDÊNCIA DA DOCUMENTAÇÃO EXTERNA (revenuecat.com/docs/integrations/
 * webhooks/event-types-and-fields, re-checked for this task):
 * - `product_id` has a DOCUMENTED, store-specific composed format for
 *   Google Play: "For Google Play products set up in RevenueCat after
 *   February 2023, this identifier has the format
 *   `<subscription_id>:<base_plan_id>`." No equivalent documented format
 *   exists for App Store `product_id` — it is just the App Store Connect
 *   product identifier (a flat SKU string), with no embedded offer/base-plan
 *   segment to parse.
 * - `offer_code` is documented as a store-agnostic field ("Sometimes"
 *   present, applicable to INITIAL_PURCHASE/RENEWAL/NON_RENEWING_PURCHASE),
 *   but the ONLY place RevenueCat's own docs give it concrete semantics is
 *   their Google Play Offers guide, where it is explicitly the Google Play
 *   Console "Offer ID". RevenueCat's docs do not confirm — anywhere found
 *   during this audit — that `offer_code` is populated with the App Store
 *   Connect "Offer Code" / Promotional Offer identifier when an iOS
 *   transaction redeems one, nor what exact string it would contain if it
 *   is (the offer code itself? a RevenueCat-internal offer identifier? the
 *   Promotional Offer's `offerIdentifier`?).
 *
 * EVIDÊNCIA DO REPOSITÓRIO:
 * - No fixture, test, or webhook payload sample anywhere in this repo shows
 *   a real (or sandbox) APP_STORE event with `offer_code` populated from an
 *   Offer Code / Promotional Offer redemption. `functions/src/billing/
 *   revenuecat.ts`'s `extractOfferCode`/`extractStore`/`extractProductId`
 *   read the fields generically (not Google-specific) but nothing in this
 *   codebase has ever observed what an Apple offer-code transaction actually
 *   puts in them.
 *
 * Per the Fase iOS-1 task rules: without a confirmed, deterministic mapping
 * from a real APP_STORE webhook event to "this is exactly the offer code
 * config authorized for this uid", implementing a match here would be
 * FABRICATING a correlation — worse than having none, because a false
 * `matched` would lock a `couponRedemptions/{uid}` record and could credit
 * an influencer for a purchase that never actually used their offer. This is
 * classification **D** (impossible to prove deterministically with the
 * currently available payload/evidence) per the audit's A/B/C/D scale.
 *
 * WHAT WOULD UNBLOCK THIS: a captured real (sandbox is fine) RevenueCat
 * webhook payload for an INITIAL_PURCHASE that resulted from a customer
 * redeeming an actual App Store Offer Code, showing definitively what
 * `offer_code` (and/or any other field) contains in that case. Until that
 * evidence exists, `correlateAppleOffer` must keep returning `unsupported`.
 */

import type { PromoCodeAppleOfferSnapshot } from './types';

export type AppleOfferCorrelationResult =
  | { status: 'matched'; plan: 'monthly' | 'annual' }
  | { status: 'not_matched' }
  /**
   * Distinct from `not_matched`: this is not "we checked and it didn't
   * match" but "we cannot check at all" — no confirmed field/format exists
   * to compare against. Both are treated identically by
   * `decideInitialPurchaseAttributionConfirmation` (neither is `matched`,
   * so neither ever confirms/locks attribution) — the distinction exists
   * purely for logging/observability, so `unsupported` is never confused
   * with an actual mismatch during future debugging.
   */
  | { status: 'unsupported' };

/**
 * Pure — zero Firestore/RevenueCat SDK dependency, same shape discipline as
 * `correlateGooglePlayOffer`. Deliberately accepts the same kind of inputs a
 * real correlation would need (the event's raw `offer_code`, and the
 * `appleOffer` snapshot authorized at application time) so the call site in
 * `attributionSync.ts` never needs to change when this becomes real — only
 * this function's body would.
 *
 * ALWAYS returns `unsupported` today — see this file's top doc comment for
 * why. Never infers/guesses a match; never treats a coincidental string
 * equality as proof (even if `offerCode` happens to equal one of
 * `appleOffer`'s configured codes, that is NOT evidence the store attributes
 * it to an Apple Offer Code redemption on this specific transaction, per the
 * external-evidence gap above).
 */
export function correlateAppleOffer(
  offerCode: string | null,
  appleOffer: PromoCodeAppleOfferSnapshot | null,
): AppleOfferCorrelationResult {
  void offerCode;
  void appleOffer;
  return { status: 'unsupported' };
}
