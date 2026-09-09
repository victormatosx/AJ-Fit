import { describe, expect, it } from 'vitest';

import { aggregateDeliveryStatuses } from '../dispatchAggregation';

describe('dispatch aggregation', () => {
  it.each([
    [['PENDING_RECEIPT'], 'PENDING_RECEIPTS'],
    [['RECEIPT_CONFIRMED'], 'CONFIRMED'],
    [['RECEIPT_CONFIRMED', 'FAILED_TERMINAL'], 'PARTIAL'],
    [['FAILED_TERMINAL', 'INVALID_TOKEN'], 'FAILED_TERMINAL'],
    [['FAILED_RETRYABLE', 'RECEIPT_CONFIRMED'], 'RETRY_SCHEDULED'],
    [['FAILED_RETRY_EXHAUSTED'], 'FAILED_RETRY_EXHAUSTED'],
    [['RECEIPT_EXHAUSTED'], 'RECEIPT_EXHAUSTED'],
    [['RECEIPT_EXHAUSTED', 'FAILED_TERMINAL'], 'RECEIPT_EXHAUSTED'],
  ] as const)('aggregates %j as %s', (statuses, expected) => {
    expect(aggregateDeliveryStatuses(statuses).status).toBe(expected);
  });

  it('keeps accepted/pending/failure counters distinct', () => {
    expect(aggregateDeliveryStatuses([
      'RECEIPT_CONFIRMED',
      'PENDING_RECEIPT',
      'INVALID_TOKEN',
      'RECEIPT_EXHAUSTED',
    ])).toMatchObject({
      deviceCount: 4,
      acceptedCount: 3,
      confirmedCount: 1,
      pendingReceiptCount: 1,
      failedCount: 1,
      invalidTokenCount: 1,
      receiptExhaustedCount: 1,
    });
  });
});
