import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { classifyPromoCodeError, type PromoCodeFailure } from '../lib/promoCodeErrors';
import { resolvePromoCodePlatform, type PromoCodePlatform } from '../lib/promoCodePlatform';
import type {
  PromoCodeAndroidStoreConfig,
  PromoCodeAppleStoreConfig,
  PromoCodeBenefit,
} from '../lib/promoCodeState';

/**
 * Client for the `validatePromoCode` Cloud Function (Fase 4C.2). Mirrors the
 * shape of `src/services/revenueCatService.ts`: plain functions talking
 * directly to the SDK, no class, no repository. Kept deliberately thin —
 * every piece of logic that can be unit-tested without Firebase (error
 * classification, request shape) lives in `src/lib/promoCodeErrors.ts`
 * instead, mirroring why `src/lib/subscriptionLifecycle.ts` has no
 * RevenueCat/Firebase import while `revenueCatService.ts` does.
 *
 * Types below mirror `functions/src/attribution/types.ts`
 * (`ValidatePromoCodeRequestData`/`ValidatePromoCodeResponseData`) —
 * duplicated deliberately, same rationale already documented for
 * `PREMIUM_ENTITLEMENT_ID` in `functions/src/billing/constants.ts`:
 * `functions/` and the Expo app are two separate deployables with no shared
 * package. Keep in sync manually if the backend contract changes (Fase
 * 4C.1 introduced the current nested `storeConfig.android.{monthly,annual}`
 * shape).
 */

interface ValidatePromoCodeRequest {
  code: string;
  platform: PromoCodePlatform;
}

export interface ValidatePromoCodeResponse {
  valid: true;
  code: string;
  benefit: PromoCodeBenefit;
  storeConfig: {
    android: PromoCodeAndroidStoreConfig | null;
    ios: PromoCodeAppleStoreConfig | null;
  };
  eligibility: {
    determinedBy: 'store';
    guaranteed: false;
    disclaimer: string;
  };
}

export type ValidatePromoCodeOutcome =
  | { status: 'applied'; response: ValidatePromoCodeResponse }
  | ({ status: 'failed' } & PromoCodeFailure);

const validatePromoCodeCallable = httpsCallable<
  ValidatePromoCodeRequest,
  ValidatePromoCodeResponse
>(functions, 'validatePromoCode');

function sanitizedErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, 240);
}

export function logPromoCodeError(scope: string, err: unknown): void {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : undefined;
  console.error(`[promoCode:${scope}]`, { code, message: sanitizedErrorMessage(err) });
}

/**
 * FASE iOS-2 — `platform` is now derived from the real `Platform.OS` via
 * `resolvePromoCodePlatform` (src/lib/promoCodePlatform.ts) instead of an
 * Android-only hardcode; Android's request shape/behavior is unchanged
 * (`Platform.OS === 'android'` still resolves to the same `'ANDROID'`
 * literal sent before). `resolvePromoCodePlatform` throwing (unsupported
 * platform) is caught below like any other failure and classified as
 * `'temporary'` by `classifyPromoCodeError` — never silently sent as
 * `'ANDROID'`/`'IOS'` on a guess. Never sends a uid: the callable is
 * authenticated via the Firebase ID token attached automatically by the
 * Functions SDK; `request.auth.uid` server-side is the only identity ever
 * used (docs §8, Fase 4C.2 §5).
 */
export async function validatePromoCode(code: string): Promise<ValidatePromoCodeOutcome> {
  try {
    const platform = resolvePromoCodePlatform(Platform.OS);
    const result = await validatePromoCodeCallable({ code, platform });
    return { status: 'applied', response: result.data };
  } catch (err) {
    logPromoCodeError('validate', err);
    const failure = classifyPromoCodeError(err);
    return { status: 'failed', ...failure };
  }
}
