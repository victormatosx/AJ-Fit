import { describe, expect, it, vi } from 'vitest';
import {
  normalizeRevenueCatEnvironment,
  productionSubscriptionTransactionsQuery,
  SUBSCRIPTION_TRANSACTIONS_COLLECTION,
} from '../financialEnvironment';

describe('normalizeRevenueCatEnvironment', () => {
  it('passes through the two documented RevenueCat values', () => {
    expect(normalizeRevenueCatEnvironment('PRODUCTION')).toBe('PRODUCTION');
    expect(normalizeRevenueCatEnvironment('SANDBOX')).toBe('SANDBOX');
  });

  it('fails closed to UNKNOWN — never infers PRODUCTION from an absent or malformed value', () => {
    expect(normalizeRevenueCatEnvironment(undefined)).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment(null)).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment('')).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment('production')).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment('sandbox')).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment('prod')).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment(123)).toBe('UNKNOWN');
    expect(normalizeRevenueCatEnvironment({})).toBe('UNKNOWN');
  });
});

describe('productionSubscriptionTransactionsQuery', () => {
  it('always filters to environment == PRODUCTION on the ledger collection, never a bare collection scan', () => {
    const where = vi.fn();
    const collection = vi.fn(() => ({ where }));
    const db = { collection } as unknown as Parameters<typeof productionSubscriptionTransactionsQuery>[0];

    productionSubscriptionTransactionsQuery(db);

    expect(collection).toHaveBeenCalledWith(SUBSCRIPTION_TRANSACTIONS_COLLECTION);
    expect(where).toHaveBeenCalledWith('environment', '==', 'PRODUCTION');
  });
});
