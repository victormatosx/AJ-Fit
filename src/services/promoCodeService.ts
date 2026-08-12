import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { classifyPromoCodeError, type PromoCodeFailure } from '../lib/promoCodeErrors';
import type {
  PromoCodeAndroidStoreConfig,
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
  platform: 'ANDROID';
}

interface ApplePromoCodePlatformStoreConfig {
  offerCodeMonthly: string | null;
  offerCodeAnnual: string | null;
}

export interface ValidatePromoCodeResponse {
  valid: true;
  code: string;
  benefit: PromoCodeBenefit;
  storeConfig: {
    android: PromoCodeAndroidStoreConfig | null;
    ios: ApplePromoCodePlatformStoreConfig | null;
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
 * `code` — always `platform: 'ANDROID'` (this phase is Android-only, per
 * scope). Never sends a uid: the callable is authenticated via the Firebase
 * ID token attached automatically by the Functions SDK; `request.auth.uid`
 * server-side is the only identity ever used (docs §8, Fase 4C.2 §5).
 */
export async function validatePromoCode(code: string): Promise<ValidatePromoCodeOutcome> {
  try {
    const result = await validatePromoCodeCallable({ code, platform: 'ANDROID' });
    return { status: 'applied', response: result.data };
  } catch (err) {
    logPromoCodeError('validate', err);
    const failure = classifyPromoCodeError(err);
    return { status: 'failed', ...failure };
  }
}
