import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { correlateApplePromoPurchaseIntent } from '../applePromoPurchaseIntentCorrelation';

const START = Date.parse('2026-08-13T15:00:00.000Z');
const END = START + 10 * 60 * 1000;
const IOS_PROMOTION = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};

function pendingIntent(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'campaign-arnaldo',
    plan: 'monthly',
    expectedProductId: IOS_PROMOTION.monthlyProductId,
    offeringIdentifier: IOS_PROMOTION.offeringIdentifier,
    status: 'purchase_pending',
    createdAt: Timestamp.fromMillis(START),
    updatedAt: Timestamp.fromMillis(START),
    expiresAt: Timestamp.fromMillis(END),
    ...overrides,
  };
}

function correlate(overrides: Record<string, unknown> = {}) {
  return correlateApplePromoPurchaseIntent({
    eventType: 'INITIAL_PURCHASE',
    eventId: 'evt-promo-initial-001',
    productId: IOS_PROMOTION.monthlyProductId,
    purchasedAtMs: START + 5 * 60 * 1000,
    redemptionCampaignId: 'campaign-arnaldo',
    iosPromotion: IOS_PROMOTION,
    hasPurchaseIntent: true,
    purchaseIntent: pendingIntent(),
    ...overrides,
  });
}

describe('correlateApplePromoPurchaseIntent', () => {
  it.each([
    ['monthly', IOS_PROMOTION.monthlyProductId],
    ['annual', IOS_PROMOTION.annualProductId],
  ] as const)('matches the exact %s intent', (plan, productId) => {
    expect(
      correlate({ productId, purchaseIntent: pendingIntent({ plan, expectedProductId: productId }) }),
    ).toMatchObject({ status: 'matched', plan });
  });

  it('returns no_intent for a known promo product without intent', () => {
    expect(correlate({ hasPurchaseIntent: false, purchaseIntent: undefined })).toEqual({
      status: 'no_intent',
    });
  });

  it('returns not_promotional for a normal product without intent, allowing legacy routing', () => {
    expect(
      correlate({
        hasPurchaseIntent: false,
        purchaseIntent: undefined,
        productId: 'ajfit_premium_monthly',
      }),
    ).toEqual({ status: 'not_promotional' });
  });

  it('does not fall back to legacy when a present new-flow snapshot is malformed', () => {
    expect(
      correlate({
        hasPurchaseIntent: false,
        purchaseIntent: undefined,
        iosPromotion: { offeringIdentifier: 'promo_7d' },
      }),
    ).toEqual({ status: 'malformed' });
  });

  it('rejects webhook product mismatch, including a normal product', () => {
    expect(correlate({ productId: IOS_PROMOTION.annualProductId })).toEqual({
      status: 'product_mismatch',
    });
    expect(correlate({ productId: 'ajfit_premium_monthly' })).toEqual({
      status: 'product_mismatch',
    });
  });

  it('rejects campaign mismatch', () => {
    expect(correlate({ purchaseIntent: pendingIntent({ campaignId: 'campaign-other' }) })).toEqual({
      status: 'campaign_mismatch',
    });
  });

  it('rejects offering mismatch', () => {
    expect(
      correlate({ purchaseIntent: pendingIntent({ offeringIdentifier: 'another-offering' }) }),
    ).toEqual({ status: 'offering_mismatch' });
  });

  it('rejects a plan/product mismatch inside the trusted snapshots', () => {
    expect(
      correlate({ purchaseIntent: pendingIntent({ expectedProductId: IOS_PROMOTION.annualProductId }) }),
    ).toEqual({ status: 'snapshot_product_mismatch' });
  });

  it('uses purchase time, so a delayed webhook still matches', () => {
    expect(correlate({ purchasedAtMs: START + 5 * 60 * 1000 })).toMatchObject({
      status: 'matched',
    });
  });

  it.each([START, END])('accepts the inclusive temporal boundary %s', (purchasedAtMs) => {
    expect(correlate({ purchasedAtMs })).toMatchObject({ status: 'matched' });
  });

  it('rejects a purchase after expiration', () => {
    expect(correlate({ purchasedAtMs: END + 1 })).toEqual({ status: 'expired' });
  });

  it('rejects a purchase before the intent existed', () => {
    expect(correlate({ purchasedAtMs: START - 1 })).toEqual({
      status: 'purchase_before_intent',
    });
  });

  it.each([undefined, null, 0, -1, 1.5, '1780000000000'])(
    'fails closed for malformed purchase timestamp %s',
    (purchasedAtMs) => {
      expect(correlate({ purchasedAtMs })).toEqual({ status: 'malformed' });
    },
  );

  it.each([
    pendingIntent({ status: 'unknown' }),
    pendingIntent({ expectedProductId: '' }),
    pendingIntent({ plan: 'weekly' }),
    pendingIntent({ expiresAt: Timestamp.fromMillis(START) }),
  ])('fails closed for malformed intent/snapshot state', (purchaseIntent) => {
    expect(correlate({ purchaseIntent })).toEqual({ status: 'malformed' });
  });

  it('never lets RENEWAL consume an intent', () => {
    expect(correlate({ eventType: 'RENEWAL' })).toEqual({ status: 'unsupported_event' });
  });

  it('distinguishes exact retry from a different event reusing a confirmed intent', () => {
    const confirmed = {
      ...pendingIntent(),
      status: 'purchase_confirmed',
      confirmedAt: Timestamp.fromMillis(START + 1000),
      revenueCatEventId: 'evt-promo-initial-001',
    };
    expect(correlate({ purchaseIntent: confirmed })).toEqual({ status: 'already_processed' });
    expect(correlate({ eventId: 'evt-promo-initial-002', purchaseIntent: confirmed })).toEqual({
      status: 'already_consumed',
    });
  });
});
