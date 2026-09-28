import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const state = {
    currentRedemption: null as Record<string, unknown> | null,
    originMatches: [] as Array<{ id: string; data: Record<string, unknown> }>,
    saleDocuments: new Map<string, Record<string, unknown>>(),
    existingLedgerIds: new Set<string>(),
  };
  const create = vi.fn((ref: { id: string }, data: Record<string, unknown>) => {
    state.existingLedgerIds.add(ref.id);
    state.saleDocuments.set(ref.id, data);
  });
  const snapshot = (id: string, data: Record<string, unknown> | null) => ({
    id,
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => data?.[field],
  });
  const db = {
    collection: vi.fn((collectionName: string) => ({
      doc: (id: string) => ({
        id,
        collectionName,
        get: async () => {
          if (collectionName === 'couponRedemptions') return snapshot(id, state.currentRedemption);
          return snapshot(id, state.saleDocuments.get(id) ?? null);
        },
      }),
      where: () => ({
        limit: () => ({
          get: async () => ({
            size: state.originMatches.length,
            docs: state.originMatches.map((item) => snapshot(item.id, item.data)),
          }),
        }),
      }),
    })),
    runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: async (ref: { id: string }) => snapshot(ref.id, state.existingLedgerIds.has(ref.id) ? {} : null),
      create,
    })),
  };
  return { state, create, db };
});

vi.mock('../../lib/firebaseAdmin', () => ({ db: firestore.db }));

const logger = vi.hoisted(() => ({ logInfo: vi.fn() }));
vi.mock('../../lib/logger', () => logger);

import {
  adjustmentTransactionDocumentId,
  normalizeFinancialEvent,
  persistAttributedFinancialTransaction,
  saleTransactionDocumentId,
} from '../subscriptionTransactions';

const paid = {
  id: 'evt',
  type: 'INITIAL_PURCHASE',
  transaction_id: 'tx',
  original_transaction_id: 'original',
  purchased_at_ms: 1_700_000_000_000,
  event_timestamp_ms: 1_700_000_000_100,
  period_type: 'NORMAL',
  product_id: 'ajfit_premium_annual',
  store: 'APP_STORE',
  currency: 'BRL',
  price: 40,
  price_in_purchased_currency: 199.9,
  tax_percentage: .1,
  commission_percentage: .15,
};

const attributedRedemption = {
  subscriptionOrigin: { transactionKey: 'APP_STORE:original' },
  couponCode: 'AJ10',
  influencerId: 'influencer-1',
  campaignId: 'campaign-1',
};

describe('financial webhook normalization', () => {
  it('never treats a trial redemption as revenue', () => {
    expect(normalizeFinancialEvent({ ...paid, period_type: 'TRIAL' })).toEqual({ status: 'not_paid_event' });
  });

  it('classifies environment straight from RevenueCat, and fails closed to UNKNOWN when absent', () => {
    const production = normalizeFinancialEvent({ ...paid, environment: 'PRODUCTION' });
    const sandbox = normalizeFinancialEvent({ ...paid, environment: 'SANDBOX' });
    const missing = normalizeFinancialEvent(paid);
    expect(production.status === 'valid' && production.data.environment).toBe('PRODUCTION');
    expect(sandbox.status === 'valid' && sandbox.data.environment).toBe('SANDBOX');
    expect(missing.status === 'valid' && missing.data.environment).toBe('UNKNOWN');
  });

  it('preserves the actual transaction currency and computes only an estimate', () => {
    const result = normalizeFinancialEvent(paid);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data).toMatchObject({
        movementType: 'sale',
        currency: 'BRL',
        grossRevenue: 199.9,
        plan: 'annual',
        estimatedProceeds: 149.925,
        subscriptionOriginTransactionKey: 'APP_STORE:original',
      });
    }
  });

  it('keeps an incomplete renewal with unknown financial values instead of zero', () => {
    const result = normalizeFinancialEvent({
      ...paid,
      type: 'RENEWAL',
      currency: undefined,
      price_in_purchased_currency: undefined,
      tax_percentage: undefined,
      commission_percentage: undefined,
    });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data.currency).toBeNull();
      expect(result.data.grossRevenue).toBeNull();
      expect(result.data.taxPercentage).toBeNull();
      expect(result.data.storeCommissionPercentage).toBeNull();
      expect(result.data.estimatedProceeds).toBeNull();
    }
  });

  it('keeps a paid initial purchase when every optional financial field is absent', () => {
    const result = normalizeFinancialEvent({
      ...paid,
      currency: undefined,
      price: undefined,
      price_in_purchased_currency: undefined,
      tax_percentage: undefined,
      commission_percentage: undefined,
    });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data).toMatchObject({
        movementType: 'sale',
        currency: null,
        grossRevenue: null,
        grossRevenueUsd: null,
        taxPercentage: null,
        storeCommissionPercentage: null,
        estimatedProceeds: null,
      });
      expect(result.data.grossRevenue).not.toBe(0);
    }
  });

  it.each([
    ['currency', { currency: undefined }, 149.925],
    ['price', { price_in_purchased_currency: undefined }, null],
    ['tax', { tax_percentage: undefined }, null],
    ['store commission', { commission_percentage: undefined }, null],
  ])('keeps a renewal when %s is absent with the defined proceeds semantics', (_label, missing, expectedProceeds) => {
    const result = normalizeFinancialEvent({ ...paid, type: 'RENEWAL', ...missing });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') expect(result.data.estimatedProceeds).toBe(expectedProceeds);
  });

  it('maps only customer-support cancellations to refunds and preserves a valid negative amount', () => {
    expect(normalizeFinancialEvent({ ...paid, type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' })).toEqual({ status: 'not_paid_event' });
    const result = normalizeFinancialEvent({
      ...paid,
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price: -40,
      price_in_purchased_currency: -199.9,
    });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data).toMatchObject({ movementType: 'refund', grossRevenue: -199.9, cancelReason: 'CUSTOMER_SUPPORT' });
      expect(result.data.relatedSaleDocumentId).toBe(saleTransactionDocumentId('APP_STORE', 'tx'));
    }
  });

  it('maps REFUND_REVERSED and nulls incompatible amount signs', () => {
    const result = normalizeFinancialEvent({ ...paid, type: 'REFUND_REVERSED', price_in_purchased_currency: -199.9 });
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.data.movementType).toBe('refund_reversal');
      expect(result.data.grossRevenue).toBeNull();
      expect(result.data.estimatedProceeds).toBeNull();
    }
  });

  it('does not create a financial movement for expiration', () => {
    expect(normalizeFinancialEvent({ ...paid, type: 'EXPIRATION' })).toEqual({ status: 'not_paid_event' });
  });

  it('creates distinct stable ids for a sale and adjustment', () => {
    expect(saleTransactionDocumentId('APP_STORE', 'tx')).toHaveLength(64);
    expect(adjustmentTransactionDocumentId('evt')).toHaveLength(64);
    expect(adjustmentTransactionDocumentId('evt')).not.toBe(saleTransactionDocumentId('APP_STORE', 'tx'));
  });

  it('fails closed only when required transaction identity is absent', () => {
    expect(normalizeFinancialEvent({ ...paid, transaction_id: undefined })).toEqual({ status: 'invalid_financial_event', reason: 'missing_transaction_id' });
  });
});

describe('append-only financial ledger persistence', () => {
  beforeEach(() => {
    firestore.state.currentRedemption = attributedRedemption;
    firestore.state.originMatches = [];
    firestore.state.saleDocuments.clear();
    firestore.state.existingLedgerIds.clear();
    firestore.create.mockClear();
    logger.logInfo.mockClear();
  });

  it('records an organic initial purchase with no coupon as unresolved instead of dropping it', async () => {
    firestore.state.currentRedemption = null;
    const result = await persistAttributedFinancialTransaction('uid-organic', paid);
    expect(result).toBe('recorded');
    expect(firestore.create).toHaveBeenCalledOnce();
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      movementType: 'sale',
      attributionStatus: 'unresolved',
      attributionUid: null,
      couponCode: null,
      influencerId: null,
      campaignId: null,
    });
    expect(logger.logInfo).toHaveBeenCalledWith(
      'billing:subscriptionTransactions',
      'sale_recorded_without_attribution',
      expect.objectContaining({ movementType: 'sale', eventType: 'INITIAL_PURCHASE' }),
    );
  });

  it('records an organic renewal with no coupon as unresolved instead of dropping it', async () => {
    firestore.state.currentRedemption = null;
    const result = await persistAttributedFinancialTransaction('uid-organic', { ...paid, type: 'RENEWAL' });
    expect(result).toBe('recorded');
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      movementType: 'sale',
      attributionStatus: 'unresolved',
      couponCode: null,
    });
    expect(logger.logInfo).toHaveBeenCalledOnce();
  });

  it('does not log sale_recorded_without_attribution for an attributed sale', async () => {
    await expect(persistAttributedFinancialTransaction('uid-1', paid)).resolves.toBe('recorded');
    expect(firestore.create.mock.calls[0][1]).toMatchObject({ attributionStatus: 'resolved' });
    expect(logger.logInfo).not.toHaveBeenCalled();
  });

  it('does not persist a movement for a trial purchase or a PRODUCT_CHANGE event', async () => {
    firestore.state.currentRedemption = null;
    await expect(persistAttributedFinancialTransaction('uid-organic', { ...paid, period_type: 'TRIAL' }))
      .resolves.toBe('not_paid_event');
    await expect(persistAttributedFinancialTransaction('uid-organic', { ...paid, type: 'PRODUCT_CHANGE' }))
      .resolves.toBe('not_paid_event');
    expect(firestore.create).not.toHaveBeenCalled();
  });

  it('does not duplicate an organic sale on webhook retry', async () => {
    firestore.state.currentRedemption = null;
    await expect(persistAttributedFinancialTransaction('uid-organic', paid)).resolves.toBe('recorded');
    await expect(persistAttributedFinancialTransaction('uid-organic', paid)).resolves.toBe('duplicate');
    expect(firestore.create).toHaveBeenCalledOnce();
  });

  it('records an incomplete attributed renewal with explicit nulls', async () => {
    const result = await persistAttributedFinancialTransaction('uid-1', {
      ...paid,
      type: 'RENEWAL',
      currency: undefined,
      price_in_purchased_currency: undefined,
      tax_percentage: undefined,
      commission_percentage: undefined,
    });
    expect(result).toBe('recorded');
    expect(firestore.create).toHaveBeenCalledOnce();
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      movementType: 'sale',
      attributionStatus: 'resolved',
      couponCode: 'AJ10',
      currency: null,
      grossRevenue: null,
      estimatedProceeds: null,
    });
  });

  it('returns duplicate on retry of the same event without a second create', async () => {
    await expect(persistAttributedFinancialTransaction('uid-1', paid)).resolves.toBe('recorded');
    await expect(persistAttributedFinancialTransaction('uid-1', paid)).resolves.toBe('duplicate');
    expect(firestore.create).toHaveBeenCalledOnce();
  });

  it('deduplicates a refund retry by RevenueCat event id', async () => {
    const refund = {
      ...paid,
      id: 'refund-retry-event',
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price: -40,
      price_in_purchased_currency: -199.9,
    };
    await expect(persistAttributedFinancialTransaction('uid-1', refund)).resolves.toBe('recorded');
    await expect(persistAttributedFinancialTransaction('uid-1', refund)).resolves.toBe('duplicate');
    expect(firestore.create).toHaveBeenCalledOnce();
  });

  it('keeps refund and reversal as separate append-only movements', async () => {
    const refund = { ...paid, id: 'adjustment-1', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', price: -40, price_in_purchased_currency: -199.9 };
    const reversal = { ...paid, id: 'adjustment-2', type: 'REFUND_REVERSED' };
    await expect(persistAttributedFinancialTransaction('uid-1', refund)).resolves.toBe('recorded');
    await expect(persistAttributedFinancialTransaction('uid-1', reversal)).resolves.toBe('recorded');
    expect(firestore.create).toHaveBeenCalledTimes(2);
    expect(firestore.create.mock.calls[0][0].id).not.toBe(firestore.create.mock.calls[1][0].id);
  });

  it('copies refund attribution directly from the matching redemption', async () => {
    await expect(persistAttributedFinancialTransaction('uid-1', {
      ...paid,
      id: 'refund-direct-attribution',
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price: -40,
      price_in_purchased_currency: -199.9,
    })).resolves.toBe('recorded');
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      attributionStatus: 'resolved',
      attributionUid: 'uid-1',
      couponCode: 'AJ10',
      influencerId: 'influencer-1',
      campaignId: 'campaign-1',
    });
  });

  it('resolves a refund from the deterministic original sale when redemption lookup misses', async () => {
    firestore.state.currentRedemption = null;
    const saleId = saleTransactionDocumentId('APP_STORE', 'tx');
    firestore.state.saleDocuments.set(saleId, {
      attributionUid: 'uid-original',
      couponCode: 'AJ10',
      influencerId: 'influencer-1',
      campaignId: 'campaign-1',
    });
    const result = await persistAttributedFinancialTransaction('uid-current', {
      ...paid,
      id: 'refund-event',
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price: -40,
      price_in_purchased_currency: -199.9,
    });
    expect(result).toBe('recorded');
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      movementType: 'refund',
      attributionStatus: 'resolved',
      attributionUid: 'uid-original',
      relatedSaleDocumentId: saleId,
    });
  });

  it('preserves an out-of-order refund with unresolved null attribution', async () => {
    firestore.state.currentRedemption = null;
    const result = await persistAttributedFinancialTransaction('uid-current', {
      ...paid,
      id: 'out-of-order-refund-event',
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      price: -40,
      price_in_purchased_currency: -199.9,
    });
    expect(result).toBe('recorded');
    expect(firestore.create.mock.calls[0][1]).toMatchObject({
      movementType: 'refund',
      attributionStatus: 'unresolved',
      attributionUid: null,
      couponCode: null,
      influencerId: null,
      campaignId: null,
    });
  });
});
