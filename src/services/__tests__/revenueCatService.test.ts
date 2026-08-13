import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Service-level tests for `redeemOfferCode` — proves the fix to the
 * comproved bug (premature `getCustomerInfo()` right after
 * `presentCodeRedemptionSheet()`'s fire-and-forget Promise resolves; see
 * that function's doc comment in `revenueCatService.ts`). Mocks the whole
 * `react-native-purchases`/`react-native` boundary, same convention as
 * `src/services/__tests__/promoCodeService.test.ts`.
 */

// `__DEV__` is a Metro/React Native bundle-time global (see
// `configureRevenueCat`'s doc comment in `revenueCatService.ts`) — absent
// under Vitest's plain Node environment, so it must be defined here before
// `ensureConfigured()` ever runs, same as `promoCodeService.test.ts` needing
// no equivalent because it never exercises this call path.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const mockPlatform: { OS: string } = { OS: 'ios' };
const mockAppState = {
  currentState: 'active',
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
};

vi.mock('react-native', () => ({
  Platform: mockPlatform,
  AppState: mockAppState,
}));

const purchasesMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  setLogLevel: vi.fn().mockResolvedValue(undefined),
  presentCodeRedemptionSheet: vi.fn().mockResolvedValue(undefined),
  getCustomerInfo: vi.fn(),
  addCustomerInfoUpdateListener: vi.fn(),
  removeCustomerInfoUpdateListener: vi.fn(),
}));

vi.mock('react-native-purchases', () => ({
  default: purchasesMocks,
  LOG_LEVEL: { DEBUG: 'DEBUG', ERROR: 'ERROR' },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: 'PURCHASE_CANCELLED_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    OFFLINE_CONNECTION_ERROR: 'OFFLINE_CONNECTION_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
    INVALID_APP_USER_ID_ERROR: 'INVALID_APP_USER_ID_ERROR',
    LOG_OUT_ANONYMOUS_USER_ERROR: 'LOG_OUT_ANONYMOUS_USER_ERROR',
  },
}));

process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'test-ios-key';

const { redeemOfferCode, PREMIUM_ENTITLEMENT_ID } = await import('../revenueCatService');

function customerInfoWithPremium(active: boolean) {
  return {
    entitlements: {
      active: active ? { [PREMIUM_ENTITLEMENT_ID]: {} } : {},
    },
  } as never;
}

describe('redeemOfferCode — listener-driven confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.OS = 'ios';
    purchasesMocks.presentCodeRedemptionSheet.mockResolvedValue(undefined);
  });

  it('1: calls Purchases.presentCodeRedemptionSheet() exactly once', async () => {
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (info: unknown) => void) => {
      cb(customerInfoWithPremium(true));
    });

    await redeemOfferCode();

    expect(purchasesMocks.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
  });

  it('2: does NOT call getCustomerInfo as the immediate next action — a listener update short-circuits it entirely', async () => {
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (info: unknown) => void) => {
      cb(customerInfoWithPremium(true));
    });

    await redeemOfferCode();

    expect(purchasesMocks.getCustomerInfo).not.toHaveBeenCalled();
  });

  it('3: a listener update with premium active → outcome carries that CustomerInfo (classifyPurchaseResult decides premium elsewhere)', async () => {
    const info = customerInfoWithPremium(true);
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (i: unknown) => void) => cb(info));

    const outcome = await redeemOfferCode();

    expect(outcome).toEqual({ status: 'purchased', customerInfo: info });
  });

  it('4: a listener update WITHOUT premium active → still just carries that CustomerInfo, never fabricates premium', async () => {
    const info = customerInfoWithPremium(false);
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (i: unknown) => void) => cb(info));

    const outcome = await redeemOfferCode();

    expect(outcome).toEqual({ status: 'purchased', customerInfo: info });
    if (outcome.status !== 'purchased') throw new Error('expected a purchased outcome');
    expect(outcome.customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]).toBeUndefined();
  });

  it('9: the temporary listener is removed after a successful listener update', async () => {
    let captured: ((info: unknown) => void) | null = null;
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (info: unknown) => void) => {
      captured = cb;
      cb(customerInfoWithPremium(true));
    });

    await redeemOfferCode();

    expect(purchasesMocks.removeCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(purchasesMocks.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(captured);
  });

  it('11: presentCodeRedemptionSheet rejecting with a cancellation error → { status: "cancelled" }, fail-closed', async () => {
    const err = Object.assign(new Error('cancelled'), { code: 'PURCHASE_CANCELLED_ERROR' });
    purchasesMocks.presentCodeRedemptionSheet.mockRejectedValue(err);

    const outcome = await redeemOfferCode();

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(purchasesMocks.getCustomerInfo).not.toHaveBeenCalled();
  });

  it('11: presentCodeRedemptionSheet rejecting with a generic error → { status: "error" }, fail-closed', async () => {
    purchasesMocks.presentCodeRedemptionSheet.mockRejectedValue(new Error('boom'));

    const outcome = await redeemOfferCode();

    expect(outcome.status).toBe('error');
  });
});

describe('redeemOfferCode — timeout fallback (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPlatform.OS = 'ios';
    purchasesMocks.presentCodeRedemptionSheet.mockResolvedValue(undefined);
    // No listener callback ever invoked in this block — simulates "Apple never pushed an update".
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('6/7: after the wait timeout, performs exactly one final getCustomerInfo() — premium active → purchased', async () => {
    purchasesMocks.getCustomerInfo.mockResolvedValue(customerInfoWithPremium(true));

    const promise = redeemOfferCode();
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await promise;

    expect(purchasesMocks.getCustomerInfo).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'purchased', customerInfo: customerInfoWithPremium(true) });
  });

  it('8: final refresh without premium → outcome still carries that CustomerInfo (missing-entitlement is classifyPurchaseResult\'s job)', async () => {
    purchasesMocks.getCustomerInfo.mockResolvedValue(customerInfoWithPremium(false));

    const promise = redeemOfferCode();
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'purchased', customerInfo: customerInfoWithPremium(false) });
  });

  it('10: the temporary listener is removed once the timeout fires, before the final refresh', async () => {
    let captured: ((info: unknown) => void) | null = null;
    purchasesMocks.addCustomerInfoUpdateListener.mockImplementation((cb: (info: unknown) => void) => {
      captured = cb;
    });
    purchasesMocks.getCustomerInfo.mockResolvedValue(customerInfoWithPremium(false));

    const promise = redeemOfferCode();
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(purchasesMocks.removeCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(purchasesMocks.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(captured);
  });

  it('12: an error in the final refresh never grants Premium — surfaced as a fail-closed error outcome', async () => {
    purchasesMocks.getCustomerInfo.mockRejectedValue(new Error('network down'));

    const promise = redeemOfferCode();
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await promise;

    expect(outcome.status).toBe('error');
  });
});

// Item 13 ("Android não usa esse fluxo") is a STRUCTURAL guarantee, not
// re-tested here: `redeemOfferCode`/`redeemAppleOfferCode` is only ever
// invoked from `PaywallScreen.tsx`'s `appleRoute` branch, which is itself
// gated `Platform.OS !== 'ios' → null` — already proven by
// `subscriptionOfferMatching.test.ts`'s "Android is structurally
// unaffected by Apple-only routing" suite. `redeemOfferCode` has no
// `Platform.OS` branch of its own because Android never calls it at all.
