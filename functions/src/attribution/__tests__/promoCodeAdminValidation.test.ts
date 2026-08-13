import { describe, expect, it } from 'vitest';
import { validateAdminPromoCodeWrite } from '../promoCodeAdminValidation';

const BASE = {
  code: 'ARNALDO',
  campaignId: 'influencer-arnaldo-7d',
  influencerId: 'ARNALDO',
  active: true,
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

  describe('apple correlation pair fail-closed rejection', () => {
    it('rejects productId without offerReference', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, apple: { monthly: { productId: 'ajfit_premium_monthly' } } },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'apple_monthly_partial' });
    });

    it('rejects offerReference without productId', () => {
      const result = validateAdminPromoCodeWrite(
        { ...BASE, apple: { monthly: { offerReference: 'Influencer Trial 7D' } } },
        { requireCode: true },
      );
      expect(result).toEqual({ ok: false, error: 'apple_monthly_partial' });
    });

    it('accepts a complete pair and never writes it into appleOfferCode*', () => {
      const result = validateAdminPromoCodeWrite(
        {
          ...BASE,
          apple: { monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' } },
        },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.appleProductIdMonthly).toBe('ajfit_premium_monthly');
      expect(result.ok && result.fields.appleOfferReferenceMonthly).toBe('Influencer Trial 7D');
      expect(result.ok && result.fields.appleOfferCodeMonthly).toBeNull();
    });
  });

  describe('appleOfferCode (client-facing) never confused with offerReference', () => {
    it('appleOfferCode.monthly is stored independently of apple.monthly.offerReference', () => {
      const result = validateAdminPromoCodeWrite(
        {
          ...BASE,
          apple: { monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' } },
          appleOfferCode: { monthly: 'ARNALDO7DMONTHLY' },
        },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.appleOfferCodeMonthly).toBe('ARNALDO7DMONTHLY');
      expect(result.ok && result.fields.appleOfferReferenceMonthly).toBe('Influencer Trial 7D');
      expect(result.ok && result.fields.appleOfferCodeMonthly).not.toBe(
        result.ok && result.fields.appleOfferReferenceMonthly,
      );
    });

    it('appleOfferCode absent stays null — never fabricated from offerReference', () => {
      const result = validateAdminPromoCodeWrite(
        {
          ...BASE,
          apple: { monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' } },
        },
        { requireCode: true },
      );
      expect(result.ok).toBe(true);
      expect(result.ok && result.fields.appleOfferCodeMonthly).toBeNull();
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
        apple: { monthly: { productId: 'ajfit_premium_monthly', offerReference: 'Influencer Trial 7D' } },
      },
      { requireCode: true },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.fields.androidBasePlanIdAnnual).toBeNull();
    expect(result.ok && result.fields.appleProductIdAnnual).toBeNull();
  });
});
