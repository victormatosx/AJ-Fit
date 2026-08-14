/**
 * FASE iOS-2 — pure mapping from the running React Native `Platform.OS`
 * value to the wire value `validatePromoCode` expects, per
 * `functions/src/attribution/constants.ts`'s `PROMO_CODE_PLATFORMS`
 * allowlist. Lives here (not in `promoCodeService.ts`) so it stays
 * unit-testable without Firebase/React Native involved, same rationale
 * `promoCodeErrors.ts`'s doc comment already documents for error
 * classification — this module has zero runtime dependency on either.
 *
 * Deliberately fail-closed: any value other than `'android'`/`'ios'` (e.g.
 * `'web'`, a future RN target) throws instead of silently defaulting to
 * either platform — an unrecognized platform must never be sent to the
 * backend as if it were Android or iOS.
 */

export type PromoCodePlatform = 'ANDROID' | 'IOS';

export function resolvePromoCodePlatform(osName: string): PromoCodePlatform {
  if (osName === 'android') return 'ANDROID';
  if (osName === 'ios') return 'IOS';
  throw new Error(`[promoCode] unsupported platform for validatePromoCode: "${osName}"`);
}

/**
 * FASE 6 — whether the promo-code UI itself should render at all.
 * `PaywallScreen.tsx`'s `PROMO_CODE_SUPPORTED_PLATFORM` derives from this
 * instead of an inline `Platform.OS === 'android'` check. iOS remains
 * supported because the production promo flow validates a backend-authored
 * `iosPromotion` and buys the exact promotional SKU. Every other RN platform
 * (`'web'`, future targets)
 * stays unsupported — same fail-closed reasoning as
 * `resolvePromoCodePlatform`, deliberately NOT the same function: a platform
 * can in principle be a valid wire value for `validatePromoCode` without the
 * client having a working promotional purchase UI for it yet.
 */
export function isPromoCodeUiSupported(osName: string): boolean {
  return osName === 'android' || osName === 'ios';
}
