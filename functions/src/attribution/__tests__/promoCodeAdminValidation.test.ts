import { describe, expect, it } from 'vitest';
import { validateAdminPromoCodeWrite } from '../promoCodeAdminValidation';

const BASE = {
  code: 'ARNALDO',
  campaignId: 'influencer-arnaldo-7d',
  influencerId: 'ARNALDO',
  active: false,
  appleConfigurationConfirmed: false,
  startsAt: null,
  endsAt: null,
  notes: null,
};

describe('validateAdminPromoCodeWrite', () => {
  it('accepts a minimal valid payload', () => {
    const result = validateAdminPromoCodeWrite(BASE, { requireCode: true });
    expect(result.ok).toBe(true);
  });

  it('rejects an empty campaignId', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, campaignId: '  ' }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_campaign_id' });
  });

  it('rejects an empty influencerId', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, influencerId: '' }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_influencer_id' });
  });

  it('rejects a non-boolean active flag', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, active: 'true' }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_active' });
  });

  it('rejects activation without the administrative Apple confirmation', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, active: true }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'active_requires_apple_configuration_confirmation' });
  });

  it('rejects an unparseable startsAt', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, startsAt: 'not-a-date' }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_starts_at' });
  });

  it('rejects endsAt before startsAt', () => {
    const result = validateAdminPromoCodeWrite(
      { ...BASE, startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z' },
      { requireCode: true },
    );
    expect(result).toEqual({ ok: false, error: 'ends_at_before_starts_at' });
  });

  it('accepts endsAt equal to startsAt', () => {
    const result = validateAdminPromoCodeWrite(
      { ...BASE, startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' },
      { requireCode: true },
    );
    expect(result.ok).toBe(true);
  });

  it('trims and uppercases the code exactly like normalizePromoCode', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, code: '  arnaldo  ' }, { requireCode: true });
    expect(result.ok && result.fields.code).toBe('ARNALDO');
  });

  it('rejects a code with invalid characters', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, code: 'ARNALDO!' }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_code_format' });
  });

  it('requireCode: false does not validate/return a code', () => {
    const { code: _code, ...withoutCode } = BASE;
    const result = validateAdminPromoCodeWrite(withoutCode, { requireCode: false });
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.code).toBe('');
  });

  describe('android pair fail-closed rejection', () => {
    it('rejects basePlanId without offerId', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, android: { monthly: { basePlanId: 'monthly' } } },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'android_monthly_partial' });
    });

    it('rejects offerId without basePlanId', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, android: { annual: { offerId: 'influencer-trial-7d-annual' } } },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'android_annual_partial' });
    });

    it('accepts a complete pair', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, android: { monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' } } },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.androidBasePlanIdMonthly).toBe('monthly');
      expect(result.ok && result.fields.androidOfferIdMonthly).toBe('influencer-trial-7d');
    });

    it('a plan with neither field present resolves to null, not an error', () => {
      const result = validateAdminPromoCodeWrite({ ...BASE, android: { monthly: null } }, { requireCode: true });
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.androidBasePlanIdMonthly).toBeNull();
      expect(result.ok && result.fields.androidOfferIdMonthly).toBeNull();
    });
  });

  it('rejects notes exceeding the defensive length bound', () => {
    const result = validateAdminPromoCodeWrite({ ...BASE, notes: 'x'.repeat(2001) }, { requireCode: true });
    expect(result).toEqual({ ok: false, error: 'invalid_notes' });
  });

  it('annual plan left unconfigured is valid — only the configured plan is required to be complete', () => {
    const result = validateAdminPromoCodeWrite(
      {
        ...BASE,
        android: { monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' } },
      },
      { requireCode: true },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.androidBasePlanIdAnnual).toBeNull();
  });

  // FASE 1 — iosPromotion admin write validation.
  const VALID_IOS_PROMOTION = {
    offeringIdentifier: 'promo_7d',
    monthlyProductId: 'ajfit_premium_monthly_promo',
    annualProductId: 'ajfit_premium_annual_promo',
  };

  describe('iosPromotion (FASE 1) all-or-nothing validation', () => {
    it('absent iosPromotion is valid — resolves to null', () => {
      const result = validateAdminPromoCodeWrite(BASE, { requireCode: true });
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.iosPromotion).toBeNull();
    });

    it('explicit null iosPromotion is valid — resolves to null', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, iosPromotion: null },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.iosPromotion).toBeNull();
    });

    it('accepts a fully configured iosPromotion', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, iosPromotion: VALID_IOS_PROMOTION },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.iosPromotion).toEqual(VALID_IOS_PROMOTION);
    });

    it('requires a complete iOS promotion before accepting the Apple declaration', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, appleConfigurationConfirmed: true },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'apple_configuration_requires_ios_promotion' });
    });

    it('accepts the Apple declaration with the complete iOS promotion', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, appleConfigurationConfirmed: true, iosPromotion: VALID_IOS_PROMOTION },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.appleConfigurationConfirmed).toBe(true);
    });

    it('rejects a partial iosPromotion (one field missing) — never a partial authorization', () => {
      const { annualProductId: _annualProductId, ...partial } = VALID_IOS_PROMOTION;
      const result = validateAdminPromoCodeWrite(
        { ...BASE, iosPromotion: partial },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'ios_promotion_invalid' });
    });

    it('rejects a blank/whitespace-only field within iosPromotion', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, iosPromotion: { ...VALID_IOS_PROMOTION, offeringIdentifier: '   ' } },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'ios_promotion_invalid' });
    });

    it('trims each field', () => {
      const result = validateAdminPromoCodeWrite(
        {
          ...BASE,
          iosPromotion: {
            offeringIdentifier: '  promo_7d  ',
            monthlyProductId: '  ajfit_premium_monthly_promo  ',
            annualProductId: '  ajfit_premium_annual_promo  ',
          },
        },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.iosPromotion).toEqual(VALID_IOS_PROMOTION);
    });

    it('is independent of Android fields — configuring one never requires or affects the other', () => {
      const result = validateAdminPromoCodeWrite(
        {
          ...BASE,
          android: { monthly: { basePlanId: 'monthly', offerId: 'influencer-trial-7d' } },
          iosPromotion: VALID_IOS_PROMOTION,
        },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.androidBasePlanIdMonthly).toBe('monthly');
      expect(result.ok && result.fields.iosPromotion).toEqual(VALID_IOS_PROMOTION);
    });
  });
});
