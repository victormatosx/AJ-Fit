import { describe, expect, it } from 'vitest';
import {
  createInitialPromoCodeState,
  reducePromoCodeState,
  type PromoCodeAndroidStoreConfig,
  type PromoCodeAppleStoreConfig,
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
  monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' },
  annual: { basePlanId: 'annual', offerId: 'influencer-trial-7d-annual' },
};

const APPLE_STORE_CONFIG: PromoCodeAppleStoreConfig = {
  offerCodeMonthly: 'INFLUENCER7D_MONTHLY',
  offerCodeAnnual: 'INFLUENCER7D_ANNUAL',
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
      appleStoreConfig: null,
      iosPromotion: null,
    });

    expect(state.phase).toBe('applied');
    expect(state.applied).toEqual({
      uid: UID_A,
      generation: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: STORE_CONFIG,
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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
      appleStoreConfig: null,
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

describe('promoCodeState — FASE iOS-2: Apple store config transport', () => {
  it('F/G: an iOS validation-applied preserves monthly/annual Apple offer codes exactly, independent of Android config', () => {
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
      appleStoreConfig: APPLE_STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state.applied?.appleStoreConfig).toEqual(APPLE_STORE_CONFIG);
    expect(state.applied?.appleStoreConfig?.offerCodeMonthly).toBe('INFLUENCER7D_MONTHLY');
    expect(state.applied?.appleStoreConfig?.offerCodeAnnual).toBe('INFLUENCER7D_ANNUAL');
  });

  it('I/J: Android and Apple configs are carried as two independent fields — neither is ever read as the other', () => {
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
      appleStoreConfig: APPLE_STORE_CONFIG,
      iosPromotion: null,
    });

    expect(state.applied?.androidStoreConfig).toEqual(STORE_CONFIG);
    expect(state.applied?.appleStoreConfig).toEqual(APPLE_STORE_CONFIG);
    // Structurally distinct shapes: the Android config has `monthly`/`annual`
    // base-plan/offer pairs; the Apple config has flat `offerCodeMonthly`/
    // `offerCodeAnnual` strings. Neither has a field the other has.
    expect(state.applied?.androidStoreConfig).not.toHaveProperty('offerCodeMonthly');
    expect(state.applied?.appleStoreConfig).not.toHaveProperty('monthly');
  });

  it('E: a platform requested without Apple config (Android-only response) carries appleStoreConfig: null, never a guessed value', () => {
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
      appleStoreConfig: null,
      iosPromotion: null,
    });

    expect(state.applied?.appleStoreConfig).toBeNull();
  });

  it('H: removing/resetting the coupon (identity-changed) clears the Apple config along with everything else', () => {
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
      appleStoreConfig: APPLE_STORE_CONFIG,
      iosPromotion: null,
    });
    expect(state.applied?.appleStoreConfig).toEqual(APPLE_STORE_CONFIG);

    state = reducePromoCodeState(state, { type: 'identity-changed', uid: null, generation: 2 });

    expect(state.applied).toBeNull();

    // Also cleared by starting a fresh validation for the same identity
    // (ARNALDO → HELLLEN swap), same as the existing Android-only H test.
    state = reducePromoCodeState(state, { type: 'identity-changed', uid: UID_A, generation: 3 });
    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 3,
      seq: 1,
    });
    state = reducePromoCodeState(state, {
      type: 'validation-applied',
      uid: UID_A,
      generation: 3,
      seq: 1,
      code: 'ARNALDO',
      benefit: BENEFIT,
      androidStoreConfig: null,
      appleStoreConfig: APPLE_STORE_CONFIG,
      iosPromotion: null,
    });
    expect(state.applied?.appleStoreConfig).toEqual(APPLE_STORE_CONFIG);

    state = reducePromoCodeState(state, {
      type: 'validation-started',
      uid: UID_A,
      generation: 3,
      seq: 2,
    });
    expect(state.applied).toBeNull();
  });
});

describe('promoCodeState — FASE 4 iOS promotion authorization lifecycle', () => {
  it('preserves the complete backend authorization independently from legacy Apple config', () => {
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
      appleStoreConfig: APPLE_STORE_CONFIG,
      iosPromotion: IOS_PROMOTION,
    });

    expect(state.applied?.iosPromotion).toEqual(IOS_PROMOTION);
    expect(state.applied?.appleStoreConfig).toEqual(APPLE_STORE_CONFIG);
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
      appleStoreConfig: null,
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
