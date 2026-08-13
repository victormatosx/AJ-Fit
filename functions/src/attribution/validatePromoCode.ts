import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import { applyPromoCodeAttributionTransactionally } from './attributionSync';
import { PROMO_CODE_PLATFORMS, type PromoCodePlatform } from './constants';
import { isPromoCodeCurrentlyEligible } from './eligibility';
import { normalizePromoCode } from './normalize';
import {
  lookupPromoCode,
  resolveAndroidOfferPair,
  resolveAppleOfferCorrelationPair,
} from './promoCodeCatalog';
import type {
  IOSPromotionConfig,
  PromoCodeAndroidOfferSnapshot,
  PromoCodeAppleCorrelationSnapshot,
  PromoCodeAppleOfferSnapshot,
  ValidatePromoCodeRequestData,
  ValidatePromoCodeResponseData,
} from './types';

/**
 * `validatePromoCode` — callable (onCall) handler. Wired as a Cloud
 * Function in index.ts (kept out of this file, same convention as
 * `billing/revenuecat.ts`'s `handleRevenueCatWebhook`, so the handler stays
 * directly testable without invoking through the Functions runtime).
 *
 * FULL FLOW: auth → normalize code → catalog lookup (existence + eligibility
 * window, indistinguishable failure reasons) → transactional apply/swap of
 * the uid's pending attribution → minimal response contract (never a
 * granted trial/entitlement — see `ValidatePromoCodeResponseData`'s doc
 * comment in types.ts).
 *
 * App Check: intentionally NOT enforced yet (`enforceAppCheck` stays at its
 * default in index.ts's `onCall` options). This handler's signature and
 * request/response contract need zero change when App Check is turned on
 * later — `request.app` simply becomes populated/verified by the runtime
 * before this handler ever runs.
 */

const SCOPE = 'attribution:validatePromoCode';

function parseRequestedPlatform(value: unknown): PromoCodePlatform | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return 'invalid';
  return (PROMO_CODE_PLATFORMS as readonly string[]).includes(value)
    ? (value as PromoCodePlatform)
    : 'invalid';
}

export async function validatePromoCodeHandler(
  request: CallableRequest<ValidatePromoCodeRequestData>,
): Promise<ValidatePromoCodeResponseData> {
  // Exclusively `request.auth.uid` — never a uid/email from `request.data`.
  // onCall already verifies the Firebase ID token before this handler runs;
  // `request.auth` is unset only when no valid token was presented.
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'authentication_required');
  }
  const uid = request.auth.uid;

  const normalizedCode = normalizePromoCode(request.data?.code);
  if (normalizedCode === null) {
    throw new HttpsError('invalid-argument', 'invalid_code_format');
  }

  const requestedPlatform = parseRequestedPlatform(request.data?.platform);
  if (requestedPlatform === 'invalid') {
    throw new HttpsError('invalid-argument', 'invalid_platform');
  }

  let lookup;
  try {
    lookup = await lookupPromoCode(normalizedCode);
  } catch (err) {
    logFunctionError(SCOPE, err, { uid, operation: 'catalog_lookup' });
    throw new HttpsError('internal', 'internal_error');
  }

  // Deliberately identical response (code, HTTP status, message) whether the
  // code does not exist, is inactive, or is outside its startsAt/endsAt
  // window — never revealing which condition applies (anti-enumeration).
  if (lookup.status === 'not_found' || !isPromoCodeCurrentlyEligible(lookup.promoCode, new Date())) {
    logWarn(SCOPE, 'promo code unavailable', { uid });
    throw new HttpsError('not-found', 'promo_code_unavailable');
  }

  const { promoCode } = lookup;

  // FASE 4C.3A: computed ONCE, unconditionally (never filtered by
  // `platform`), and snapshotted verbatim into `couponRedemptions/{uid}` —
  // this is what `attributionSync.ts`'s webhook correlation later compares
  // a real purchase against. `platform` only controls what the RESPONSE
  // echoes back to the client (below); it must never affect what gets
  // stored, or a client omitting/misreporting `platform` could leave the
  // stored authorization incomplete.
  const androidOfferSnapshot: PromoCodeAndroidOfferSnapshot = {
    monthly: resolveAndroidOfferPair(
      promoCode.androidBasePlanIdMonthly,
      promoCode.androidOfferIdMonthly,
    ),
    annual: resolveAndroidOfferPair(
      promoCode.androidBasePlanIdAnnual,
      promoCode.androidOfferIdAnnual,
    ),
  };

  // FASE iOS-1: computed ONCE, unconditionally, mirroring
  // `androidOfferSnapshot` above — snapshotted verbatim into
  // `couponRedemptions/{uid}.appleOffer` regardless of the client's
  // requested `platform`. No pairing/resolution step is needed (unlike
  // Android's `resolveAndroidOfferPair`): an Apple offer code is already a
  // single flat, complete value per plan on the catalog document.
  const appleOfferSnapshot: PromoCodeAppleOfferSnapshot = {
    offerCodeMonthly: promoCode.appleOfferCodeMonthly,
    offerCodeAnnual: promoCode.appleOfferCodeAnnual,
  };

  // FASE iOS-6: computed ONCE, unconditionally, mirroring `androidOfferSnapshot`/
  // `appleOfferSnapshot` above — snapshotted verbatim into
  // `couponRedemptions/{uid}.appleOfferCorrelation`. Distinct from
  // `appleOfferSnapshot` above (which the RESPONSE echoes to the client) —
  // this one is NEVER returned to the client, only used later by
  // `attribution/appleOfferCorrelation.ts` to compare a real webhook event
  // against what was authorized at this exact moment.
  const appleOfferCorrelationSnapshot: PromoCodeAppleCorrelationSnapshot = {
    monthly: resolveAppleOfferCorrelationPair(
      promoCode.appleProductIdMonthly,
      promoCode.appleOfferReferenceMonthly,
    ),
    annual: resolveAppleOfferCorrelationPair(
      promoCode.appleProductIdAnnual,
      promoCode.appleOfferReferenceAnnual,
    ),
  };

  // FASE 1: computed ONCE, unconditionally, mirroring the snapshots above —
  // snapshotted verbatim into `couponRedemptions/{uid}.iosPromotion`
  // regardless of the client's requested `platform`, so a later edit to
  // `promoCodes/{code}` can never silently change an already-applied
  // redemption's authorization (`IOSPromotionConfig`'s doc comment). Already
  // fully validated (all-or-nothing) by `promoCodeCatalog.ts`'s parser — no
  // separate pairing/resolution step needed here, unlike Android/legacy
  // Apple, which store their fields flat and need `resolve*Pair` to combine
  // them fail-closed.
  const iosPromotionSnapshot: IOSPromotionConfig | null = promoCode.iosPromotion;

  let outcome;
  try {
    outcome = await applyPromoCodeAttributionTransactionally(uid, {
      couponCode: promoCode.code,
      campaignId: promoCode.campaignId,
      influencerId: promoCode.influencerId,
      androidOffer: androidOfferSnapshot,
      appleOffer: appleOfferSnapshot,
      appleOfferCorrelation: appleOfferCorrelationSnapshot,
      iosPromotion: iosPromotionSnapshot,
    });
  } catch (err) {
    logFunctionError(SCOPE, err, { uid, operation: 'apply_attribution' });
    throw new HttpsError('internal', 'internal_error');
  }

  if (outcome.status === 'user_not_found') {
    // Identity validation (Firebase Auth token) succeeded, but
    // `users/{uid}` doesn't exist — same class of race the webhook already
    // guards against (account deleted mid-request). Not an enumeration
    // concern: this reveals nothing about the promo code, only about the
    // caller's own account state.
    throw new HttpsError('failed-precondition', 'user_not_found');
  }

  if (outcome.status === 'locked') {
    logInfo(SCOPE, 'promo code swap rejected: attribution already locked', { uid });
    throw new HttpsError('failed-precondition', 'attribution_locked');
  }

  logInfo(SCOPE, 'promo code applied', { uid });

  // FASE 4C.1: each plan was already resolved independently and fail-closed
  // above (`androidOfferSnapshot`) — `platform` only decides whether the
  // RESPONSE echoes it back, never recomputed differently here.
  const androidConfig =
    requestedPlatform === undefined || requestedPlatform === 'ANDROID' ? androidOfferSnapshot : null;

  const iosConfig =
    requestedPlatform === undefined || requestedPlatform === 'IOS' ? appleOfferSnapshot : null;

  // FASE 1 — gated by the exact same requested-`platform` rule as `iosConfig`
  // above (never recomputed differently): an Android-only request never
  // receives the iOS promotional authorization, and vice versa is symmetric
  // with `androidConfig`.
  const iosPromotionConfig =
    requestedPlatform === undefined || requestedPlatform === 'IOS' ? iosPromotionSnapshot : null;

  return {
    valid: true,
    code: promoCode.code,
    benefit: {
      campaignId: promoCode.campaignId,
      influencerId: promoCode.influencerId,
      kind: 'promotional_campaign',
    },
    storeConfig: {
      android: androidConfig,
      ios: iosConfig,
    },
    iosPromotion: iosPromotionConfig,
    eligibility: {
      determinedBy: 'store',
      guaranteed: false,
      disclaimer:
        'A elegibilidade final para qualquer período de teste gratuito é determinada exclusivamente pela loja (App Store/Google Play) via RevenueCat, nunca por este backend.',
    },
  };
}
