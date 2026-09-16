/**
 * Pure, identity-scoped state machine for the Paywall's promo/influencer
 * code flow (Fase 4C.2). Mirrors `subscriptionLifecycle.ts`'s shape and
 * guarantees deliberately: every async result carries both the Firebase
 * UID and a monotonic token captured when it started, and is a no-op if
 * either no longer matches current state by the time it resolves.
 *
 * Two independent scoping dimensions, both required (Fase 4C.2 §8/§9):
 * - `generation` — bumped on every identity change (login/logout/account
 *   switch). Discards ANY pending validation across an identity boundary.
 * - `seq` — bumped on every NEW validation attempt for the SAME identity
 *   (e.g. swapping ARNALDO → HELLLEN without logging out). Discards a
 *   late response to a superseded attempt even though the uid never
 *   changed — `generation` alone cannot catch this case.
 *
 * This module has zero dependency on Firebase/RevenueCat/React — it only
 * knows about plain values, so it's fully unit-testable without mocking
 * anything (same reasoning as `subscriptionLifecycle.ts`).
 */

export type PromoCodePhase =
  | 'idle'
  | 'validating'
  | 'applied'
  | 'unavailable'
  | 'locked'
  | 'error';

/** Matches `ValidatePromoCodeResponseData.benefit` (functions/src/attribution/types.ts) — duplicated for the same reason documented in `promoCodeService.ts`. */
export interface PromoCodeBenefit {
  campaignId: string;
  influencerId: string;
  kind: 'promotional_campaign';
}

/**
 * Client mirror of the backend-authored per-plan Android authorization
 * (`functions/src/attribution/types.ts`'s `AndroidSubscriptionOfferConfig`,
 * FASE 5.7). Exactly two valid non-null shapes, discriminated by `kind` so
 * the compiler — not a runtime `basePlanId`/`offerId` presence check —
 * enforces which fields exist together:
 *
 * - `'legacy'` (pre-5.3 influencer coupons): `basePlanId` + `offerId`
 *   identify one exact Google Play `SubscriptionOption`
 *   (`` `${basePlanId}:${offerId}` ``) the client purchases explicitly via
 *   `purchaseSubscriptionOption`.
 * - `'new'` (FASE 5.7): `basePlanId` + `offeringIdentifier` — the coupon
 *   selects only the promotional base plan and which RevenueCat Offering to
 *   resolve its package from; the offer itself (trial or not) is left to
 *   Google Play/RevenueCat. Resolving that Offering/package and purchasing
 *   via `purchasePackage` is NOT implemented by this type or its parser —
 *   see `subscriptionOffer.ts`/the Paywall for that future work (FASE 6.3).
 *
 * There is no third "both" or "neither" shape: `parseAndroidSubscriptionOfferConfig`
 * below rejects anything else as malformed rather than exposing a partial
 * object with optional fields that could be misread as complete.
 */
export type AndroidSubscriptionOfferConfig =
  | { kind: 'legacy'; basePlanId: string; offerId: string }
  | { kind: 'new'; basePlanId: string; offeringIdentifier: string };

export interface PromoCodeAndroidStoreConfig {
  monthly: AndroidSubscriptionOfferConfig | null;
  annual: AndroidSubscriptionOfferConfig | null;
}

export type AndroidSubscriptionOfferConfigParseResult =
  | { status: 'absent' }
  | { status: 'valid'; config: AndroidSubscriptionOfferConfig }
  | { status: 'invalid' };

const ANDROID_LEGACY_OFFER_KEYS = ['basePlanId', 'offerId'] as const;
const ANDROID_NEW_OFFER_KEYS = ['basePlanId', 'offeringIdentifier'] as const;

function isExactNonEmptyString(field: unknown): field is string {
  return typeof field === 'string' && field.length > 0 && field.trim() === field;
}

function sortedKeysMatch(keys: readonly string[], expected: readonly string[]): boolean {
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

/**
 * Runtime boundary for ONE plan's `storeConfig.android.{monthly,annual}`
 * entry — same rigor as `parseIOSPromotionAuthorization`. `null` is the
 * backend's explicit "not configured for this plan" value. Every other
 * shape must match EXACTLY one of the two valid key sets (never a superset,
 * never a subset) with non-empty string values, or it's rejected outright:
 *
 * - `{basePlanId}` alone (either key set incomplete) → invalid.
 * - `{offerId}` alone or `{offeringIdentifier}` alone (missing `basePlanId`)
 *   → invalid.
 * - `{basePlanId, offerId, offeringIdentifier}` all three together
 *   (ambiguous — which shape?) → invalid.
 * - Empty strings, non-string values, arrays, `undefined` → invalid.
 *
 * Never silently coerces a partial/ambiguous object into one shape by
 * picking whichever fields happen to be present — an admin/backend bug that
 * produces a malformed config must fail closed on the client exactly like a
 * malformed `promoCodes` document already fails closed on the backend
 * (`promoCodeCatalog.ts`'s `parsePromoCodeDocument`).
 */
export function parseAndroidSubscriptionOfferConfig(
  value: unknown,
): AndroidSubscriptionOfferConfigParseResult {
  if (value === null) return { status: 'absent' };
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();

  if (sortedKeysMatch(keys, ANDROID_LEGACY_OFFER_KEYS)) {
    if (!isExactNonEmptyString(record.basePlanId) || !isExactNonEmptyString(record.offerId)) {
      return { status: 'invalid' };
    }
    return {
      status: 'valid',
      config: { kind: 'legacy', basePlanId: record.basePlanId, offerId: record.offerId },
    };
  }

  if (sortedKeysMatch(keys, ANDROID_NEW_OFFER_KEYS)) {
    if (
      !isExactNonEmptyString(record.basePlanId) ||
      !isExactNonEmptyString(record.offeringIdentifier)
    ) {
      return { status: 'invalid' };
    }
    return {
      status: 'valid',
      config: {
        kind: 'new',
        basePlanId: record.basePlanId,
        offeringIdentifier: record.offeringIdentifier,
      },
    };
  }

  return { status: 'invalid' };
}

export type PromoCodeAndroidStoreConfigParseResult =
  | { status: 'absent' }
  | { status: 'valid'; config: PromoCodeAndroidStoreConfig }
  | { status: 'invalid' };

const ANDROID_STORE_CONFIG_KEYS = ['annual', 'monthly'] as const;

/**
 * Runtime boundary for the callable response's `storeConfig.android` field
 * as a whole — same rigor/shape as `parseIOSPromotionAuthorization`. `null`
 * is the backend's explicit "no Android config at all for this code" value.
 * Any other shape must have EXACTLY the two keys `monthly`/`annual`, each
 * independently parsed by `parseAndroidSubscriptionOfferConfig` — if EITHER
 * plan is malformed, the WHOLE object is rejected (never expose one valid
 * plan alongside a silently-dropped malformed one).
 */
export function parsePromoCodeAndroidStoreConfig(
  value: unknown,
): PromoCodeAndroidStoreConfigParseResult {
  if (value === null) return { status: 'absent' };
  if (typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (!sortedKeysMatch(keys, ANDROID_STORE_CONFIG_KEYS)) return { status: 'invalid' };

  const monthly = parseAndroidSubscriptionOfferConfig(record.monthly);
  if (monthly.status === 'invalid') return { status: 'invalid' };

  const annual = parseAndroidSubscriptionOfferConfig(record.annual);
  if (annual.status === 'invalid') return { status: 'invalid' };

  return {
    status: 'valid',
    config: {
      monthly: monthly.status === 'valid' ? monthly.config : null,
      annual: annual.status === 'valid' ? annual.config : null,
    },
  };
}

/**
 * FASE 4 — client mirror of the backend-authored `IOSPromotionConfig`.
 * These three values are one indivisible authorization: none is inferred
 * from the coupon text, campaign name, Offering catalog, or SKU suffix.
 */
export interface IOSPromotionAuthorization {
  offeringIdentifier: string;
  monthlyProductId: string;
  annualProductId: string;
}

export type IOSPromotionAuthorizationParseResult =
  | { status: 'absent' }
  | { status: 'valid'; authorization: IOSPromotionAuthorization }
  | { status: 'invalid' };

const IOS_PROMOTION_KEYS = [
  'annualProductId',
  'monthlyProductId',
  'offeringIdentifier',
] as const;

/**
 * Runtime boundary for the callable response. `null` is the backend's
 * explicit "this campaign has no new iOS promotion" value; every other
 * incomplete or unexpected shape is malformed and must fail closed.
 */
export function parseIOSPromotionAuthorization(
  value: unknown,
): IOSPromotionAuthorizationParseResult {
  if (value === null) return { status: 'absent' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'invalid' };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== IOS_PROMOTION_KEYS.length ||
    keys.some((key, index) => key !== IOS_PROMOTION_KEYS[index])
  ) {
    return { status: 'invalid' };
  }

  const isExactNonEmptyString = (field: unknown): field is string =>
    typeof field === 'string' && field.length > 0 && field.trim() === field;

  if (
    !isExactNonEmptyString(record.offeringIdentifier) ||
    !isExactNonEmptyString(record.monthlyProductId) ||
    !isExactNonEmptyString(record.annualProductId)
  ) {
    return { status: 'invalid' };
  }

  return {
    status: 'valid',
    authorization: {
      offeringIdentifier: record.offeringIdentifier,
      monthlyProductId: record.monthlyProductId,
      annualProductId: record.annualProductId,
    },
  };
}

export interface PromoCodeAppliedRecord {
  uid: string;
  generation: number;
  code: string;
  benefit: PromoCodeBenefit;
  androidStoreConfig: PromoCodeAndroidStoreConfig | null;
  /** Offering/SKU authorization for the production iOS promo path. */
  iosPromotion: IOSPromotionAuthorization | null;
}

export interface PromoCodeState {
  uid: string | null;
  generation: number;
  seq: number;
  phase: PromoCodePhase;
  /**
   * The last successfully applied code for the CURRENT identity/attempt.
   * `null` outside `'applied'`/`'locked'` — see `validation-started`'s
   * handling below for why it's cleared immediately, not just on success.
   */
  applied: PromoCodeAppliedRecord | null;
  /** User-facing message for `'unavailable'`/`'locked'`/`'error'` — always `null` otherwise. */
  message: string | null;
}

export function createInitialPromoCodeState(): PromoCodeState {
  return { uid: null, generation: 0, seq: 0, phase: 'idle', applied: null, message: null };
}

export type PromoCodeEvent =
  | { type: 'identity-changed'; uid: string | null; generation: number }
  | { type: 'validation-started'; uid: string; generation: number; seq: number }
  | {
      type: 'validation-applied';
      uid: string;
      generation: number;
      seq: number;
      code: string;
      benefit: PromoCodeBenefit;
      androidStoreConfig: PromoCodeAndroidStoreConfig | null;
      iosPromotion: IOSPromotionAuthorization | null;
    }
  | { type: 'validation-unavailable'; uid: string; generation: number; seq: number; message: string }
  | { type: 'validation-locked'; uid: string; generation: number; seq: number; message: string }
  | { type: 'validation-error'; uid: string; generation: number; seq: number; message: string }
  /** Distinct from `validation-error`: Fase 4C.2 §19 requires NOT keeping promo state on `unauthenticated` — reset to `idle`, not a message-bearing `error` phase. */
  | { type: 'unauthenticated'; uid: string; generation: number; seq: number };

function matchesIdentity(
  state: PromoCodeState,
  event: { uid: string; generation: number },
): boolean {
  return state.uid === event.uid && state.generation === event.generation;
}

/** True only for an event that is both the current identity AND the current (most recent) validation attempt. */
function matchesCurrentAttempt(
  state: PromoCodeState,
  event: { uid: string; generation: number; seq: number },
): boolean {
  return matchesIdentity(state, event) && state.seq === event.seq && state.phase === 'validating';
}

export function reducePromoCodeState(
  state: PromoCodeState,
  event: PromoCodeEvent,
): PromoCodeState {
  switch (event.type) {
    case 'identity-changed':
      // Fase 4C.2 §8/§9: any identity change (login, logout, account
      // switch) invalidates everything unconditionally — no previously
      // `applied` record, no in-flight validation, ever survives it.
      return {
        uid: event.uid,
        generation: event.generation,
        seq: 0,
        phase: 'idle',
        applied: null,
        message: null,
      };

    case 'validation-started':
      if (!matchesIdentity(state, event)) return state;
      // §9/§10: starting ANY new validation (a swap like ARNALDO→HELLLEN,
      // or even a retry of the same code) immediately clears `applied` —
      // never leave a previously authorized code "available" while a new
      // attempt is in flight.
      return { ...state, seq: event.seq, phase: 'validating', applied: null, message: null };

    case 'validation-applied':
      if (!matchesCurrentAttempt(state, event)) return state;
      return {
        ...state,
        phase: 'applied',
        applied: {
          uid: event.uid,
          generation: event.generation,
          code: event.code,
          benefit: event.benefit,
          androidStoreConfig: event.androidStoreConfig,
          iosPromotion: event.iosPromotion,
        },
        message: null,
      };

    case 'validation-unavailable':
      if (!matchesCurrentAttempt(state, event)) return state;
      return { ...state, phase: 'unavailable', applied: null, message: event.message };

    case 'validation-locked':
      if (!matchesCurrentAttempt(state, event)) return state;
      // `applied` stays `null` here: `validation-started` already cleared
      // it for THIS attempt, and this module never resurrects an older
      // attempt's applied record from memory — the message alone explains
      // why the NEW code was rejected. See promoCodeState's top doc
      // comment / the Fase 4C.2 report for why this is an accepted,
      // deliberate simplification (cold start doesn't restore state
      // either — Fase 4C audit §15/§20).
      return { ...state, phase: 'locked', applied: null, message: event.message };

    case 'validation-error':
      if (!matchesCurrentAttempt(state, event)) return state;
      return { ...state, phase: 'error', applied: null, message: event.message };

    case 'unauthenticated':
      if (!matchesCurrentAttempt(state, event)) return state;
      return { ...state, phase: 'idle', applied: null, message: null };
  }
}
