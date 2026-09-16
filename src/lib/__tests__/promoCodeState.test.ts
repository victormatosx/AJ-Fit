import { describe, expect, it } from 'vitest';
import {
  createInitialPromoCodeState,
  parseAndroidSubscriptionOfferConfig,
  parsePromoCodeAndroidStoreConfig,
  reducePromoCodeState,
  type PromoCodeAndroidStoreConfig,
  type PromoCodeBenefit,
  type IOSPromotionAuthorization,
} from '../promoCodeState';

const BENEFIT: PromoCodeBenefit = {
  campaignId: 'campaign-arnaldo',
  influencerId: 'ARNALDO',
  kind: 'promotional_campaign',
};

const HELLLEN_BENEFIT: PromoCodeBenefit = {
  campaignId: 'campaign-helllen',
  influencerId: 'HELLLEN',
  kind: 'promotional_campaign',
};

const STORE_CONFIG: PromoCodeAndroidStoreConfig = {
  monthly: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { kind: 'legacy', basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
};

const IOS_PROMOTION: IOSPromotionAuthorization = {
  offeringIdentifier: 'promo_7d',
  monthlyProductId: 'ajfit_premium_monthly_promo',
  annualProductId: 'ajfit_premium_annual_promo',
};

const UID_A = 'firebase-uid-a';
const UID_B = 'firebase-uid-b';

describe('promoCodeState — A: initial state', () => {
  it('starts idle, with no identity/applied code', () => {
    const state = createInitialPromoCodeState();
    expect(state).toEqual({
      uid: null,
      generation: 0,
      seq: 0,
      phase: 'idle',
      applied: null,
      message: null,
    });
  });
});

describe('promoCodeState — B/C: happy path validating → applied', () => {
  it('transitions idle → validating → applied, carrying uid/generation/code/benefit/storeConfig', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    expect(state.phase).toBe('validating');

    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state.phase).toBe('applied');
    expect(state.applied).toEqual({
      uid: UID_A,
      generation: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });
  });
});

describe('promoCodeState — C: invalid code', () => {
  it('transitions validating → unavailable with the backend-provided generic message', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-unavailable',
      uid: UID_A,
      generation: 1,
      seq: 1,
      message: 'Este código não está disponível.',
    });

    expect(state.phase).toBe('unavailable');
    expect(state.applied).toBeNull();
    expect(state.message).toBe('Este código não está disponível.');
  });
});

describe('promoCodeState — D: temporary error', () => {
  it('transitions validating → error, never discarding an unrelated later retry', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-error',
      uid: UID_A,
      generation: 1,
      seq: 1,
      message: 'Não foi possível aplicar o código agora. Tente novamente.',
    });

    expect(state.phase).toBe('error');
    expect(state.applied).toBeNull();
  });
});

describe('promoCodeState — E: attribution_locked', () => {
  it('transitions validating → locked with a distinct message, never fabricating an applied record', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-locked',
      uid: UID_A,
      generation: 1,
      seq: 1,
      message: 'Este código não pode mais ser alterado nesta conta.',
    });

    expect(state.phase).toBe('locked');
    expect(state.applied).toBeNull();
    expect(state.message).toBe('Este código não pode mais ser alterado nesta conta.');
  });
});

describe('promoCodeState — unauthenticated: never keeps promo state', () => {
  it('resets straight to idle, not an error phase', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'unauthenticated',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });

    expect(state).toEqual({
      uid: UID_A,
      generation: 1,
      seq: 1,
      phase: 'idle',
      applied: null,
      message: null,
    });
  });
});

describe('promoCodeState — F: response for A discarded after logout', () => {
  it('a validation-applied for the OLD uid/generation never touches state after identity-changed to null', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });

    // logout
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: null, generation: 2 });
    const afterLogout = state;

    // A's late response arrives, still carrying the OLD uid/generation/seq
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state).toEqual(afterLogout);
    expect(state.applied).toBeNull();
  });
});

describe('promoCodeState — G: response for A discarded once B logs in', () => {
  it('B never sees ARNALDO applied from A\'s pending request', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });

    // logout, then B logs in
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: null, generation: 2 });
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_B, generation: 3 });
    const bState = state;

    // A's late response arrives
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state).toEqual(bState);
    expect(state.uid).toBe(UID_B);
    expect(state.applied).toBeNull();
  });
});

describe('promoCodeState — H: ARNALDO → HELLLEN swap invalidates ARNALDO immediately', () => {
  it('starting a new validation clears the previously applied code right away, before HELLLEN even resolves', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });
    expect(state.applied?.code).toBe('ARNALDO');

    // user swaps to HELLLEN — a NEW validation starts
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 2,
    });

    expect(state.phase).toBe('validating');
    expect(state.applied).toBeNull(); // ARNALDO is gone immediately, not just once HELLLEN resolves
  });
});

describe('promoCodeState — I: a late ARNALDO response never overwrites HELLLEN', () => {
  it('discards a stale seq even though uid/generation still match (same identity, different attempt)', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1, // ARNALDO's attempt
    });
    // user swaps before ARNALDO resolves
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 2, // HELLLEN's attempt
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 2,
      code: 'HELLLEN',
      benefit: HELLLEN_BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });
    expect(state.applied?.code).toBe('HELLLEN');
    const helllenState = state;

    // ARNALDO's response arrives late, still carrying seq: 1
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state).toEqual(helllenState);
    expect(state.applied?.code).toBe('HELLLEN');
  });
});

describe('promoCodeState — Y: logout clears promo state', () => {
  it('identity-changed to null resets phase/applied/message unconditionally, even from "applied"', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      iosPromotion: null,
    });
    expect(state.phase).toBe('applied');

    state = reducePromoCodeState(state, { type: 'identity-changed', uid: null, generation: 2 });

    expect(state).toEqual({
      uid: null,
      generation: 2,
      seq: 0,
      phase: 'idle',
      applied: null,
      message: null,
    });
  });
});

describe('promoCodeState — FASE 4 iOS promotion authorization lifecycle', () => {
  it('preserves the complete backend authorization', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 1,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: null,
      iosPromotion: IOS_PROMOTION,
    });

    expect(state.applied?.iosPromotion).toEqual(IOS_PROMOTION);
  });

  it('clears authorization on code swap, definitive failure, logout, and user switch', () => {
    let state = createInitialPromoCodeState();
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 1 });
    state = reducePromoCodeState(state, {
      type: 'validation-started', uid: UID_A, generation: 1, seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 1,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: null,
      iosPromotion: IOS_PROMOTION,
    });
    expect(state.applied?.iosPromotion).toEqual(IOS_PROMOTION);

    state = reducePromoCodeState(state, {
      type: 'validation-started', uid: UID_A, generation: 1, seq: 2,
    });
    expect(state.applied).toBeNull();
    state = reducePromoCodeState(state, {
      type: 'validation-unavailable',
      uid: UID_A,
      generation: 1,
      seq: 2,
      message: 'Este código não está disponível.',
    });
    expect(state.applied).toBeNull();

    state = reducePromoCodeState(state, { type: 'identity-changed', uid: null, generation: 2 });
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_B, generation: 3 });
    expect(state.uid).toBe(UID_B);
    expect(state.applied).toBeNull();
  });
});

// FASE 6.2 — client-side fail-closed parser for storeConfig.android.
describe('parseAndroidSubscriptionOfferConfig', () => {
  it('absent (null) parses as absent', () => {
    expect(parseAndroidSubscriptionOfferConfig(null)).toEqual({ status: 'absent' });
  });

  it('accepts the LEGACY shape (basePlanId + offerId)', () => {
    expect(
      parseAndroidSubscriptionOfferConfig({ basePlanId: 'monthly', offerId: 'influencer-trial-7d' }),
    ).toEqual({
      status: 'valid',
      config: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
    });
  });

  it('accepts the NEW shape (basePlanId + offeringIdentifier)', () => {
    expect(
      parseAndroidSubscriptionOfferConfig({
        basePlanId: 'monthly-promo',
        offeringIdentifier: 'coupon_discount',
      }),
    ).toEqual({
      status: 'valid',
      config: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: 'coupon_discount' },
    });
  });

  it('rejects basePlanId alone (incomplete — neither shape)', () => {
    expect(parseAndroidSubscriptionOfferConfig({ basePlanId: 'monthly' })).toEqual({
      status: 'invalid',
    });
  });

  it('rejects offerId alone (missing basePlanId)', () => {
    expect(parseAndroidSubscriptionOfferConfig({ offerId: 'influencer-trial-7d' })).toEqual({
      status: 'invalid',
    });
  });

  it('rejects offeringIdentifier alone (missing basePlanId)', () => {
    expect(parseAndroidSubscriptionOfferConfig({ offeringIdentifier: 'coupon_discount' })).toEqual({
      status: 'invalid',
    });
  });

  it('rejects offerId AND offeringIdentifier together (ambiguous — which shape?)', () => {
    expect(
      parseAndroidSubscriptionOfferConfig({
        basePlanId: 'monthly',
        offerId: 'influencer-trial-7d',
        offeringIdentifier: 'coupon_discount',
      }),
    ).toEqual({ status: 'invalid' });
  });

  it('rejects an empty object', () => {
    expect(parseAndroidSubscriptionOfferConfig({})).toEqual({ status: 'invalid' });
  });

  it.each([
    ['empty string basePlanId', { basePlanId: '', offerId: 'x' }],
    ['empty string offerId', { basePlanId: 'monthly', offerId: '' }],
    ['non-string basePlanId', { basePlanId: 42, offerId: 'x' }],
    ['non-string offeringIdentifier', { basePlanId: 'monthly', offeringIdentifier: 42 }],
    ['whitespace-only offerId', { basePlanId: 'monthly', offerId: '   ' }],
    ['untrimmed offeringIdentifier', { basePlanId: 'monthly', offeringIdentifier: ' coupon_discount ' }],
  ])('rejects invalid field types/values: %s', (_label, value) => {
    expect(parseAndroidSubscriptionOfferConfig(value)).toEqual({ status: 'invalid' });
  });

  it('rejects an array', () => {
    expect(parseAndroidSubscriptionOfferConfig(['monthly', 'x'])).toEqual({ status: 'invalid' });
  });

  it('rejects a string/number/boolean', () => {
    expect(parseAndroidSubscriptionOfferConfig('monthly')).toEqual({ status: 'invalid' });
    expect(parseAndroidSubscriptionOfferConfig(42)).toEqual({ status: 'invalid' });
    expect(parseAndroidSubscriptionOfferConfig(true)).toEqual({ status: 'invalid' });
  });

  it('rejects an unknown extra key alongside a valid legacy pair', () => {
    expect(
      parseAndroidSubscriptionOfferConfig({
        basePlanId: 'monthly',
        offerId: 'influencer-trial-7d',
        extra: 'x',
      }),
    ).toEqual({ status: 'invalid' });
  });
});

describe('parsePromoCodeAndroidStoreConfig', () => {
  it('absent (null) parses as absent', () => {
    expect(parsePromoCodeAndroidStoreConfig(null)).toEqual({ status: 'absent' });
  });

  it('accepts both plans in the LEGACY shape (ARNALDO today)', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({
        monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
      }),
    ).toEqual({
      status: 'valid',
      config: {
        monthly: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: { kind: 'legacy', basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
      },
    });
  });

  it('accepts both plans in the NEW shape (ARNALDO future)', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({
        monthly: { basePlanId: 'monthly-promo', offeringIdentifier: 'coupon_discount' },
        annual: { basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
      }),
    ).toEqual({
      status: 'valid',
      config: {
        monthly: { kind: 'new', basePlanId: 'monthly-promo', offeringIdentifier: 'coupon_discount' },
        annual: { kind: 'new', basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
      },
    });
  });

  it('accepts a mixed catalog — one plan legacy, the other new (transition period)', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({
        monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: { basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
      }),
    ).toEqual({
      status: 'valid',
      config: {
        monthly: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: { kind: 'new', basePlanId: 'annual-promo', offeringIdentifier: 'coupon_discount' },
      },
    });
  });

  it('accepts one plan configured and the other absent (null)', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({
        monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: null,
      }),
    ).toEqual({
      status: 'valid',
      config: {
        monthly: { kind: 'legacy', basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
        annual: null,
      },
    });
  });

  it('accepts both plans absent (null)', () => {
    expect(parsePromoCodeAndroidStoreConfig({ monthly: null, annual: null })).toEqual({
      status: 'valid',
      config: { monthly: null, annual: null },
    });
  });

  it('rejects the WHOLE object when only one plan is malformed — never exposes the other plan alone', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({
        monthly: { basePlanId: 'monthly' }, // incomplete
        annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' }, // valid
      }),
    ).toEqual({ status: 'invalid' });
  });

  it('rejects a missing plan key entirely (not even null)', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({ monthly: { basePlanId: 'monthly', offerId: 'x' } }),
    ).toEqual({ status: 'invalid' });
  });

  it('rejects an unknown top-level key', () => {
    expect(
      parsePromoCodeAndroidStoreConfig({ monthly: null, annual: null, extra: 'x' }),
    ).toEqual({ status: 'invalid' });
  });

  it('rejects an array/string/number', () => {
    expect(parsePromoCodeAndroidStoreConfig([])).toEqual({ status: 'invalid' });
    expect(parsePromoCodeAndroidStoreConfig('x')).toEqual({ status: 'invalid' });
    expect(parsePromoCodeAndroidStoreConfig(1)).toEqual({ status: 'invalid' });
  });
});
