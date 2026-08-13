import { Platform } from 'react-native';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { classifyPromoCodeError, type PromoCodeFailure } from '../lib/promoCodeErrors';
import { resolvePromoCodePlatform, type PromoCodePlatform } from '../lib/promoCodePlatform';
import type {
  IOSPromotionAuthorization,
  PromoCodeAndroidStoreConfig,
  PromoCodeAppleStoreConfig,
  PromoCodeBenefit,
} from '../lib/promoCodeState';
import { parseIOSPromotionAuthorization } from '../lib/promoCodeState';
import {
  classifyPromoPurchaseAuthorizationError,
  parsePromoPurchaseIntentAuthorization,
  type PromoPurchaseAuthorizationOutcome,
} from '../lib/iosPromoPurchase';
import type { IOSSubscriptionPlan } from '../lib/subscriptionOffer';

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
  /** Backend-authored iOS Offering/SKU authorization; null means the campaign has no new iOS route. */
  iosPromotion: IOSPromotionAuthorization | null;
  eligibility: {
    determinedBy: 'store';
    guaranteed: false;
    disclaimer: string;
  };
}

type ValidatePromoCodeWireResponse = Omit<ValidatePromoCodeResponse, 'iosPromotion'> & {
  /** Untrusted until parsed at the callable boundary. */
  iosPromotion: unknown;
};

export type ValidatePromoCodeOutcome =
  | { status: 'applied'; response: ValidatePromoCodeResponse }
  | ({ status: 'failed' } & PromoCodeFailure);

const validatePromoCodeCallable = httpsCallable<
  ValidatePromoCodeRequest,
  ValidatePromoCodeWireResponse
>(functions, 'validatePromoCode');

const authorizePromoPurchaseCallable = httpsCallable<
  { plan: IOSSubscriptionPlan },
  unknown
>(functions, 'authorizePromoPurchase');

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
 * TEMP DIAGNOSTIC LOGGING — investigação do erro `functions/internal` no iOS
 * (não altera comportamento; remover após a causa raiz ser confirmada).
 * Nunca loga: token, credencial de auth, receipt, CustomerInfo, email, uid
 * completo, código do cupom completo.
 */
function logPromoCodeDiagnostic(stage: string, payload: Record<string, unknown>): void {
  console.log(`[promoCode:diag:${stage}]`, payload);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function truncatedStack(err: unknown): string | undefined {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (!isDev) return undefined;
  const stack = err instanceof Error ? err.stack : undefined;
  if (!stack) return undefined;
  return stack.slice(0, 500);
}

/**
 * Sanitized snapshot of a raw, unclassified error thrown by the
 * `validatePromoCode` callable — logged BEFORE `classifyPromoCodeError`
 * collapses it into a generic reason, so we can see exactly what the SDK
 * handed us (type, constructor, FirebaseError-ness, `customData`) without
 * that information being lost.
 */
function logPromoCodeRawError(err: unknown): void {
  const isFirebaseError = err instanceof FirebaseError;
  const hasCustomData =
    typeof err === 'object' && err !== null && 'customData' in err;
  const rawDetails =
    typeof err === 'object' && err !== null && 'details' in err
      ? (err as { details: unknown }).details
      : undefined;

  logPromoCodeDiagnostic('raw_error', {
    typeofError: typeof err,
    constructorName:
      typeof err === 'object' && err !== null
        ? Object.getPrototypeOf(err)?.constructor?.name
        : undefined,
    isFirebaseError,
    hasCustomData,
    code:
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : undefined,
    message:
      typeof err === 'object' && err !== null && 'message' in err
        ? sanitizedErrorMessage(err)
        : undefined,
    details: isPrimitive(rawDetails) ? rawDetails : rawDetails !== undefined ? '[non-primitive]' : undefined,
    stack: truncatedStack(err),
  });
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
    logPromoCodeDiagnostic('request', {
      platform,
      functionName: 'validatePromoCode',
      codeLength: code.length,
      normalizedCodePresent: code.length > 0,
    });
    const result = await validatePromoCodeCallable({ code, platform });
    const parsedIOSPromotion = parseIOSPromotionAuthorization(result.data?.iosPromotion);
    if (platform === 'IOS' && parsedIOSPromotion.status === 'invalid') {
      // Symbolic diagnostic only: no coupon, uid, Offering identifier, SKU,
      // or raw callable payload is emitted.
      console.warn('[promoCode] promo_authorization_invalid');
      throw new Error('promo_authorization_invalid');
    }
    logPromoCodeDiagnostic('response', {
      valid: result.data?.valid ?? null,
      codePresent: typeof result.data?.code === 'string',
      benefitPresent: result.data?.benefit != null,
      androidConfigPresent: result.data?.storeConfig?.android != null,
      iosConfigPresent: result.data?.storeConfig?.ios != null,
      iosPromotionStatus: parsedIOSPromotion.status,
      eligibilityPresent: result.data?.eligibility != null,
    });
    return {
      status: 'applied',
      response: {
        ...result.data,
        iosPromotion:
          parsedIOSPromotion.status === 'valid'
            ? parsedIOSPromotion.authorization
            : null,
      },
    };
  } catch (err) {
    logPromoCodeError('validate', err);
    logPromoCodeRawError(err);
    const failure = classifyPromoCodeError(err);
    logPromoCodeDiagnostic('classified', {
      reason: failure.reason,
      messageKey: failure.message,
    });
    return { status: 'failed', ...failure };
  }
}

/** Late purchase authorization. The wire request intentionally contains only `plan`. */
export async function authorizePromoPurchase(
  plan: IOSSubscriptionPlan,
): Promise<PromoPurchaseAuthorizationOutcome> {
  try {
    const result = await authorizePromoPurchaseCallable({ plan });
    const response = parsePromoPurchaseIntentAuthorization(result.data);
    if (!response) {
      console.warn('[promoCode] promo_purchase_intent_mismatch');
      return { status: 'failed', reason: 'invalid_response' };
    }
    console.info('[promoCode] promo_purchase_authorized');
    return { status: 'authorized', response };
  } catch (err) {
    const reason = classifyPromoPurchaseAuthorizationError(err);
    // Expected callable denials are logged symbolically; never emit the
    // response payload, UID, coupon, Offering, product or Firebase token.
    console.warn('[promoCode] promo_purchase_authorization_failed', { reason });
    return { status: 'failed', reason };
  }
}
