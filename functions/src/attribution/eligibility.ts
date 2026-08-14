import type { PromoCodeDocument } from './types';

/**
 * Pure eligibility-window check for a promo code (docs: `active` +
 * `startsAt`/`endsAt`). Zero Firestore dependency — takes an already-parsed
 * `PromoCodeDocument` and a reference instant, so it's fully unit-testable
 * without mocking anything.
 *
 * This is a CATALOG-level check only ("is this code currently usable at
 * all") — it says nothing about a specific uid's attribution state (pending
 * vs. locked), which is `attributionSync.ts`'s responsibility.
 */
export function isPromoCodeCurrentlyEligible(
  promoCode: PromoCodeDocument,
  now: Date,
): boolean {
  if (!promoCode.active) return false;

  const nowMs = now.getTime();
  if (promoCode.startsAt !== null && promoCode.startsAt.toMillis() > nowMs) return false;
  if (promoCode.endsAt !== null && promoCode.endsAt.toMillis() < nowMs) return false;

  return true;
}
