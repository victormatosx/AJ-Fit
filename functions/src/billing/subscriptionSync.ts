import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { auth, db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import {
  COMMERCIAL_GATE_RESOLVED_AT_PATH,
  REVENUECAT_PROVIDER,
  SUBSCRIPTION_FIELD,
  SUBSCRIPTION_LAST_EVENT_ID_FIELD,
  SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STORES,
  userDocPath,
} from './constants';
import type {
  SubscriptionEventApplyResult,
  SubscriptionMirror,
  SubscriptionStatus,
  SubscriptionStore,
  SubscriptionValidationResult,
  ValidatedSubscriptionMirror,
} from './types';

/**
 * Firestore-facing half of the billing module (docs/13_assinaturas_e_billing.md
 * §25/§26/§27): locate the user, validate an untrusted subscription payload,
 * and apply it as a safe, ordering-aware, idempotent transaction.
 * RevenueCat-specific vocabulary (event types, status mapping) lives in
 * `revenuecat.ts` — this file only knows about Firestore's
 * `users/{uid}.subscription` shape.
 *
 * Sprint 3.5 consolidation: the field set validated below is now IDENTICAL
 * to `firestore.rules`' `subscriptionValid()` and to docs/13 §26 — the three
 * were divergent as of Sprint 3, and that divergence is the reason that
 * Sprint exists. Any future field change must be applied to all three in the
 * same change.
 *
 * Sprint 4.1 robustness fix (see the Sprint 4 audit report): replaces the
 * old two-step "read lastEventId, then separately write" flow — which had
 * both a TOCTOU race under concurrent requests and no protection against
 * out-of-order event delivery — with `applySubscriptionEventAtomically`, a
 * single Firestore transaction that reads, decides, and writes atomically.
 * `applySubscriptionUpdate` still exists but is NO LONGER used for webhook
 * events — see its own doc comment for its narrowed, current purpose.
 */

const SCOPE = 'billing:subscriptionSync';

/**
 * True if `users/{uid}` exists. Callers must check this before writing a
 * subscription mirror for a uid they haven't otherwise validated — RevenueCat
 * events are external input and a typo'd/deleted uid must never silently
 * create a partial user document.
 *
 * Kept as a separate, non-transactional read: the webhook handler's policy
 * for a missing user (log + HTTP 200, no retry) is unrelated to the
 * duplicate/stale/conflict decision `applySubscriptionEventAtomically` makes
 * — folding it into that transaction would overload one function with two
 * different kinds of "should I write" logic.
 */
export async function userExists(uid: string): Promise<boolean> {
  try {
    const snapshot = await db.doc(userDocPath(uid)).get();
    return snapshot.exists;
  } catch (err) {
    logFunctionError(SCOPE, err, { operation: 'firestore_user_lookup' });
    throw err;
  }
}

/**
 * True only when the uid still exists in both identity stores required by
 * this app: Firebase Authentication and `users/{uid}` in Firestore. The
 * Firestore document remains the write precondition, while the Auth lookup
 * prevents a deleted account with a temporarily retained document from
 * winning RevenueCat alias resolution.
 *
 * No document or Auth user is ever created here. Unexpected Admin SDK
 * failures are rethrown so the webhook can retry instead of converting an
 * infrastructure problem into a permanent "user not found" result.
 */
export async function validFirebaseUserExists(uid: string): Promise<boolean> {
  const firestoreUserExists = await userExists(uid);
  if (!firestoreUserExists) return false;

  try {
    await auth.getUser(uid);
    return true;
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === 'auth/user-not-found') return false;

    logFunctionError(SCOPE, err, { operation: 'firebase_auth_user_lookup' });
    throw err;
  }
}

/**
 * Fields `SubscriptionMirror` is allowed to have (docs §26, consolidated
 * Sprint 3.5) — kept as a Set for O(1) lookups in `validateSubscriptionPayload`.
 * MUST match `firestore.rules`' `subscriptionValid()` key list exactly.
 *
 * `lastEventId`/`lastEventTimestampMs` are intentionally NOT in this set
 * (Sprint 4.1): both are set exclusively, and always together, by
 * `applySubscriptionEventAtomically`'s transaction — never supplied by a
 * caller — same treatment `updatedAt` already had.
 */
const ALLOWED_FIELDS = new Set<keyof SubscriptionMirror>([
  'status',
  'entitlementActive',
  'provider',
  'productId',
  'store',
  'startedAt',
  'trialEndsAt',
  'currentPeriodEndsAt',
  'canceledAt',
  'lastRenewedAt',
]);

/** Nullable Timestamp fields — `null` explicitly means "not applicable" (e.g. a lifetime entitlement has no `currentPeriodEndsAt`). */
const NULLABLE_TIMESTAMP_FIELDS = new Set<keyof SubscriptionMirror>([
  'trialEndsAt',
  'currentPeriodEndsAt',
  'canceledAt',
  'lastRenewedAt',
]);

/** Timestamp fields that, if present, may never be `null`. */
const REQUIRED_TIMESTAMP_FIELDS = new Set<keyof SubscriptionMirror>(['startedAt']);

/**
 * Validates an untrusted object against the `SubscriptionMirror` shape
 * (docs/13_assinaturas_e_billing.md §26) before it's allowed anywhere near
 * `applySubscriptionEventAtomically`/`applySubscriptionUpdate`. Rejects
 * unknown fields outright — this module must never silently persist a field
 * the billing doc doesn't define.
 *
 * Does NOT process RevenueCat's raw event/webhook format — that translation
 * is `normalizeSubscription`'s job (revenuecat.ts). This only checks that an
 * already-normalized object has the right shape and types. Does NOT know
 * about `lastEventId`/`lastEventTimestampMs`/`updatedAt` — see `ALLOWED_FIELDS`.
 */
export function validateSubscriptionPayload(payload: unknown): SubscriptionValidationResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'payload must be a plain object' };
  }

  const data = payload as Record<string, unknown>;

  const unknownFields = Object.keys(data).filter(
    (key) => !ALLOWED_FIELDS.has(key as keyof SubscriptionMirror),
  );
  if (unknownFields.length > 0) {
    return { ok: false, error: `unknown field(s): ${unknownFields.join(', ')}` };
  }

  if ('status' in data && !SUBSCRIPTION_STATUSES.includes(data.status as SubscriptionStatus)) {
    return { ok: false, error: `invalid status: ${String(data.status)}` };
  }

  if ('entitlementActive' in data && typeof data.entitlementActive !== 'boolean') {
    return { ok: false, error: 'entitlementActive must be a boolean' };
  }

  if ('provider' in data && data.provider !== REVENUECAT_PROVIDER) {
    return { ok: false, error: `provider must be "${REVENUECAT_PROVIDER}"` };
  }

  if ('productId' in data && typeof data.productId !== 'string') {
    return { ok: false, error: 'productId must be a string' };
  }

  if ('store' in data && !SUBSCRIPTION_STORES.includes(data.store as SubscriptionStore)) {
    return { ok: false, error: `invalid store: ${String(data.store)}` };
  }

  for (const field of REQUIRED_TIMESTAMP_FIELDS) {
    if (field in data && !(data[field] instanceof Timestamp)) {
      return { ok: false, error: `${field} must be a Firestore Timestamp` };
    }
  }

  for (const field of NULLABLE_TIMESTAMP_FIELDS) {
    if (field in data && data[field] !== null && !(data[field] instanceof Timestamp)) {
      return { ok: false, error: `${field} must be a Firestore Timestamp or null` };
    }
  }

  return { ok: true, data: data as ValidatedSubscriptionMirror };
}

/**
 * THE official write path for RevenueCat webhook events
 * (docs/13_assinaturas_e_billing.md §25/§26, Sprint 4.1). Single Firestore
 * transaction — read, decide, write — eliminating both bugs found in the
 * Sprint 4 robustness audit:
 *
 * 1. TOCTOU race: the old flow read `lastEventId` in one request, then wrote
 *    in a separate request, with no atomicity between the two — two
 *    concurrent requests for the same uid could both pass the duplicate
 *    check before either had written. A Firestore transaction makes the
 *    read+decide+write one atomic unit; Firestore itself serializes
 *    conflicting transactions (retrying the loser), so two concurrent calls
 *    for the same uid can never both "win" the same decision.
 * 2. Out-of-order events: the old flow only checked "is this exact event id
 *    already applied", never "is this event OLDER than what's applied".
 *    RevenueCat guarantees at-least-once delivery, never in-order delivery,
 *    so a delayed/retried older event could silently overwrite newer state.
 *    This function compares `eventTimestampMs` (RevenueCat's own clock,
 *    `event_timestamp_ms`) against the stored `lastEventTimestampMs` before
 *    ever writing.
 *
 * DECISION RULES (docs §25, Sprint 4.1 — evaluated in this order):
 * - Same `event.id` as what's already stored → `duplicate`. No write.
 * - No `lastEventTimestampMs` stored yet (pre-4.1 document, or a user's
 *   first-ever event) → treated as the first event of this mechanism →
 *   `processed`. No backfill required for older documents.
 * - Incoming `eventTimestampMs` < stored `lastEventTimestampMs` → `stale`
 *   (a genuinely older, different event, delivered late). No write.
 * - Incoming `eventTimestampMs` === stored `lastEventTimestampMs`, but a
 *   DIFFERENT `event.id` → `conflict`. RevenueCat's docs don't define a tie
 *   rule for two distinct events sharing a millisecond, and guessing one
 *   (e.g. lexicographic id order) would be an arbitrary, unverifiable
 *   invention — so neither is applied, the existing state is preserved
 *   as-is, and this is logged as a structured error for manual
 *   investigation rather than silently resolved.
 * - Incoming `eventTimestampMs` > stored `lastEventTimestampMs` →
 *   `processed`. Applies the merge.
 *
 * On `processed`, ordinary commercial events use the established partial
 * merge. A caller may explicitly request replacement of the nested
 * `subscription` map for a complete current-state snapshot (currently only
 * TRANSFER reconciliation), which clears stale fields without changing the
 * parent user document. Both modes always write `lastEventId`,
 * `lastEventTimestampMs`, and a fresh `updatedAt` together.
 */
/** What `decideSubscriptionEventOutcome` needs to know about the currently-stored mirror — nothing Firestore-specific. */
export interface CurrentSubscriptionEventState {
  lastEventId: string | null;
  lastEventTimestampMs: number | null;
}

/**
 * Pure decision function — CASES A–E from this Sprint's design (docs §25,
 * Sprint 4.1). Deliberately has ZERO dependency on Firestore/Admin SDK: it
 * only looks at plain values, so it's fully unit-testable without an
 * emulator (see `__tests__/decideSubscriptionEventOutcome.test.ts` and
 * `functions/TESTING.md` for what this can and cannot substitute for —
 * real transactional atomicity under concurrency still needs the emulator).
 *
 * `applySubscriptionEventAtomically` is a thin Firestore-transaction wrapper
 * around this function: it reads the current state, calls this to decide,
 * and only performs the actual write when the result is `processed`.
 *
 * - CASE A — `current.lastEventId === eventId` → `duplicate`.
 * - CASE E — `current.lastEventTimestampMs === null` (no previous event
 *   under this mechanism — pre-4.1 document or the user's first-ever event)
 *   → `processed`, unconditionally (no backfill required).
 * - CASE B — `eventTimestampMs < current.lastEventTimestampMs` → `stale`.
 * - CASE D — `eventTimestampMs === current.lastEventTimestampMs` (and, by
 *   this point, a different id — CASE A already returned) → `conflict`.
 *   RevenueCat's docs define no tie-break rule for two distinct events
 *   sharing a millisecond; inventing one (e.g. lexicographic id order) would
 *   be an arbitrary, unverifiable guess, so neither event is applied and the
 *   existing state is left exactly as-is.
 * - CASE C — `eventTimestampMs > current.lastEventTimestampMs` → `processed`.
 */
export function decideSubscriptionEventOutcome(
  current: CurrentSubscriptionEventState,
  eventId: string,
  eventTimestampMs: number,
): SubscriptionEventApplyResult {
  if (current.lastEventId !== null && current.lastEventId === eventId) {
    return { status: 'duplicate' };
  }

  if (current.lastEventTimestampMs === null) {
    return { status: 'processed' };
  }

  if (eventTimestampMs < current.lastEventTimestampMs) {
    return { status: 'stale' };
  }

  if (eventTimestampMs === current.lastEventTimestampMs) {
    return { status: 'conflict' };
  }

  return { status: 'processed' };
}

/**
 * THE official write path for RevenueCat webhook events
 * (docs/13_assinaturas_e_billing.md §25/§26, Sprint 4.1). Single Firestore
 * transaction — read, decide (via `decideSubscriptionEventOutcome`), write —
 * eliminating both bugs found in the Sprint 4 robustness audit:
 *
 * 1. TOCTOU race: the old flow read `lastEventId` in one request, then wrote
 *    in a separate request, with no atomicity between the two — two
 *    concurrent requests for the same uid could both pass the duplicate
 *    check before either had written. A Firestore transaction makes the
 *    read+decide+write one atomic unit; Firestore itself serializes
 *    conflicting transactions (retrying the loser on contention), so two
 *    concurrent calls for the same uid can never both "win" the same
 *    decision.
 * 2. Out-of-order events: the old flow only checked "is this exact event id
 *    already applied", never "is this event OLDER than what's applied".
 *    RevenueCat guarantees at-least-once delivery, never in-order delivery,
 *    so a delayed/retried older event could silently overwrite newer state.
 *    This function compares `eventTimestampMs` (RevenueCat's own clock,
 *    `event_timestamp_ms`) against the stored `lastEventTimestampMs` before
 *    ever writing — see `decideSubscriptionEventOutcome` for the exact rules.
 *
 * On `processed`, the default remains the established partial merge for
 * commercial event deltas. `replaceSubscription` is reserved for complete
 * current-state snapshots (currently TRANSFER reconciliation), replacing
 * only the nested map so obsolete active-state fields are removed. Both
 * modes write `lastEventId`, `lastEventTimestampMs`, and `updatedAt`
 * together, only after the ordering decision is `processed`.
 */
export async function applySubscriptionEventAtomically(
  uid: string,
  eventId: string,
  eventTimestampMs: number,
  subscription: ValidatedSubscriptionMirror,
  options: { replaceSubscription?: boolean } = {},
): Promise<SubscriptionEventApplyResult> {
  const ref = db.doc(userDocPath(uid));

  try {
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        // Identity validation checks this before opening the transaction, but
        // deletion can race that read. Guard again inside the transaction so
        // the merge-set below can never recreate `users/{uid}`.
        logWarn(SCOPE, 'user disappeared before subscription transaction', {
          eventId,
          eventTimestampMs,
        });
        return { status: 'user_not_found' };
      }
      const current = snapshot.get(SUBSCRIPTION_FIELD) as Record<string, unknown> | undefined;
      const currentState: CurrentSubscriptionEventState = {
        lastEventId:
          typeof current?.[SUBSCRIPTION_LAST_EVENT_ID_FIELD] === 'string'
            ? (current[SUBSCRIPTION_LAST_EVENT_ID_FIELD] as string)
            : null,
        lastEventTimestampMs:
          typeof current?.[SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD] === 'number'
            ? (current[SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD] as number)
            : null,
      };

      const outcome = decideSubscriptionEventOutcome(currentState, eventId, eventTimestampMs);

      if (outcome.status === 'stale') {
        logWarn(SCOPE, 'stale event ignored (older than last applied event)', {
          uid,
          eventId,
          eventTimestampMs,
          ...currentState,
        });
        return outcome;
      }

      if (outcome.status === 'conflict') {
        // Different id (CASE A already handled duplicates above), identical
        // timestamp — see `decideSubscriptionEventOutcome`'s doc comment for
        // why this is deliberately left unresolved rather than guessed at.
        logFunctionError(
          SCOPE,
          new Error('conflicting events share the same event_timestamp_ms'),
          { uid, eventId, eventTimestampMs, ...currentState },
        );
        return outcome;
      }

      if (outcome.status === 'duplicate') {
        return outcome;
      }

      const nextSubscription = {
        ...subscription,
        [SUBSCRIPTION_LAST_EVENT_ID_FIELD]: eventId,
        [SUBSCRIPTION_LAST_EVENT_TIMESTAMP_MS_FIELD]: eventTimestampMs,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Initial-Paywall marker (docs/13, "Fase 1 limited-mode rollout" +
      // its later reintroduction of a gate scoped to brand-new accounts —
      // see the `UserProfile.metadata` doc comment in
      // src/services/userProfile.ts). Resolved here, in the SAME write as
      // the subscription mirror, the first time a webhook event confirms an
      // active entitlement — never on any other event, and never once it is
      // already a timestamp (a later cancellation/expiration must not
      // revert an established account back to "new"). Reading the
      // dotted path off `snapshot` (not `current`, which only looks inside
      // `subscription`) distinguishes the three states: `undefined`
      // (absent — a pre-existing document from before this field existed,
      // already treated as resolved by the client's own `!== null` check,
      // so no write needed) vs `null` (a genuinely new, still-pending
      // account) vs an existing `Timestamp` (already resolved — leave as
      // is).
      const gateFieldValue = snapshot.get(COMMERCIAL_GATE_RESOLVED_AT_PATH) as
        | Timestamp
        | null
        | undefined;
      const shouldResolveCommercialGate =
        gateFieldValue === null && subscription.entitlementActive === true;
      const extraFields = shouldResolveCommercialGate
        ? { [COMMERCIAL_GATE_RESOLVED_AT_PATH]: FieldValue.serverTimestamp() }
        : {};

      if (options.replaceSubscription) {
        // A TRANSFER reconciliation is a complete current-state snapshot,
        // not a partial event delta. Replace the nested map so stale fields
        // such as an old active product/trial cannot survive an inactive
        // RevenueCat response. `update` also preserves the no-create
        // invariant already guarded by the transaction read above.
        // `extraFields`' dotted key is a distinct top-level field path, so
        // combining it here does not affect the full-map replace of
        // `subscription`.
        transaction.update(ref, { [SUBSCRIPTION_FIELD]: nextSubscription, ...extraFields });
      } else {
        // Ordinary commercial webhooks remain partial deltas and retain the
        // long-standing deep-merge behavior.
        transaction.set(
          ref,
          { [SUBSCRIPTION_FIELD]: nextSubscription, ...extraFields },
          { merge: true },
        );
      }

      return outcome;
    });
  } catch (err) {
    logFunctionError(SCOPE, err, { uid, eventId, eventTimestampMs });
    throw err;
  }
}

/**
 * Low-level partial-merge writer for `users/{uid}.subscription`
 * (docs/13_assinaturas_e_billing.md §25/§26). Only accepts data that already
 * went through `validateSubscriptionPayload`.
 *
 * NOT used for RevenueCat webhook events anymore (Sprint 4.1) —
 * `applySubscriptionEventAtomically` is the official webhook write path (it
 * has ordering/idempotency semantics this function does not). Kept as a
 * narrower primitive reserved for writes that have no event-ordering
 * concept of their own — e.g. the planned legacy `endsAt` →
 * `currentPeriodEndsAt` backfill in `legacyMigration.ts`, or a future
 * admin-triggered correction. There is currently no live caller; it is not
 * dead code because it is documented, real, deliberately-scoped
 * infrastructure for that already-planned use, not a leftover from before
 * this Sprint.
 *
 * Uses `set(..., { merge: true })`, which Firestore deep-merges into nested
 * map fields: any `subscription` sub-field already stored but absent from
 * `subscription` here is left untouched, never erased. `updatedAt` is always
 * stamped with the server timestamp, overriding any caller-supplied value
 * (`SubscriptionValidationResult` never contains one — see `ALLOWED_FIELDS`).
 */
export async function applySubscriptionUpdate(
  uid: string,
  subscription: ValidatedSubscriptionMirror,
): Promise<void> {
  try {
    await db.doc(userDocPath(uid)).set(
      {
        [SUBSCRIPTION_FIELD]: {
          ...subscription,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    logInfo(SCOPE, 'subscription mirror updated', { uid });
  } catch (err) {
    logFunctionError(SCOPE, err, { uid });
    throw err;
  }
}
