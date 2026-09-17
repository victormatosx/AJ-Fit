import { PURCHASES_ERROR_CODE, type PurchasesError } from 'react-native-purchases';

/** Closed, provider-independent issues that subscription UI is allowed to render. */
export type SubscriptionPurchaseIssue =
  | 'identityPending'
  | 'cancelled'
  | 'network'
  | 'linkedToAnotherAccount'
  | 'alreadyOwned'
  | 'pending'
  | 'notAllowed'
  | 'productUnavailable'
  | 'generic';

function providerCode(error: unknown): PURCHASES_ERROR_CODE | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as PurchasesError).code
    : undefined;
}

/**
 * Converts store/SDK failures into a deliberately small product taxonomy.
 * Raw provider messages never cross this boundary.
 */
export function subscriptionPurchaseIssue(error: unknown): SubscriptionPurchaseIssue {
  const code = providerCode(error);
  if (!code) return 'generic';
  switch (code) {
    case PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR:
      return 'cancelled';
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
    case PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR:
      return 'network';
    case PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR:
    case PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR:
      return 'linkedToAnotherAccount';
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      return 'alreadyOwned';
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
    case PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR:
      return 'pending';
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
    case PURCHASES_ERROR_CODE.INSUFFICIENT_PERMISSIONS_ERROR:
      return 'notAllowed';
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
    case PURCHASES_ERROR_CODE.CONFIGURATION_ERROR:
      return 'productUnavailable';
    default:
      return 'generic';
  }
}

export function isSubscriptionNetworkIssue(issue: SubscriptionPurchaseIssue): boolean {
  return issue === 'network';
}
