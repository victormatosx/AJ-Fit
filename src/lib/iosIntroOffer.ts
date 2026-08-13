import type { PurchasesIntroPrice, PurchasesPackage } from 'react-native-purchases';

export type IOSIntroEligibilityState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'eligible' }
  | { status: 'ineligible' }
  | { status: 'unknown' }
  | { status: 'no_intro_offer' }
  | { status: 'error' };

export type IOSIntroDurationUnit = 'day' | 'week' | 'month' | 'year';

export interface IOSFreeTrialTerms {
  /** Derived from StoreProduct.introPrice; never from campaign/Offering/SKU names. */
  duration: { count: number; unit: IOSIntroDurationUnit };
  introductoryPrice: number;
  introductoryPriceString: string;
  renewalPriceString: string;
  renewalPeriod: string | null;
}

export type IOSIntroOfferPresentation =
  | { kind: 'neutral' }
  | { kind: 'checking' }
  | { kind: 'standard'; reason: 'ineligible' | 'unknown' | 'no_intro_offer' | 'error' }
  | { kind: 'free_trial'; terms: IOSFreeTrialTerms }
  | {
      kind: 'configuration_error';
      reason: 'intro_missing' | 'intro_not_free_trial' | 'intro_invalid';
    };

export type IOSPromoPurchaseReadiness =
  | { status: 'ready'; terms: 'free_trial' | 'regular_price' }
  | {
      status: 'blocked';
      reason: 'checking' | 'unknown' | 'error' | 'intro_configuration';
    };

function durationUnit(value: string): IOSIntroDurationUnit | null {
  switch (value.toUpperCase()) {
    case 'DAY':
      return 'day';
    case 'WEEK':
      return 'week';
    case 'MONTH':
      return 'month';
    case 'YEAR':
      return 'year';
    default:
      return null;
  }
}

function resolveFreeTrialTerms(
  pkg: PurchasesPackage,
  intro: PurchasesIntroPrice,
): IOSFreeTrialTerms | 'intro_not_free_trial' | 'intro_invalid' {
  // react-native-purchases@10.6.0's iOS bridge does not expose the native
  // paymentMode. A zero-valued StoreKit introductory price is the only
  // positive fact this JS surface exposes that can safely describe "free".
  if (!Number.isFinite(intro.price) || intro.price !== 0) return 'intro_not_free_trial';
  const unit = durationUnit(intro.periodUnit);
  const cycles = intro.cycles;
  const units = intro.periodNumberOfUnits;
  if (
    !unit ||
    !Number.isInteger(cycles) ||
    cycles <= 0 ||
    !Number.isInteger(units) ||
    units <= 0 ||
    typeof intro.priceString !== 'string' ||
    !intro.priceString ||
    typeof pkg.product.priceString !== 'string' ||
    !pkg.product.priceString
  ) {
    return 'intro_invalid';
  }

  return {
    duration: { count: cycles * units, unit },
    introductoryPrice: intro.price,
    introductoryPriceString: intro.priceString,
    renewalPriceString: pkg.product.priceString,
    renewalPeriod: pkg.product.subscriptionPeriod,
  };
}

/**
 * Pure UI policy. AJ Fit authorization never appears in this signature:
 * only the live StoreProduct intro data plus RevenueCat's Apple eligibility
 * result can produce `free_trial`.
 */
export function resolveIOSIntroOfferPresentation(
  pkg: PurchasesPackage,
  eligibility: IOSIntroEligibilityState,
): IOSIntroOfferPresentation {
  if (eligibility.status === 'idle') return { kind: 'neutral' };
  if (eligibility.status === 'checking') return { kind: 'checking' };

  const intro = pkg.product.introPrice;
  if (!intro) return { kind: 'configuration_error', reason: 'intro_missing' };
  const terms = resolveFreeTrialTerms(pkg, intro);
  if (typeof terms === 'string') return { kind: 'configuration_error', reason: terms };

  if (eligibility.status === 'eligible') return { kind: 'free_trial', terms };
  return { kind: 'standard', reason: eligibility.status };
}

/**
 * Store-safe purchase policy for the promotional SKU. An ineligible Apple
 * account can buy at the product's regular price; unknown/error cannot buy
 * because this UI cannot guarantee which terms Apple's sheet will apply.
 */
export function resolveIOSPromoPurchaseReadiness(
  presentation: IOSIntroOfferPresentation,
): IOSPromoPurchaseReadiness {
  if (presentation.kind === 'free_trial') {
    return { status: 'ready', terms: 'free_trial' };
  }
  if (presentation.kind === 'standard' && presentation.reason === 'ineligible') {
    return { status: 'ready', terms: 'regular_price' };
  }
  if (presentation.kind === 'checking' || presentation.kind === 'neutral') {
    return { status: 'blocked', reason: 'checking' };
  }
  if (presentation.kind === 'configuration_error' || presentation.reason === 'no_intro_offer') {
    return { status: 'blocked', reason: 'intro_configuration' };
  }
  return {
    status: 'blocked',
    reason: presentation.kind === 'standard' && presentation.reason === 'unknown'
      ? 'unknown'
      : 'error',
  };
}
