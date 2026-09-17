import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-purchases', () => ({
  PURCHASES_ERROR_CODE: {
    NETWORK_ERROR: 'NETWORK_ERROR',
    OFFLINE_CONNECTION_ERROR: 'OFFLINE_CONNECTION_ERROR',
    PRODUCT_REQUEST_TIMED_OUT_ERROR: 'PRODUCT_REQUEST_TIMED_OUT_ERROR',
    RECEIPT_ALREADY_IN_USE_ERROR: 'RECEIPT_ALREADY_IN_USE_ERROR',
    RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: 'RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR',
    PRODUCT_ALREADY_PURCHASED_ERROR: 'PRODUCT_ALREADY_PURCHASED_ERROR',
    PAYMENT_PENDING_ERROR: 'PAYMENT_PENDING_ERROR',
    OPERATION_ALREADY_IN_PROGRESS_ERROR: 'OPERATION_ALREADY_IN_PROGRESS_ERROR',
    PURCHASE_NOT_ALLOWED_ERROR: 'PURCHASE_NOT_ALLOWED_ERROR',
    INSUFFICIENT_PERMISSIONS_ERROR: 'INSUFFICIENT_PERMISSIONS_ERROR',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: 'PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  },
}));

import { subscriptionPurchaseIssue } from '../revenueCatErrors';

describe('subscription purchase error taxonomy', () => {
  it.each([
    ['NETWORK_ERROR', 'network'],
    ['RECEIPT_ALREADY_IN_USE_ERROR', 'linkedToAnotherAccount'],
    ['PRODUCT_ALREADY_PURCHASED_ERROR', 'alreadyOwned'],
    ['PAYMENT_PENDING_ERROR', 'pending'],
    ['PURCHASE_NOT_ALLOWED_ERROR', 'notAllowed'],
    ['PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR', 'productUnavailable'],
  ])('maps %s to %s without exposing provider text', (code, issue) => {
    expect(subscriptionPurchaseIssue({ code, message: 'SDK internals' })).toBe(issue);
  });

  it('uses a safe generic fallback for unknown failures', () => {
    expect(subscriptionPurchaseIssue(new Error('provider implementation detail'))).toBe('generic');
  });
});
