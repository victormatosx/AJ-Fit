/**
 * FASE 4C.3A — proves (or refuses to assume) that a real RevenueCat/Google
 * Play purchase actually used the specific promotional offer a
 * `couponRedemptions/{uid}` record was authorized for, BEFORE
 * `attributionSync.ts` is allowed to confirm/lock it.
 *
 * Fixes the bug found by the Fase 4C.3 audit: `decideInitialPurchaseAttributionConfirmation`
 * (pre-4C.3A) confirmed attribution for ANY premium `INITIAL_PURCHASE` for a
 * uid with a pending redemption, regardless of which product/offer was
 * actually bought — a normal, code-free purchase would falsely credit
 * whichever influencer code happened to be pending.
 *
 * Documentation audited for this task (revenuecat.com/docs/integrations/
 * webhooks/event-types-and-fields, fetched during Fase 4C.3A):
 *
 * - `product_id`: "Product identifier of the subscription. For Google Play
 *   products set up in RevenueCat after February 2023, this identifier has
 *   the format `<subscription_id>:<base_plan_id>`." — confirmed, exact
 *   quote.
 * - `offer_code`: "Offer or promotion code used for the transaction. This
 *   can be `null`." Listed as a Subscription lifecycle field, "Sometimes"
 *   included, applicable to `INITIAL_PURCHASE`/`RENEWAL`/
 *   `NON_RENEWING_PURCHASE`. The docs do NOT explicitly restate that this
 *   is the Google Play Console "Offer ID" in those exact words, but that is
 *   the only Google Play concept RevenueCat's own Google Play Offers guide
 *   calls "offer ID" — treated here as a well-grounded inference, not an
 *   invented field.
 * - Crucially, `offer_code` is documented as "Sometimes" present — NOT
 *   guaranteed even on `INITIAL_PURCHASE`, and RevenueCat's docs give no
 *   guarantee it survives onto the `RENEWAL` that later converts a trial.
 *   This is why correlation in this module is used ONLY for
 *   `INITIAL_PURCHASE` (see `attributionSync.ts`'s `applyAttributionRevenueCatEvent`)
 *   — `RENEWAL` confirmation (`decideRenewalAttributionConfirmation`,
 *   unchanged by this task) relies on `trialStartedAt` already being set,
 *   which only ever happens after an `INITIAL_PURCHASE` already proved the
 *   correlation. The proof happens exactly once, at `INITIAL_PURCHASE`.
 */

import type { PromoCodeAndroidOfferSnapshot } from './types';

export interface GooglePlayProductIdentity {
  subscriptionId: string;
  basePlanId: string;
}

/**
 * Parses `product_id` for a Google Play event into
 * `{subscriptionId, basePlanId}`. Fail-closed for anything that isn't
 * EXACTLY the documented `<subscription_id>:<base_plan_id>` two-segment
 * shape — `null`/`undefined`/empty string, no separator, more than one
 * separator (an unknown future format), or an empty segment on either
 * side. Never infers/guesses a missing half; never alters case (Store IDs
 * are compared exactly, never normalized).
 */
export function parseGooglePlayProductId(productId: unknown): GooglePlayProductIdentity | null {
  if (typeof productId !== 'string' || productId.length === 0) return null;

  const parts = productId.split(':');
  if (parts.length !== 2) return null;

  const [subscriptionId, basePlanId] = parts;
  if (subscriptionId.length === 0 || basePlanId.length === 0) return null;

  return { subscriptionId, basePlanId };
}

/**
 * Defensive read of the raw `offer_code` webhook field — a string, or
 * `null` when the store reports no offer was used, or `undefined` when the
 * field itself is absent/malformed (treated identically to `null` by
 * `correlateGooglePlayOffer`: both mean "no proof of an offer"). Never
 * upper/lowercased — Store IDs are compared exactly.
 */
export function extractGooglePlayOfferCode(offerCode: unknown): string | null {
  if (typeof offerCode === 'string' && offerCode.length > 0) return offerCode;
  return null;
}

export type GooglePlayOfferCorrelationResult =
  | { status: 'matched'; plan: 'monthly' | 'annual' }
  | { status: 'not_matched' };

/**
 * THE correlation algorithm (Fase 4C.3A rule 9/12). Pure — zero Firestore/
 * RevenueCat SDK dependency, so it's fully unit-testable.
 *
 * Matches ONLY on exact equality of BOTH `basePlanId` AND `offerId` against
 * the SAME plan's authorized pair — a `monthly` offerId can never satisfy
 * an `annual` basePlanId or vice versa (rule 12: "nunca casar offerId de um
 * plano com basePlanId de outro"). Returns `not_matched` (never guesses/
 * picks a "closest" plan) whenever:
 * - `androidOffer` itself is `null` (no Android config was ever stored for
 *   this redemption — includes legacy pre-4C.3A records, rule 20);
 * - `basePlanId`/`offerCode` couldn't be determined (`null`);
 * - neither plan's authorized pair matches exactly.
 *
 * Does not know anything about `store` — callers must only invoke this for
 * a confirmed Google Play (`PLAY_STORE`) event; a non-Google event should
 * never reach this function at all (see `applyAttributionRevenueCatEvent`).
 */
export function correlateGooglePlayOffer(
  basePlanId: string | null,
  offerCode: string | null,
  androidOffer: PromoCodeAndroidOfferSnapshot | null,
): GooglePlayOfferCorrelationResult {
  if (androidOffer === null || basePlanId === null || offerCode === null) {
    return { status: 'not_matched' };
  }

  const plans: Array<'monthly' | 'annual'> = ['monthly', 'annual'];
  for (const plan of plans) {
    const authorized = androidOffer[plan];
    if (authorized && authorized.basePlanId === basePlanId && authorized.offerId === offerCode) {
      return { status: 'matched', plan };
    }
  }

  return { status: 'not_matched' };
}
