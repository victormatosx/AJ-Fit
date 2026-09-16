import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Service-level tests for `validatePromoCode` (Fase iOS — investigação do
 * `functions/internal` no iOS). Mocks every Firebase/RN boundary so this
 * stays a pure unit test of the request → response/error → classification
 * flow, without touching the real SDK or requiring `EXPO_PUBLIC_FIREBASE_*`
 * env vars (see `../../lib/firebase.ts`).
 */

const mockPlatform: { OS: string } = { OS: 'ios' };
const mockCallable = vi.fn();

vi.mock('react-native', () => ({
  Platform: mockPlatform,
}));

vi.mock('../../lib/firebaseFunctions', () => ({
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

class FakeFirebaseError extends Error {
  code: string;
  customData?: unknown;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
    this.code = code;
  }
}

vi.mock('firebase/app', () => ({
  FirebaseError: FakeFirebaseError,
}));

const { authorizePromoPurchase, validatePromoCode } = await import('../promoCodeService');

describe('authorizePromoPurchase', () => {
  beforeEach(() => mockCallable.mockReset());

  it.each(['monthly', 'annual'] as const)('sends only plan for %s', async (plan) => {
    mockCallable.mockResolvedValue({
      data: {
        authorized: true,
        purchaseIntent: {
          plan,
          offeringIdentifier: 'promo_7d',
          expectedProductId: `${plan}_promo`,
          status: 'purchase_pending',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      },
    });
    const result = await authorizePromoPurchase(plan);
    expect(mockCallable).toHaveBeenCalledWith({ plan });
    expect(Object.keys(mockCallable.mock.calls[0][0])).toEqual(['plan']);
    expect(result.status).toBe('authorized');
  });

  it('fails closed on an invalid response', async () => {
    mockCallable.mockResolvedValue({ data: { authorized: true } });
    expect(await authorizePromoPurchase('monthly')).toEqual({
      status: 'failed',
      reason: 'invalid_response',
    });
  });

});

describe('validatePromoCode', () => {
  beforeEach(() => {
    mockCallable.mockReset();
    mockPlatform.OS = 'ios';
  });

  it('returns an applied outcome for a valid iOS Promo SKU response', async () => {
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'ARNALDO',
        benefit: { campaignId: 'c1', influencerId: 'i1', kind: 'promotional_campaign' },
        storeConfig: { android: null },
        iosPromotion: {
          offeringIdentifier: 'promo_7d',
          monthlyProductId: 'monthly_promo',
          annualProductId: 'annual_promo',
        },
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('ARNALDO');

    expect(mockCallable).toHaveBeenCalledWith({ code: 'ARNALDO', platform: 'IOS' });
    expect(outcome.status).toBe('applied');
    if (outcome.status === 'applied') {
      expect(outcome.response.storeConfig.android).toBeNull();
      expect(outcome.response.iosPromotion).toEqual({
        offeringIdentifier: 'promo_7d',
        monthlyProductId: 'monthly_promo',
        annualProductId: 'annual_promo',
      });
    }
  });

  it('returns an applied outcome for a valid Android response — LEGACY shape (storeConfig.android populated)', async () => {
    mockPlatform.OS = 'android';
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'HELLLEN',
        benefit: { campaignId: 'c2', influencerId: 'i2', kind: 'promotional_campaign' },
        storeConfig: {
          android: { monthly: { basePlanId: 'monthly', offerId: 'o1' }, annual: null },
        },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('HELLLEN');

    expect(mockCallable).toHaveBeenCalledWith({ code: 'HELLLEN', platform: 'ANDROID' });
    expect(outcome.status).toBe('applied');
    if (outcome.status === 'applied') {
      expect(outcome.response.storeConfig.android?.monthly).toEqual({
        kind: 'legacy',
        basePlanId: 'monthly',
        offerId: 'o1',
      });
      expect(outcome.response.storeConfig.android?.annual).toBeNull();
      expect(outcome.response.iosPromotion).toBeNull();
    }
  });

  it('FASE 6.2: returns an applied outcome for a valid Android response — NEW shape (basePlanId + offeringIdentifier)', async () => {
    mockPlatform.OS = 'android';
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'ARNALDO',
        benefit: { campaignId: 'c2', influencerId: 'i2', kind: 'promotional_campaign' },
        storeConfig: {
          android: {
            monthly: { basePlanId: 'monthly-promo', offeringIdentifier: 'coupon_discount' },
            annual: { basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
          },
        },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('applied');
    if (outcome.status === 'applied') {
      expect(outcome.response.storeConfig.android).toEqual({
        monthly: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: 'coupon_discount' },
        annual: { kind: 'new', basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
      });
    }
  });

  it('FASE 6.2: fails closed on Android when storeConfig.android is malformed (basePlanId alone, incomplete)', async () => {
    mockPlatform.OS = 'android';
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'BROKEN',
        benefit: { campaignId: 'c3', influencerId: 'i3', kind: 'promotional_campaign' },
        storeConfig: { android: { monthly: { basePlanId: 'monthly' }, annual: null } },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('BROKEN');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.reason).toBe('temporary');
    }
  });

  it('FASE 6.2: fails closed on Android when storeConfig.android mixes offerId AND offeringIdentifier (ambiguous)', async () => {
    mockPlatform.OS = 'android';
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'BROKEN2',
        benefit: { campaignId: 'c4', influencerId: 'i4', kind: 'promotional_campaign' },
        storeConfig: {
          android: {
            monthly: { basePlanId: 'monthly', offerId: 'o1', offeringIdentifier: 'coupon_discount' },
            annual: null,
          },
        },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('BROKEN2');

    expect(outcome.status).toBe('failed');
  });

  it('FASE 6.2: never validates storeConfig.android shape when platform is IOS — backend always forces it null there', async () => {
    mockPlatform.OS = 'ios';
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'IOSONLY',
        benefit: { campaignId: 'c5', influencerId: 'i5', kind: 'promotional_campaign' },
        // Malformed on the wire, but irrelevant on iOS — must not fail the request.
        storeConfig: { android: { monthly: { basePlanId: 'monthly' }, annual: null } },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('IOSONLY');

    expect(outcome.status).toBe('applied');
  });

  it('accepts explicit iosPromotion: null on iOS without fabricating a route', async () => {
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'LEGACY',
        benefit: { campaignId: 'c1', influencerId: 'i1', kind: 'promotional_campaign' },
        storeConfig: { android: null },
        iosPromotion: null,
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('LEGACY');
    expect(outcome.status).toBe('applied');
    if (outcome.status === 'applied') expect(outcome.response.iosPromotion).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['partial', { offeringIdentifier: 'promo_7d', monthlyProductId: 'monthly_promo' }],
    ['blank', { offeringIdentifier: 'promo_7d', monthlyProductId: '', annualProductId: 'annual_promo' }],
    ['wrong type', { offeringIdentifier: 'promo_7d', monthlyProductId: 7, annualProductId: 'annual_promo' }],
  ])('fails the iOS validation safely for a %s authorization', async (_label, iosPromotion) => {
    mockCallable.mockResolvedValue({
      data: {
        valid: true,
        code: 'ARNALDO',
        benefit: { campaignId: 'c1', influencerId: 'i1', kind: 'promotional_campaign' },
        storeConfig: { android: null },
        ...(iosPromotion === undefined ? {} : { iosPromotion }),
        eligibility: { determinedBy: 'store', guaranteed: false, disclaimer: 'x' },
      },
    });

    const outcome = await validatePromoCode('ARNALDO');
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('temporary');
  });

  it('classifies a well-formed FirebaseFunctionsError (functions/not-found) as unavailable', async () => {
    mockCallable.mockRejectedValue(new FakeFirebaseError('functions/not-found', 'promo_code_unavailable'));

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('unavailable');
  });

  it('classifies functions/failed-precondition + attribution_locked as locked', async () => {
    mockCallable.mockRejectedValue(new FakeFirebaseError('functions/failed-precondition', 'attribution_locked'));

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('locked');
  });

  it('classifies functions/unauthenticated as unauthenticated', async () => {
    mockCallable.mockRejectedValue(new FakeFirebaseError('functions/unauthenticated', 'authentication_required'));

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('unauthenticated');
  });

  it('classifies an unrecognized FirebaseFunctionsError code (e.g. functions/internal) as temporary', async () => {
    mockCallable.mockRejectedValue(new FakeFirebaseError('functions/internal', 'internal'));

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('temporary');
  });

  it('classifies a plain network Error with no .code as temporary', async () => {
    mockCallable.mockRejectedValue(new Error('Network request failed'));

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('temporary');
  });

  it('classifies a thrown non-Error primitive (string) as temporary, without throwing', async () => {
    mockCallable.mockRejectedValue('boom');

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('temporary');
  });

  it('classifies a thrown non-Error plain object (no code/message) as temporary, without throwing', async () => {
    mockCallable.mockRejectedValue({ unexpected: 'shape' });

    const outcome = await validatePromoCode('ARNALDO');

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toBe('temporary');
  });
});
