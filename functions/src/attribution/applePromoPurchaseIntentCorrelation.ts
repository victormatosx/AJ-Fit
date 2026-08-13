import { Timestamp } from 'firebase-admin/firestore';
import { isValidIOSPromotionConfig } from './promoCodeCatalog';
import { parseStoredPromoPurchaseIntent } from './promoPurchaseIntent';
import type { PendingPromoPurchaseIntent } from './types';

export type ApplePromoPurchaseIntentCorrelationResult =
  | { status: 'matched'; plan: 'monthly' | 'annual'; intent: PendingPromoPurchaseIntent }
  | { status: 'not_promotional' }
  | { status: 'no_intent' }
  | { status: 'product_mismatch' }
  | { status: 'campaign_mismatch' }
  | { status: 'offering_mismatch' }
  | { status: 'snapshot_product_mismatch' }
  | { status: 'expired' }
  | { status: 'purchase_before_intent' }
  | { status: 'malformed' }
  | { status: 'unsupported_event' }
  | { status: 'already_processed' }
  | { status: 'already_consumed' };

export interface ApplePromoPurchaseIntentCorrelationInput {
  eventType: string;
  eventId: unknown;
  productId: unknown;
  purchasedAtMs: unknown;
  redemptionCampaignId: unknown;
  iosPromotion: unknown;
  hasPurchaseIntent: boolean;
  purchaseIntent: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidUnixMilliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isKnownPromotionalProduct(productId: unknown, iosPromotion: unknown): boolean {
  return (
    typeof productId === 'string' &&
    isValidIOSPromotionConfig(iosPromotion) &&
    (productId === iosPromotion.monthlyProductId || productId === iosPromotion.annualProductId)
  );
}

/**
 * Pure FASE 3 Apple correlation. It never derives a campaign from a SKU:
 * the SKU only proves the product, while the pre-existing redemption and
 * intent prove the campaign. `purchasedAtMs`, not webhook arrival time, is
 * compared inclusively against the backend-authored intent window.
 *
 * `not_promotional` means the event is outside Promo SKU attribution; it is
 * not permission to attempt another Apple correlation mechanism. Every
 * failure remains explicit and fail-closed.
 */
export function correlateApplePromoPurchaseIntent(
  input: ApplePromoPurchaseIntentCorrelationInput,
): ApplePromoPurchaseIntentCorrelationResult {
  if (input.eventType !== 'INITIAL_PURCHASE') return { status: 'unsupported_event' };

  if (!input.hasPurchaseIntent) {
    if (
      input.iosPromotion !== null &&
      input.iosPromotion !== undefined &&
      !isValidIOSPromotionConfig(input.iosPromotion)
    ) {
      return { status: 'malformed' };
    }
    return isKnownPromotionalProduct(input.productId, input.iosPromotion)
      ? { status: 'no_intent' }
      : { status: 'not_promotional' };
  }

  const intent = parseStoredPromoPurchaseIntent(input.purchaseIntent);
  if (!intent || !isNonEmptyString(input.eventId)) return { status: 'malformed' };

  if (intent.status === 'purchase_confirmed') {
    return intent.revenueCatEventId === input.eventId
      ? { status: 'already_processed' }
      : { status: 'already_consumed' };
  }

  if (
    !isNonEmptyString(input.redemptionCampaignId) ||
    !isValidIOSPromotionConfig(input.iosPromotion) ||
    intent.expiresAt.toMillis() <= intent.createdAt.toMillis()
  ) {
    return { status: 'malformed' };
  }

  if (intent.campaignId !== input.redemptionCampaignId) return { status: 'campaign_mismatch' };
  if (intent.offeringIdentifier !== input.iosPromotion.offeringIdentifier) {
    return { status: 'offering_mismatch' };
  }

  const snapshotProductId =
    intent.plan === 'monthly'
      ? input.iosPromotion.monthlyProductId
      : input.iosPromotion.annualProductId;
  if (intent.expectedProductId !== snapshotProductId) {
    return { status: 'snapshot_product_mismatch' };
  }
  if (input.productId !== intent.expectedProductId) return { status: 'product_mismatch' };
  if (!isValidUnixMilliseconds(input.purchasedAtMs)) return { status: 'malformed' };

  const purchaseTimestamp = Timestamp.fromMillis(input.purchasedAtMs);
  if (purchaseTimestamp.toMillis() < intent.createdAt.toMillis()) {
    return { status: 'purchase_before_intent' };
  }
  if (purchaseTimestamp.toMillis() > intent.expiresAt.toMillis()) return { status: 'expired' };

  return { status: 'matched', plan: intent.plan, intent };
}
