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

export interface AndroidSubscriptionOfferConfig {
  basePlanId: string;
  offerId: string;
}

export interface PromoCodeAndroidStoreConfig {
  monthly: AndroidSubscriptionOfferConfig | null;
  annual: AndroidSubscriptionOfferConfig | null;
}

/**
 * FASE iOS-2 — mirrors `functions/src/attribution/types.ts`'s
 * `ApplePromoCodePlatformStoreConfig`/`PromoCodeAppleOfferSnapshot`: an App
 * Store custom offer code is a single flat string per plan, never a
 * `basePlanId`/`offerId` pair (that's a Google Play concept only — see
 * `AndroidSubscriptionOfferConfig`). `null` per plan means no Apple offer
 * code is configured for that plan on this catalog entry. Carried through
 * client state ONLY — nothing in this module (or anywhere in Fase iOS-2)
 * uses this to start a purchase; that remains Fase iOS-3 scope.
 */
export interface PromoCodeAppleStoreConfig {
  offerCodeMonthly: string | null;
  offerCodeAnnual: string | null;
}

/**
 * `androidStoreConfig` and `appleStoreConfig` are two DISTINCT, independently
 * `null`-able fields — never a single "storeConfig" union — so neither can
 * ever be misread as the other's shape (Fase iOS-2 §5: Android config must
 * never be interpreted as Apple config, and vice versa). The backend already
 * enforces this at the wire level (`storeConfig.android`/`storeConfig.ios`,
 * only the requested platform populated); this mirrors that separation
 * instead of collapsing it.
 */
export interface PromoCodeAppliedRecord {
  uid: string;
  generation: number;
  code: string;
  benefit: PromoCodeBenefit;
  androidStoreConfig: PromoCodeAndroidStoreConfig | null;
  appleStoreConfig: PromoCodeAppleStoreConfig | null;
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
      appleStoreConfig: PromoCodeAppleStoreConfig | null;
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
          appleStoreConfig: event.appleStoreConfig,
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
