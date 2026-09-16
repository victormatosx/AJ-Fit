import { describe, expect, it } from 'vitest';
import { serializeAndroidStoreConfigForWire } from '../../../functions/src/attribution/promoCodeWire';
import type { PromoCodeAndroidOfferSnapshot } from '../../../functions/src/attribution/types';
import { parsePromoCodeAndroidStoreConfig } from '../promoCodeState';

describe('validatePromoCode Android backend-to-client wire contract', () => {
  it('converts the real backend NEW serialization into the real client kind:new contract', () => {
    const internalSnapshot: PromoCodeAndroidOfferSnapshot = {
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
    };

    const wire = serializeAndroidStoreConfigForWire(internalSnapshot);
    const parsed = parsePromoCodeAndroidStoreConfig(wire);

    expect(parsed).toEqual({
      status: 'valid',
      config: {
        monthly: {
          kind: 'new',
          basePlanId: 'monthly-promo',
          offeringIdentifier: 'coupon_discount',
        },
        annual: {
          kind: 'new',
          basePlanId: 'annual-promo',
          offeringIdentifier: 'coupon_discount',
        },
      },
    });
    expect(wire.monthly).not.toHaveProperty('offerId');
    expect(wire.annual).not.toHaveProperty('offerId');
  });

  it('converts the real backend LEGACY serialization into the real client kind:legacy contract', () => {
    const internalSnapshot: PromoCodeAndroidOfferSnapshot = {
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
    };

    const wire = serializeAndroidStoreConfigForWire(internalSnapshot);
    const parsed = parsePromoCodeAndroidStoreConfig(wire);

    expect(parsed).toEqual({
      status: 'valid',
      config: {
        monthly: {
          kind: 'legacy',
          basePlanId: 'monthly',
          offerId: 'influencer-trial-7d',
        },
        annual: {
          kind: 'legacy',
          basePlanId: 'annual',
          offerId: 'influencer-trial-7d-annual',
        },
      },
    });
    expect(wire.monthly).not.toHaveProperty('offeringIdentifier');
    expect(wire.annual).not.toHaveProperty('offeringIdentifier');
  });
});
