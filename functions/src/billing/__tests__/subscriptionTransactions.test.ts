import { describe, expect, it } from 'vitest';
import { normalizeFinancialEvent } from '../subscriptionTransactions';

const paid = { id: 'evt', type: 'INITIAL_PURCHASE', transaction_id: 'tx', original_transaction_id: 'original', purchased_at_ms: 1_700_000_000_000, event_timestamp_ms: 1_700_000_000_100, period_type: 'NORMAL', product_id: 'ajfit_premium_annual', store: 'APP_STORE', currency: 'BRL', price: 40, price_in_purchased_currency: 199.9, tax_percentage: .1, commission_percentage: .15 };

describe('financial webhook normalization', () => {
  it('never treats a trial redemption as revenue', () => {
    expect(normalizeFinancialEvent({ ...paid, period_type: 'TRIAL' })).toEqual({ status: 'not_paid_event' });
  });
  it('preserves the actual transaction currency and historical price', () => {
    const result = normalizeFinancialEvent(paid);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data.currency).toBe('BRL');
      expect(result.data.grossRevenue).toBe(199.9);
      expect(result.data.plan).toBe('annual');
    }
  });
  it('fails closed when RevenueCat omits transaction identity', () => {
    expect(normalizeFinancialEvent({ ...paid, transaction_id: undefined })).toEqual({ status: 'invalid_financial_event', reason: 'missing_transaction_id' });
  });
});
