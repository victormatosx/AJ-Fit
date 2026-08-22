import { describe, expect, it } from 'vitest';
import { resolveCouponSubscriptionState, summarizeCouponJourney, type CouponJourneyRecord } from '../presentation';

function record(overrides: Partial<CouponJourneyRecord> = {}): CouponJourneyRecord {
  return {
    uid: 'uid', couponCode: 'FIT10', campaignId: 'campaign', influencerId: 'influencer',
    appliedAt: '2026-08-01T00:00:00.000Z', trialStartedAt: null, convertedAt: null,
    lockedAt: null, state: 'UNKNOWN',
    subscription: { status: null, entitlementActive: null, productId: null, plan: 'unknown', store: null, startedAt: null, trialEndsAt: null, currentPeriodEndsAt: null, canceledAt: null, lastRenewedAt: null },
    ...overrides,
  };
}

describe('coupon commercial presentation', () => {
  it('distinguishes cancellation scheduled from expiration', () => {
    expect(resolveCouponSubscriptionState('CANCELED', true)).toBe('CANCELS_AT_PERIOD_END');
    expect(resolveCouponSubscriptionState('CANCELED', false)).toBe('EXPIRED');
  });

  it('does not count a redemption or trial as a paid conversion', () => {
    const metrics = summarizeCouponJourney([
      record({ state: 'TRIAL', trialStartedAt: '2026-08-02T00:00:00.000Z' }),
      record({ uid: 'paid', convertedAt: '2026-08-03T00:00:00.000Z', state: 'ACTIVE', subscription: { ...record().subscription, status: 'ACTIVE', entitlementActive: true, plan: 'annual', lastRenewedAt: '2026-08-20T00:00:00.000Z' } }),
    ]);
    expect(metrics.redemptions).toBe(2);
    expect(metrics.trialsActive).toBe(1);
    expect(metrics.paidConversions).toBe(1);
    expect(metrics.annual).toBe(1);
    expect(metrics.renewalsObserved).toBe(1);
    expect(metrics.revenue).toBeNull();
    expect(metrics.commission).toBeNull();
  });
});
