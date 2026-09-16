import type {
  AndroidSubscriptionOfferConfig,
  AndroidSubscriptionOfferWireConfig,
  PromoCodeAndroidOfferSnapshot,
  PromoCodePlatformStoreConfig,
} from './types';

/**
 * Projects one internal Android authorization onto the public callable
 * contract. Storage deliberately retains both nullable variant keys; the
 * wire deliberately omits the inactive key. Any impossible/ambiguous
 * internal state fails closed to `null` rather than leaking a third shape.
 */
export function serializeAndroidSubscriptionOfferForWire(
  config: AndroidSubscriptionOfferConfig | null,
): AndroidSubscriptionOfferWireConfig | null {
  if (config === null) return null;

  if (config.offerId !== null && config.offeringIdentifier === null) {
    return { basePlanId: config.basePlanId, offerId: config.offerId };
  }

  if (config.offerId === null && config.offeringIdentifier !== null) {
    return {
      basePlanId: config.basePlanId,
      offeringIdentifier: config.offeringIdentifier,
    };
  }

  return null;
}

/** Converts the complete persisted/snapshotted Android shape to wire form. */
export function serializeAndroidStoreConfigForWire(
  snapshot: PromoCodeAndroidOfferSnapshot,
): PromoCodePlatformStoreConfig {
  return {
    monthly: serializeAndroidSubscriptionOfferForWire(snapshot.monthly),
    annual: serializeAndroidSubscriptionOfferForWire(snapshot.annual),
  };
}
