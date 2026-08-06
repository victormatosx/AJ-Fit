import type { Timestamp } from 'firebase-admin/firestore';
import {
  REVENUECAT_PROVIDER,
  type RevenueCatWebhookEventType,
  type SubscriptionStatus,
  type SubscriptionStore,
} from './constants';

/**
 * Shared types for the billing backend module (docs/13_assinaturas_e_billing.md).
 *
 * These types describe the Firestore MIRROR of a RevenueCat subscription,
 * never the subscription itself — RevenueCat's CustomerInfo is the one
 * official source of truth for Premium access (docs §2/§10/§27). Nothing
 * here is read by the client to gate access; this module only exists to
 * keep `users/{uid}.subscription` in sync for analytics/support/admin use
 * (docs §26/§27).
 *
 * All constant values (statuses, provider, stores, event types) live in
 * `constants.ts` — this file only shapes them into the `SubscriptionMirror`
 * interface.
 */

export type { RevenueCatWebhookEventType, SubscriptionStatus, SubscriptionStore };

/**
 * Shape of `users/{uid}.subscription` (docs/13_assinaturas_e_billing.md §26,
 * consolidated in Sprint 3.5) — a nested map field on the main user
 * document, not a separate document or subcollection.
 *
 * Every field is optional: "Não é exigido que todos os campos existam em
 * todos os estados" (docs §26). Only backend code (this module, via the
 * Admin SDK) may ever write to it — see `applySubscriptionUpdate` in
 * `subscriptionSync.ts`. This exact field set is mirrored 1:1 by
 * `firestore.rules`' `subscriptionValid()` — the two must never diverge
 * (Sprint 3.5 consolidation; see that function's comment for the same list).
 *
 * Sprint 3.5 changes from the original Sprint 3 draft:
 * - `lastEventAt` REMOVED: redundant with `updatedAt` for this project's
 *   scale (every write to this mirror already IS the event-processing
 *   write), not required by the idempotency mechanism (that's `lastEventId`
 *   alone), and not one of the required analytics fields (docs §24).
 * - `provider` KEPT despite being a constant in a single-provider system:
 *   removing it would require rewriting `legacyMigrationValid()` in
 *   firestore.rules, which maps a real (if likely unused pre-launch) legacy
 *   flat-document field — not worth the risk for a field that costs nothing
 *   to keep.
 *
 * Sprint 4.1 robustness fix (see the Sprint 4 audit report): reintroduces a
 * RevenueCat-clock timestamp — `lastEventTimestampMs` — that the Sprint 3.5
 * removal of `lastEventAt` had eliminated. This is NOT the same field
 * brought back unchanged; see that field's own doc comment below for why
 * `updatedAt` alone can never substitute for it.
 */
export interface SubscriptionMirror {
  /** Commercial/business status (docs §12) — never used alone for access. */
  status?: SubscriptionStatus;
  /**
   * THE authorization signal (docs §10/§11): true whenever the `premium`
   * entitlement is active in RevenueCat, independent of `status` (e.g. a
   * `CANCELED` subscription can still have `entitlementActive: true` until
   * `currentPeriodEndsAt`).
   */
  entitlementActive?: boolean;
  /** Always `"REVENUECAT"` (docs §26) — see `REVENUECAT_PROVIDER` in constants.ts. */
  provider?: typeof REVENUECAT_PROVIDER;
  /** RevenueCat/store product identifier (docs §5), e.g. `ajfit_premium_monthly`. */
  productId?: string;
  /** Store the purchase was made through. */
  store?: SubscriptionStore;
  /** When the subscription first started. */
  startedAt?: Timestamp;
  /** Trial end date, if the user is/was in a trial (docs §6/§7). */
  trialEndsAt?: Timestamp | null;
  /**
   * End of the current paid/trial period — the entitlement's real expiry.
   * Renamed from the legacy flat-schema field `endsAt`
   * (docs/04_contratos_de_api.md §5) during Sprint 3.5 consolidation, to
   * match docs/13 §26's canonical name. See `legacyMigrationValid()` in
   * firestore.rules for the one place that still needs to know the old name.
   */
  currentPeriodEndsAt?: Timestamp | null;
  /** When the user canceled auto-renewal, if applicable (docs §16). */
  canceledAt?: Timestamp | null;
  /** Most recent renewal timestamp. */
  lastRenewedAt?: Timestamp | null;
  /**
   * RevenueCat event id of the last event applied. THE idempotency key
   * (docs §25) — set exclusively by `applySubscriptionEventAtomically`'s
   * transaction (subscriptionSync.ts, Sprint 4.1), never supplied directly
   * by a caller (excluded from `validateSubscriptionPayload`'s allowed
   * input fields, same treatment as `updatedAt`).
   */
  lastEventId?: string;
  /**
   * Unix milliseconds of the RevenueCat event's own `event_timestamp_ms` —
   * i.e. WHEN THE EVENT HAPPENED IN REVENUECAT, not when Firestore was
   * touched. Added in Sprint 4.1 (see the Sprint 4 audit report) to close a
   * real gap: `updatedAt` only records when OUR write occurred, which tells
   * you nothing about delivery order — RevenueCat guarantees *at-least-once*
   * delivery, never in-order delivery, so a chronologically OLDER event can
   * arrive and be processed AFTER a newer one already was (a delayed retry,
   * network jitter, etc.). Without a RevenueCat-clock timestamp to compare
   * against, that older event would silently overwrite the newer state.
   * `applySubscriptionEventAtomically` compares the incoming event's
   * timestamp against this stored value BEFORE applying — see that
   * function's doc comment for the exact duplicate/stale/conflict rules.
   *
   * A plain `number`, not a Firestore `Timestamp`: it's RevenueCat's own
   * clock value used purely for ordering comparisons, never rendered as a
   * date to a human — matches `event_timestamp_ms`'s own wire type
   * (integer milliseconds) with no conversion loss.
   *
   * Set exclusively by `applySubscriptionEventAtomically`'s transaction,
   * always together with `lastEventId` — never supplied by a caller
   * (excluded from `validateSubscriptionPayload`'s allowed input fields).
   * Optional for backward compatibility: documents written before Sprint 4.1
   * won't have it, and are treated as "first event of the new mechanism" —
   * no backfill required (see `applySubscriptionEventAtomically`).
   */
  lastEventTimestampMs?: number;
  /** Set by `applySubscriptionEventAtomically`/`applySubscriptionUpdate` on every write — never client-supplied. */
  updatedAt?: Timestamp;
}

/** A `SubscriptionMirror` after `validateSubscriptionPayload` has accepted it. */
export type ValidatedSubscriptionMirror = Readonly<SubscriptionMirror>;

/** Result of validating an untrusted payload against `SubscriptionMirror`'s shape. */
export type SubscriptionValidationResult =
  | { ok: true; data: ValidatedSubscriptionMirror }
  | { ok: false; error: string };

/**
 * Outcome of `applySubscriptionEventAtomically` (subscriptionSync.ts,
 * Sprint 4.1) — what the transaction decided to do with one incoming
 * RevenueCat event. `handleRevenueCatWebhook` (revenuecat.ts) maps each
 * variant to an HTTP response and a distinct log message; see that
 * function's doc comment for the exact mapping.
 *
 * - `processed` — the event was newer than (or the first event after) what
 *   was stored; the mirror was updated.
 * - `duplicate` — same `event.id` already applied; no write.
 * - `stale` — a different event, but chronologically OLDER
 *   (`event_timestamp_ms` less than what's stored); no write.
 * - `conflict` — a different event with the EXACT SAME `event_timestamp_ms`
 *   as what's stored; ambiguous which should win, so neither does — no
 *   write, logged as a structured error for investigation.
 */
export type SubscriptionEventApplyResult =
  | { status: 'processed' }
  | { status: 'duplicate' }
  | { status: 'stale' }
  | { status: 'conflict' };
