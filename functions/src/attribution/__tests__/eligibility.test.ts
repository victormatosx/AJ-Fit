import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { isPromoCodeCurrentlyEligible } from '../eligibility';
import type { PromoCodeDocument } from '../types';

const NOW = new Date('2026-08-11T12:00:00.000Z');

function promoCode(overrides: Partial<PromoCodeDocument> = {}): PromoCodeDocument {
  return {
    code: 'ARNALDO',
    active: true,
    startsAt: null,
    endsAt: null,
    influencerId: 'ARNALDO',
    campaignId: 'campaign-arnaldo',
    androidBasePlanIdMonthly: 'monthly',
    androidOfferIdMonthly: 'influencer-trial-7d',
    androidBasePlanIdAnnual: 'annual',
    androidOfferIdAnnual: 'influencer-trial-7d-annual',
    appleOfferCodeMonthly: null,
    appleOfferCodeAnnual: null,
    appleProductIdMonthly: null,
    appleOfferReferenceMonthly: null,
    appleProductIdAnnual: null,
    appleOfferReferenceAnnual: null,
    createdAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
    createdBy: 'admin-uid',
    notes: null,
    ...overrides,
  };
}

describe('isPromoCodeCurrentlyEligible', () => {
  it('is eligible when active with no startsAt/endsAt bounds', () => {
    expect(isPromoCodeCurrentlyEligible(promoCode(), NOW)).toBe(true);
  });

  it('is ineligible when inactive, regardless of dates', () => {
    expect(isPromoCodeCurrentlyEligible(promoCode({ active: false }), NOW)).toBe(false);
  });

  it('is ineligible before startsAt', () => {
    const promo = promoCode({
      startsAt: Timestamp.fromDate(new Date('2026-08-12T00:00:00.000Z')),
    });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(false);
  });

  it('is eligible exactly at startsAt', () => {
    const promo = promoCode({ startsAt: Timestamp.fromDate(NOW) });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(true);
  });

  it('is eligible after endsAt has not yet passed', () => {
    const promo = promoCode({
      endsAt: Timestamp.fromDate(new Date('2026-08-12T00:00:00.000Z')),
    });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(true);
  });

  it('is ineligible after endsAt', () => {
    const promo = promoCode({
      endsAt: Timestamp.fromDate(new Date('2026-08-10T00:00:00.000Z')),
    });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(false);
  });

  it('is eligible exactly at endsAt', () => {
    const promo = promoCode({ endsAt: Timestamp.fromDate(NOW) });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(true);
  });

  it('is eligible within a fully bounded window', () => {
    const promo = promoCode({
      startsAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
      endsAt: Timestamp.fromDate(new Date('2026-08-31T00:00:00.000Z')),
    });
    expect(isPromoCodeCurrentlyEligible(promo, NOW)).toBe(true);
  });
});
