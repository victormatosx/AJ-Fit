import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const mockPlatform: { OS: string } = { OS: 'ios' };

vi.mock('react-native', () => ({ Platform: mockPlatform }));

const purchasesMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  setLogLevel: vi.fn().mockResolvedValue(undefined),
  isAnonymous: vi.fn(),
  logOut: vi.fn(),
  logIn: vi.fn(),
  checkTrialOrIntroductoryPriceEligibility: vi.fn(),
  purchaseSubscriptionOption: vi.fn(),
}));

vi.mock('react-native-purchases', () => ({
  default: purchasesMocks,
  LOG_LEVEL: { DEBUG: 'DEBUG', WARN: 'WARN', ERROR: 'ERROR' },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: 'PURCHASE_CANCELLED_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    OFFLINE_CONNECTION_ERROR: 'OFFLINE_CONNECTION_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
    INVALID_APP_USER_ID_ERROR: 'INVALID_APP_USER_ID_ERROR',
    LOG_OUT_ANONYMOUS_USER_ERROR: 'LOG_OUT_ANONYMOUS_USER_ERROR',
  },
  INTRO_ELIGIBILITY_STATUS: {
    INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
    INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
    INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
    INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
  },
}));

process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'test-ios-key';
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY = 'test-android-key';

const {
  checkIOSIntroEligibility,
  loginRevenueCat,
  logoutRevenueCat,
  purchaseSubscriptionOption,
  revenueCatLogLevel,
} = await import('../revenueCatService');

describe('RevenueCat identity cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.OS = 'ios';
  });

  it('does not call logOut when Firebase is signed out and RevenueCat is already anonymous', async () => {
    purchasesMocks.isAnonymous.mockResolvedValue(true);

    await expect(logoutRevenueCat()).resolves.toBeUndefined();

    expect(purchasesMocks.isAnonymous).toHaveBeenCalledOnce();
    expect(purchasesMocks.logOut).not.toHaveBeenCalled();
  });

  it('allows the next authenticated Firebase UID to log in after the anonymous no-op', async () => {
    purchasesMocks.isAnonymous.mockResolvedValue(true);
    purchasesMocks.logIn.mockResolvedValue({
      customerInfo: {
        originalAppUserId: 'firebase-user-a',
        requestDate: '2026-08-13T12:00:00Z',
        entitlements: { active: {}, all: {} },
      },
    });

    await logoutRevenueCat();
    await loginRevenueCat('firebase-user-a');

    expect(purchasesMocks.logOut).not.toHaveBeenCalled();
    expect(purchasesMocks.logIn).toHaveBeenCalledWith('firebase-user-a');
  });

  it('still logs out an identified RevenueCat user', async () => {
    purchasesMocks.isAnonymous.mockResolvedValue(false);
    purchasesMocks.logOut.mockResolvedValue({});

    await expect(logoutRevenueCat()).resolves.toBeUndefined();

    expect(purchasesMocks.isAnonymous).toHaveBeenCalledOnce();
    expect(purchasesMocks.logOut).toHaveBeenCalledOnce();
  });

  it('keeps an account switch ordered: clears the identified user before logging in the next Firebase UID', async () => {
    purchasesMocks.isAnonymous.mockResolvedValue(false);
    purchasesMocks.logOut.mockResolvedValue({});
    purchasesMocks.logIn.mockResolvedValue({
      customerInfo: {
        originalAppUserId: 'firebase-user-b',
        requestDate: '2026-08-13T12:00:00Z',
        entitlements: { active: {}, all: {} },
      },
    });

    await logoutRevenueCat();
    await loginRevenueCat('firebase-user-b');

    expect(purchasesMocks.logOut).toHaveBeenCalledOnce();
    expect(purchasesMocks.logIn).toHaveBeenCalledOnce();
    expect(purchasesMocks.logIn).toHaveBeenCalledWith('firebase-user-b');
    expect(purchasesMocks.logOut.mock.invocationCallOrder[0]).toBeLessThan(
      purchasesMocks.logIn.mock.invocationCallOrder[0],
    );
  });

  it('forwards a direct identified-account switch to RevenueCat in UID order', async () => {
    purchasesMocks.logIn
      .mockResolvedValueOnce({
        customerInfo: {
          originalAppUserId: 'firebase-user-a',
          requestDate: '2026-08-13T12:00:00Z',
          entitlements: { active: {}, all: {} },
        },
      })
      .mockResolvedValueOnce({
        customerInfo: {
          originalAppUserId: 'firebase-user-b',
          requestDate: '2026-08-13T12:01:00Z',
          entitlements: { active: {}, all: {} },
        },
      });

    await loginRevenueCat('firebase-user-a');
    await loginRevenueCat('firebase-user-b');

    expect(purchasesMocks.logIn.mock.calls).toEqual([
      ['firebase-user-a'],
      ['firebase-user-b'],
    ]);
    expect(purchasesMocks.logOut).not.toHaveBeenCalled();
  });
});

describe('RevenueCat logging policy', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_DEBUG_LOGS;
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  });

  it('keeps production at WARN so warnings and errors remain observable', () => {
    expect(revenueCatLogLevel()).toBe('WARN');
  });

  it('requires an explicit development opt-in for DEBUG', () => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
    expect(revenueCatLogLevel()).toBe('WARN');
    process.env.EXPO_PUBLIC_REVENUECAT_DEBUG_LOGS = '1';
    expect(revenueCatLogLevel()).toBe('DEBUG');
  });
});

describe('checkIOSIntroEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.OS = 'ios';
  });

  it('preserves every installed SDK eligibility state per product', async () => {
    purchasesMocks.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      eligible: { status: 2 },
      ineligible: { status: 1 },
      none: { status: 3 },
      unknown: { status: 0 },
    });

    await expect(
      checkIOSIntroEligibility(['eligible', 'ineligible', 'none', 'unknown', 'missing']),
    ).resolves.toEqual({
      eligible: { status: 'eligible' },
      ineligible: { status: 'ineligible' },
      none: { status: 'no_intro_offer' },
      unknown: { status: 'unknown' },
      missing: { status: 'unknown' },
    });
  });

  it('never invokes the iOS API on Android', async () => {
    mockPlatform.OS = 'android';

    await expect(checkIOSIntroEligibility(['product'])).resolves.toEqual({
      product: { status: 'unknown' },
    });
    expect(purchasesMocks.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
  });
});

describe('purchaseSubscriptionOption — Android promotional purchase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.OS = 'android';
  });

  it('passes the exact resolved SubscriptionOption to RevenueCat without accepting a client-authored token', async () => {
    const option = {
      id: 'monthly:influencer-trial-7d',
      productId: 'ajfit_premium',
      storeProductId: 'ajfit_premium:monthly',
    } as never;
    const customerInfo = { entitlements: { active: {}, all: {} } } as never;
    purchasesMocks.purchaseSubscriptionOption.mockResolvedValue({ customerInfo });

    await expect(purchaseSubscriptionOption(option)).resolves.toEqual({
      status: 'purchased',
      customerInfo,
    });
    expect(purchasesMocks.purchaseSubscriptionOption).toHaveBeenCalledOnce();
    expect(purchasesMocks.purchaseSubscriptionOption).toHaveBeenCalledWith(option);
  });
});
