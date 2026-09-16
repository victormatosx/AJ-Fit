import { describe, expect, it } from 'vitest';
import {
  serializeAndroidStoreConfigForWire,
  serializeAndroidSubscriptionOfferForWire,
} from '../promoCodeWire';

describe('Android promo-code wire serialization', () => {
  it('serializes monthly and annual NEW configs without offerId', () => {
    const result = serializeAndroidStoreConfigForWire({
      monthly: {
        basePlanId: 'monthly-promo',
        offerId: null,
        offeringIdentifier: 'coupon_discount',
      },
      annual: {
        basePlanId: 'annual-promo',
        offerId: null,
        offeringIdentifier: 'coupon_discount',
      },
    });

    expect(result.monthly).toEqual({
      basePlanId: 'monthly-promo',
      offeringIdentifier: 'coupon_discount',
    });
    expect(result.annual).toEqual({
      basePlanId: 'annual-promo',
      offeringIdentifier: 'coupon_discount',
    });
    expect(result.monthly).not.toHaveProperty('offerId');
    expect(result.annual).not.toHaveProperty('offerId');
  });

  it('serializes monthly and annual LEGACY configs without offeringIdentifier', () => {
    const result = serializeAndroidStoreConfigForWire({
      monthly: {
        basePlanId: 'monthly',
        offerId: 'influencer-trial-7d',
        offeringIdentifier: null,
      },
      annual: {
        basePlanId: 'annual',
        offerId: 'influencer-trial-7d-annual',
        offeringIdentifier: null,
      },
    });

    expect(result.monthly).toEqual({
      basePlanId: 'monthly',
      offerId: 'influencer-trial-7d',
    });
    expect(result.annual).toEqual({
      basePlanId: 'annual',
      offerId: 'influencer-trial-7d-annual',
    });
    expect(result.monthly).not.toHaveProperty('offeringIdentifier');
    expect(result.annual).not.toHaveProperty('offeringIdentifier');
  });

  it('preserves unconfigured plans as null', () => {
    expect(serializeAndroidStoreConfigForWire({ monthly: null, annual: null })).toEqual({
      monthly: null,
      annual: null,
    });
  });

  it('fails closed for ambiguous and incomplete internal combinations', () => {
    expect(
      serializeAndroidSubscriptionOfferForWire({
        basePlanId: 'monthly',
        offerId: 'legacy-offer',
        offeringIdentifier: 'coupon_discount',
      }),
    ).toBeNull();
    expect(
      serializeAndroidSubscriptionOfferForWire({
        basePlanId: 'monthly',
        offerId: null,
        offeringIdentifier: null,
      }),
    ).toBeNull();
  });
});
