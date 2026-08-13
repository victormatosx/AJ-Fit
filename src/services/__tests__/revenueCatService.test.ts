import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const mockPlatform: { OS: string } = { OS: 'ios' };

vi.mock('react-native', () => ({ Platform: mockPlatform }));

const purchasesMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  setLogLevel: vi.fn().mockResolvedValue(undefined),
  checkTrialOrIntroductoryPriceEligibility: vi.fn(),
  purchaseSubscriptionOption: vi.fn(),
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
  INTRO_ELIGIBILITY_STATUS: {
    INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
    INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
    INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
    INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
  },
}));

process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'test-ios-key';
process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY = 'test-android-key';

const { checkIOSIntroEligibility, purchaseSubscriptionOption } = await import(
  '../revenueCatService'
);

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
