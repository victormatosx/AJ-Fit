import { describe, expect, it } from 'vitest';
import { resolveSubscriptionPlan } from '../presentation';

describe('admin user subscription presentation', () => {
  it.each([
    ['ajfit_premium_monthly', 'monthly'],
    ['ajfit_premium_monthly_promo', 'monthly'],
    ['ajfit_premium:monthly', 'monthly'],
    ['ajfit_premium:monthly-promo', 'monthly'],
    ['ajfit_premium_annual', 'annual'],
    ['ajfit_premium_annual_promo', 'annual'],
    ['ajfit_premium:annual', 'annual'],
    ['ajfit_premium:annual-promo', 'annual'],
    ['future_product', 'unknown'],
    [null, 'unknown'],
  ])('maps only documented product IDs (%s)', (productId, expected) => {
    expect(resolveSubscriptionPlan(productId)).toBe(expected);
  });
});
