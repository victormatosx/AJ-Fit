import * as crypto from 'crypto';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { defineSecret } from 'firebase-functions/params';
import { Timestamp } from 'firebase-admin/firestore';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import {
  PREMIUM_ENTITLEMENT_ID,
  RC_ANONYMOUS_ID_PREFIX,
  REVENUECAT_PROVIDER,
  SUBSCRIPTION_STORES,
  SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES,
  type SupportedRevenueCatWebhookEventType,
} from './constants';
import {
  applySubscriptionEventAtomically,
  validFirebaseUserExists,
  validateSubscriptionPayload,
} from './subscriptionSync';
import {
  createRevenueCatV2Client,
  RevenueCatApiError,
  REVENUECAT_API_SECRET_KEY,
  type RevenueCatIdentityApi,
  type RevenueCatSubscriptionEnvironment,
} from './revenueCatApi';
import {
  maskRevenueCatIdentifier,
  resolveRevenueCatFirebaseUid,
  type RevenueCatIdentityResolution,
} from './revenueCatIdentity';
import { reconcileRevenueCatPremiumSubscriptions } from './revenueCatSubscription';
import type {
  SubscriptionEventApplyResult,
  SubscriptionMirror,
  SubscriptionStatus,
  SubscriptionStore,
} from './types';
import {
  applyAttributionRevenueCatEvent,
  type AttributionConfirmationSkipReason,
} from '../attribution/attributionSync';

/**
 * RevenueCat webhook processing — real implementation (Sprint 4;
 * docs/13_assinaturas_e_billing.md §25/§28). Sprint 3 only shipped a 501
 * stub; this file now verifies the HMAC signature, parses + validates the
 * event envelope, normalizes the event into a `SubscriptionMirror` partial,
 * and applies it through `applySubscriptionEventAtomically`
 * (subscriptionSync.ts) — the ONLY function allowed to write
 * `users/{uid}.subscription` for webhook events.
 *
 * Firestore reading/writing/validation stays in subscriptionSync.ts; this
 * file only knows RevenueCat's own vocabulary: webhook signature scheme,
 * event shape, and status mapping.
 *
 * Verified against RevenueCat's official webhook docs
 * (revenuecat.com/docs/integrations/webhooks and .../event-types-and-fields)
 * during this Sprint. One real divergence was found and fixed: `REFUND` is
 * NOT a standalone RevenueCat event — refunds arrive as `CANCELLATION` with
 * `cancel_reason`. `constants.ts` and docs §25 were updated accordingly
 * (human-confirmed before implementing).
 *
 * Sprint 4.1 robustness fix (see the Sprint 4 audit report): idempotency and
 * ordering are now enforced atomically inside `applySubscriptionEventAtomically`
 * — this file no longer does its own separate "check then write" (that was
 * the source of both the TOCTOU race and the out-of-order-event bug the
 * audit found). It also now requires a valid `event_timestamp_ms` on every
 * supported event before doing anything else with it — see
 * `extractEventTimestampMs`.
 *
 * FASE 4B: for an `INITIAL_PURCHASE`/`RENEWAL` concerning the premium
 * entitlement, this file also calls `attribution/attributionSync.ts`'s
 * `applyAttributionRevenueCatEvent` to confirm/lock a pending promo-code
 * attribution — see `confirmPromoCodeAttributionIfApplicable`. That call
 * NEVER writes `users/{uid}.subscription`/`SubscriptionMirror` (it only
 * touches `couponRedemptions/{uid}`).
 *
 * FASE 4B.1 (robustness fix — see the Fase 4B.1 audit report): billing
 * (`applySubscriptionEventAtomically`) and attribution
 * (`applyAttributionRevenueCatEvent`) are two INDEPENDENT consumers of the
 * same webhook event, each with its own idempotency. Gating attribution
 * confirmation behind billing's `processed`-only result created a
 * permanent-loss bug: if attribution failed transiently right after a
 * successful billing write, the webhook still returned 200, RevenueCat
 * never retried, and a retry that DID happen would see billing's own
 * dedup return `duplicate` — which, under the old gating, meant
 * attribution was never even attempted again.
 *
 * The fix: `confirmPromoCodeAttributionIfApplicable` is now called for
 * billing outcomes `processed`, `duplicate`, AND `stale` (see
 * `respondConsideringAttribution`) — never for `conflict`/`user_not_found`,
 * which remain anomalous states requiring manual investigation, out of
 * scope for this fix. This is safe specifically because
 * `couponRedemptions/{uid}`'s `lockedAt`/`trialStartedAt`/`convertedAt`
 * fields are write-once latches, re-checked fresh inside
 * `applyAttributionRevenueCatEvent`'s own transaction on every call — so
 * calling it redundantly (retries, or a `stale` billing delivery that is
 * still the only evidence attribution has ever seen of a given
 * INITIAL_PURCHASE) never overwrites an already-confirmed timestamp. If
 * `applyAttributionRevenueCatEvent` throws (a real infrastructure/
 * transaction failure, never a normal "nothing to do" outcome — see
 * `AttributionConfirmationResult`), the webhook now responds `503` instead
 * of silently swallowing it, so RevenueCat retries — a genuinely permanent
 * attribution bug still stops retrying once RevenueCat's own retry budget
 * (5 attempts, 5–80 min backoff) is exhausted, exactly like every other
 * 5xx path in this file.
 */

const SCOPE = 'billing:revenuecat';

/**
 * Per-integration HMAC signing secret (RevenueCat dashboard → Project
 * settings → Webhooks → Signing secret). Resolved from Secret Manager at
 * runtime via `firebase-functions/params` — bound to the `revenueCatWebhook`
 * function in index.ts (alongside `REVENUECAT_API_SECRET_KEY`). Never
 * hardcoded, never committed. Set once with:
 *   firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
 */
export const REVENUECAT_WEBHOOK_SECRET = defineSecret('REVENUECAT_WEBHOOK_SECRET');

// Re-exported so index.ts can bind both server-side secrets to the Gen2
// function from the same billing entry module.
export { REVENUECAT_API_SECRET_KEY };

const SIGNATURE_HEADER = 'X-RevenueCat-Webhook-Signature';
/** RevenueCat's own documented tolerance for signature timestamp drift (seconds). */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies `X-RevenueCat-Webhook-Signature: t=<unix_seconds>,v1=<hmac_sha256_hex>`
 * against the RAW request body, per RevenueCat's documented scheme
 * (revenuecat.com/docs/integrations/webhooks). Deliberately takes
 * `rawBody: Buffer` (preserved by the Cloud Functions runtime alongside the
 * parsed `req.body`) instead of re-serializing the parsed JSON — JSON
 * re-serialization is not guaranteed byte-identical to what RevenueCat
 * actually signed (key order, whitespace, unicode escaping), which would
 * silently break verification.
 *
 * AUTHORIZATION NOTE: this function answers "is this really RevenueCat" —
 * it has nothing to do with `entitlementActive`/Premium access authorization
 * (docs §10/§11), which is a completely separate concept computed later in
 * `normalizeSubscription`. Naming them differently on purpose to avoid
 * confusing the two kinds of "authorization" in this file.
 */
export function isValidWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;

  const fields = new Map<string, string>();
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key && value) fields.set(key.trim(), value.trim());
  }
  const timestamp = fields.get('t');
  const signature = fields.get('v1');
  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  // Rejects both stale replays and (defensively) far-future timestamps.
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(signedPayload).digest('hex'),
    'hex',
  );
  const provided = Buffer.from(signature, 'hex');

  // Length check before timingSafeEqual: it throws on mismatched lengths
  // rather than returning false, and the length check itself leaks no
  // useful timing information (hex signature length is fixed-format).
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

/**
 * Untrusted raw shape of a RevenueCat webhook event body (the `event` object
 * inside the `{ api_version, event }` envelope). Every field is read
 * defensively in `normalizeSubscription` — nothing here is assumed present
 * or correctly typed until checked.
 */
export interface RawRevenueCatEvent {
  id?: unknown;
  type?: unknown;
  event_timestamp_ms?: unknown;
  purchased_at_ms?: unknown;
  app_user_id?: unknown;
  original_app_user_id?: unknown;
  aliases?: unknown;
  transferred_from?: unknown;
  transferred_to?: unknown;
  product_id?: unknown;
  new_product_id?: unknown;
  period_type?: unknown;
  expiration_at_ms?: unknown;
  grace_period_expiration_at_ms?: unknown;
  store?: unknown;
  entitlement_ids?: unknown;
  environment?: unknown;
  /**
   * RENEWAL-only field (confirmed against RevenueCat's official webhook
   * docs for Fase 4B — revenuecat.com/docs/integrations/webhooks/
   * event-types-and-fields): "Whether the previous period was a free
   * trial." Absent on every other event type. Used exclusively by
   * `confirmPromoCodeAttributionIfApplicable` to decide whether a RENEWAL
   * represents the trial→paid conversion — never read by
   * `normalizeSubscription`/`mapRevenueCatStatus`.
   */
  is_trial_conversion?: unknown;
  /**
   * FASE 4C.3A (confirmed against RevenueCat's official webhook docs —
   * revenuecat.com/docs/integrations/webhooks/event-types-and-fields,
   * re-audited for this task): "Offer or promotion code used for the
   * transaction. This can be `null`." Listed as a Subscription lifecycle
   * field, "Sometimes" included — NOT guaranteed present even on
   * `INITIAL_PURCHASE`, and RevenueCat's docs give no guarantee it survives
   * onto a `RENEWAL`. Used exclusively by
   * `confirmPromoCodeAttributionIfApplicable`/`attribution/googlePlayOfferCorrelation.ts`
   * to prove a Google Play `INITIAL_PURCHASE` used the specific promotional
   * offer a pending attribution was authorized for — never read for
   * `RENEWAL` (see that module's doc comment for why).
   */
  offer_code?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

type TransferSide = 'source' | 'destination';

type TransferSideOutcome =
  | {
      status: SubscriptionEventApplyResult['status'];
      reconciliation: 'active' | 'inactive';
    }
  | { status: 'identity_unresolved' }
  | { status: 'identity_ambiguous' }
  | { status: 'reconciliation_ambiguous' }
  | { status: 'normalization_failed' };

function respondToRevenueCatApiFailure(
  error: unknown,
  res: Response,
  context: { eventId: string; eventType: string; transferSide?: TransferSide },
): boolean {
  if (!(error instanceof RevenueCatApiError)) return false;

  if (
    error.kind === 'temporary' ||
    error.kind === 'invalid_response' ||
    error.kind === 'not_found'
  ) {
    logWarn(SCOPE, 'revenuecat_api_temporary_failure', {
      ...context,
      failureKind: error.kind,
      upstreamStatus: error.statusCode,
    });
    res.status(503).json({ error: 'revenuecat_api_temporary_failure' });
    return true;
  }

  logFunctionError(SCOPE, new Error('RevenueCat API operational configuration failure'), {
    ...context,
    failureKind: error.kind,
    upstreamStatus: error.statusCode,
  });
  res.status(500).json({ error: 'revenuecat_api_configuration_error' });
  return true;
}

async function resolveWebhookIdentity(
  input: {
    directAppUserId?: string | null;
    originalAppUserId?: string | null;
    aliases?: readonly string[];
    lookupIds?: readonly string[];
    allowPayloadFastPath?: boolean;
  },
  identityApi?: RevenueCatIdentityApi,
): Promise<RevenueCatIdentityResolution> {
  return resolveRevenueCatFirebaseUid(input, {
    validFirebaseUserExists,
    // Lazy by design: the resolver never constructs the V2 client (or reads
    // its secret) when the direct Firebase UID fast path succeeds.
    getRevenueCatIdentityApi: identityApi ? () => identityApi : createRevenueCatV2Client,
  });
}

function transferEnvironment(value: unknown): RevenueCatSubscriptionEnvironment | undefined {
  if (value === 'PRODUCTION') return 'production';
  if (value === 'SANDBOX') return 'sandbox';
  return undefined;
}

function isRevenueCatAnonymousIdentifier(value: string): boolean {
  return value.trim().startsWith(RC_ANONYMOUS_ID_PREFIX);
}

async function reconcileTransferSide(
  side: TransferSide,
  identifiers: readonly string[],
  event: RawRevenueCatEvent,
  eventId: string,
  eventTimestampMs: number,
  revenueCatApi: ReturnType<typeof createRevenueCatV2Client>,
): Promise<TransferSideOutcome> {
  const eventType = 'TRANSFER';

  if (identifiers.length === 0) {
    logWarn(SCOPE, `transfer_${side}_unresolved`, {
      eventId,
      eventType,
      reason: side === 'source' ? 'missing_source' : 'missing_destination',
    });
    return { status: 'identity_unresolved' };
  }

  // A source containing only RevenueCat-generated anonymous IDs provides no
  // Firebase identity evidence of its own. Do not expand that historical
  // anonymous graph into a Firestore write target: `transferred_from` has no
  // signed custom App User ID to anchor the source user safely.
  if (side === 'source' && identifiers.every(isRevenueCatAnonymousIdentifier)) {
    logWarn(SCOPE, 'transfer_source_unresolved', {
      eventId,
      eventType,
      reason: 'anonymous_only',
    });
    return { status: 'identity_unresolved' };
  }

  const resolution = await resolveWebhookIdentity(
    {
      aliases: identifiers,
      lookupIds: identifiers,
      // Both sides need the exact RevenueCat customer resource. Always prove
      // the relationship through V2; payload-only resolution cannot safely
      // supply a customer_id for the subscriptions snapshot.
      allowPayloadFastPath: false,
    },
    revenueCatApi,
  );

  if (resolution.status === 'ambiguous') {
    logWarn(SCOPE, `transfer_${side}_ambiguous`, {
      eventId,
      eventType,
      phase: 'identity_resolution',
      candidateCount: resolution.candidateCount,
    });
    return { status: 'identity_ambiguous' };
  }

  if (resolution.status === 'unresolved') {
    logWarn(SCOPE, `transfer_${side}_unresolved`, {
      eventId,
      eventType,
      phase: 'identity_resolution',
    });
    return { status: 'identity_unresolved' };
  }

  const uid = resolution.uid;
  const maskedUid = maskRevenueCatIdentifier(uid);
  logInfo(SCOPE, `transfer_${side}_resolved`, {
    eventId,
    eventType,
    uid: maskedUid,
    identitySource: resolution.source,
  });

  if (resolution.customerIds.length !== 1) {
    logWarn(SCOPE, `transfer_${side}_ambiguous`, {
      eventId,
      eventType,
      phase: 'customer_resolution',
      uid: maskedUid,
      customerCandidateCount: resolution.customerIds.length,
    });
    return { status: 'reconciliation_ambiguous' };
  }

  logInfo(SCOPE, `transfer_${side}_reconciliation_started`, {
    eventId,
    eventType,
    uid: maskedUid,
  });

  const subscriptions = await revenueCatApi.getCustomerSubscriptions(
    resolution.customerIds[0],
    transferEnvironment(event.environment),
  );
  const reconciliation = reconcileRevenueCatPremiumSubscriptions(subscriptions);

  if (reconciliation.status === 'ambiguous') {
    logWarn(SCOPE, `transfer_${side}_ambiguous`, {
      eventId,
      eventType,
      phase: 'subscription_reconciliation',
      uid: maskedUid,
      activeCandidateCount: reconciliation.activeCandidateCount,
    });
    return { status: 'reconciliation_ambiguous' };
  }

  const validation = validateSubscriptionPayload(reconciliation.subscription);
  if (!validation.ok) {
    logFunctionError(SCOPE, new Error(validation.error), {
      eventId,
      eventType,
      uid: maskedUid,
      operation: `transfer_${side}_reconciliation_normalization`,
    });
    return { status: 'normalization_failed' };
  }

  const result = await applySubscriptionEventAtomically(
    uid,
    eventId,
    eventTimestampMs,
    validation.data,
    { replaceSubscription: true },
  );

  switch (result.status) {
    case 'processed':
      logInfo(
        SCOPE,
        reconciliation.status === 'active'
          ? `transfer_${side}_reconciliation_succeeded`
          : `transfer_${side}_reconciliation_no_active_subscription`,
        { eventId, eventType, uid: maskedUid, reconciliation: reconciliation.status },
      );
      break;
    case 'duplicate':
      logInfo(SCOPE, `transfer_${side}_reconciliation_duplicate`, {
        eventId,
        eventType,
        uid: maskedUid,
      });
      break;
    case 'stale':
      logInfo(SCOPE, `transfer_${side}_reconciliation_stale`, {
        eventId,
        eventType,
        uid: maskedUid,
      });
      break;
    case 'conflict':
      logInfo(SCOPE, `transfer_${side}_reconciliation_conflict`, {
        eventId,
        eventType,
        uid: maskedUid,
      });
      break;
    case 'user_not_found':
      logWarn(SCOPE, `transfer_${side}_unresolved`, {
        eventId,
        eventType,
        uid: maskedUid,
        reason: 'user_deleted_before_transaction',
      });
      break;
  }

  return { status: result.status, reconciliation: reconciliation.status };
}

function respondWithTransferDestinationOutcome(
  outcome: TransferSideOutcome,
  res: Response,
): void {
  switch (outcome.status) {
    case 'processed':
      res.status(200).json({ status: 'processed', reconciliation: outcome.reconciliation });
      return;
    case 'duplicate':
    case 'stale':
    case 'conflict':
      res.status(200).json({ status: outcome.status });
      return;
    case 'identity_unresolved':
    case 'user_not_found':
      res.status(200).json({ status: 'ignored', reason: 'identity_unresolved' });
      return;
    case 'identity_ambiguous':
      res.status(200).json({ status: 'ignored', reason: 'identity_ambiguous' });
      return;
    case 'reconciliation_ambiguous':
      res.status(200).json({ status: 'ignored', reason: 'transfer_reconciliation_ambiguous' });
      return;
    case 'normalization_failed':
      res.status(500).json({ error: 'normalization_failed' });
      return;
  }
}

function destinationAllowsSourceReconciliation(outcome: TransferSideOutcome): boolean {
  return (
    outcome.status === 'processed' ||
    outcome.status === 'duplicate' ||
    outcome.status === 'stale' ||
    outcome.status === 'conflict'
  );
}

async function handleTransferEvent(
  event: RawRevenueCatEvent,
  eventId: string,
  res: Response,
): Promise<void> {
  const eventType = 'TRANSFER';
  const transferredFrom = stringArray(event.transferred_from);
  const transferredTo = stringArray(event.transferred_to);
  logInfo(SCOPE, 'transfer_received', {
    eventId,
    eventType,
    transferredFromCount: transferredFrom.length,
    transferredToCount: transferredTo.length,
  });

  if (transferredTo.length === 0) {
    logWarn(SCOPE, 'transfer_reconciliation_unresolved', {
      eventId,
      eventType,
      reason: 'missing_destination',
    });
    res.status(200).json({ status: 'ignored', reason: 'identity_unresolved' });
    return;
  }

  const eventTimestampMs = extractEventTimestampMs(event);
  if (eventTimestampMs === null) {
    logWarn(SCOPE, 'rejected webhook: missing or invalid event_timestamp_ms', {
      eventId,
      eventType,
    });
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  let revenueCatApi: ReturnType<typeof createRevenueCatV2Client>;
  try {
    revenueCatApi = createRevenueCatV2Client();
  } catch (err) {
    if (respondToRevenueCatApiFailure(err, res, { eventId, eventType })) return;
    logFunctionError(SCOPE, err, { eventId, eventType, operation: 'transfer_api_initialization' });
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  let destinationOutcome: TransferSideOutcome;
  try {
    destinationOutcome = await reconcileTransferSide(
      'destination',
      transferredTo,
      event,
      eventId,
      eventTimestampMs,
      revenueCatApi,
    );
  } catch (err) {
    if (err instanceof RevenueCatApiError) {
      logWarn(SCOPE, 'transfer_destination_reconciliation_api_failure', {
        eventId,
        eventType,
        failureKind: err.kind,
        upstreamStatus: err.statusCode,
      });
    }
    if (respondToRevenueCatApiFailure(err, res, { eventId, eventType, transferSide: 'destination' })) {
      return;
    }
    logFunctionError(SCOPE, err, {
      eventId,
      eventType,
      operation: 'transfer_destination_reconciliation',
    });
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  if (!destinationAllowsSourceReconciliation(destinationOutcome)) {
    respondWithTransferDestinationOutcome(destinationOutcome, res);
    return;
  }

  let sourceOutcome: TransferSideOutcome;
  try {
    sourceOutcome = await reconcileTransferSide(
      'source',
      transferredFrom,
      event,
      eventId,
      eventTimestampMs,
      revenueCatApi,
    );
  } catch (err) {
    if (err instanceof RevenueCatApiError) {
      logWarn(SCOPE, 'transfer_source_reconciliation_api_failure', {
        eventId,
        eventType,
        failureKind: err.kind,
        upstreamStatus: err.statusCode,
      });
    }
    // Destination reconciliation already reached an idempotent terminal
    // outcome. A retry safely observes it as duplicate/stale and gets another
    // chance to complete a temporarily failing, but otherwise valid, source.
    if (respondToRevenueCatApiFailure(err, res, { eventId, eventType, transferSide: 'source' })) {
      return;
    }
    logFunctionError(SCOPE, err, {
      eventId,
      eventType,
      operation: 'transfer_source_reconciliation',
    });
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  if (sourceOutcome.status === 'normalization_failed') {
    res.status(500).json({ error: 'normalization_failed' });
    return;
  }

  logInfo(SCOPE, 'transfer_reconciliation_completed', {
    eventId,
    eventType,
    destinationStatus: destinationOutcome.status,
    sourceStatus: sourceOutcome.status,
  });
  respondWithTransferDestinationOutcome(destinationOutcome, res);
}

function isSupportedEventType(type: string): type is SupportedRevenueCatWebhookEventType {
  return (SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Extracts and validates `event_timestamp_ms` — RevenueCat's own clock for
 * when the event happened (docs' "Always Present" field per RevenueCat's
 * webhook docs) — as a positive integer. Returns `null` for anything else
 * (missing, non-number, non-integer, zero/negative).
 *
 * Sprint 4.1 (see the Sprint 4 audit report): this value is what
 * `applySubscriptionEventAtomically` compares against the stored
 * `lastEventTimestampMs` to detect out-of-order delivery — it must be
 * RevenueCat's own event clock, never a substitute. Deliberately NOT using
 * `req`/request-arrival time or `Date.now()`: those measure when WE saw the
 * event, not when it happened, which is exactly the distinction that made
 * `updatedAt` unusable for ordering in the first place (see
 * `SubscriptionMirror.lastEventTimestampMs`'s doc comment, types.ts).
 */
export function extractEventTimestampMs(event: RawRevenueCatEvent): number | null {
  const value = event.event_timestamp_ms;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/** RevenueCat's transaction purchase time; never replaced with webhook arrival time. */
export function extractPurchaseTimestampMs(event: RawRevenueCatEvent): number | null {
  const value = event.purchased_at_ms;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Maps event type + period type into one of the 5 official statuses
 * (docs §12). A commercial/business signal only — never used for access
 * decisions (that's `entitlementActive`, computed independently in
 * `normalizeSubscription`).
 *
 * Exhaustive switch over `SupportedRevenueCatWebhookEventType` (no
 * `default`): if a new event type is ever added to
 * `SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES`, TypeScript will fail to
 * compile this function until a case is added here — intentional, so status
 * mapping can never silently miss a newly-supported event type.
 */
export function mapRevenueCatStatus(
  eventType: SupportedRevenueCatWebhookEventType,
  periodType: string | undefined,
): SubscriptionStatus {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
      return periodType === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
    case 'PRODUCT_CHANGE':
      // A plan change (monthly ⇄ annual) implies an existing, still-active
      // subscription — RevenueCat doesn't ship a "status" concept for this
      // event, so ACTIVE is the correct default given entitlementActive is
      // independently computed and remains the real authorization signal.
      return 'ACTIVE';
    case 'CANCELLATION':
      // Auto-renewal turned off (or a refund) — NOT immediate access
      // revocation (docs §16; confirmed against RevenueCat's own docs, which
      // explicitly say access should only be revoked on EXPIRATION).
      // `entitlementActive` independently reflects whether access remains
      // until `currentPeriodEndsAt`.
      return 'CANCELED';
    case 'BILLING_ISSUE':
      return 'BILLING_ISSUE';
    case 'EXPIRATION':
      return 'EXPIRED';
  }
}

/**
 * Normalizes a raw RevenueCat webhook event into a `SubscriptionMirror`
 * partial (docs §26), ready for `validateSubscriptionPayload`
 * (subscriptionSync.ts). Only ever called for `SUPPORTED_*` event types —
 * `handleRevenueCatWebhook` filters unsupported types out first.
 *
 * KEY NORMALIZATION DECISIONS (docs §26 field-by-field):
 *
 * - `entitlementActive` — THE authorization signal (docs §10/§11). Derived,
 *   never trusted from a boolean field (RevenueCat's webhook payload doesn't
 *   have one): true iff (a) `entitlement_ids` includes `"premium"` AND
 *   (b) the effective expiry (grace period if present, else
 *   `expiration_at_ms`) is still in the future relative to the event, AND
 *   (c) the event isn't `EXPIRATION` (trusted as the authoritative "this is
 *   over" signal even over a timestamp edge case).
 * - `startedAt` — set ONLY on `INITIAL_PURCHASE`. RevenueCat's
 *   `purchased_at_ms` is the CURRENT billing period's start on every other
 *   event type (it advances every renewal — confirmed against RevenueCat's
 *   docs), so writing it on a `RENEWAL` would make "when did this
 *   subscription first start" drift forward every cycle. Omitted (not
 *   included in the returned partial) on every other event type, so
 *   `applySubscriptionEventAtomically`'s merge leaves the previously-stored
 *   value untouched.
 * - `lastRenewedAt` — set only on `RENEWAL`, using `event_timestamp_ms`.
 * - `canceledAt` — set on `CANCELLATION` (using `event_timestamp_ms`;
 *   RevenueCat's webhook payload has no separate "canceled at" field
 *   distinct from when the event fired), and explicitly CLEARED (`null`) on
 *   `INITIAL_PURCHASE`/`RENEWAL` — both prove auto-renewal is currently on
 *   and successfully charged, so a leftover cancellation timestamp from a
 *   previous cycle would otherwise survive forever (`merge:true` never
 *   erases a field that isn't explicitly included in the write).
 * - `trialEndsAt` — set only when `period_type === "TRIAL"`; left untouched
 *   (omitted) once a trial converts, so the historical trial-end date is
 *   preserved rather than erased (useful for the "trial convertido" §24
 *   analytics field).
 * - `currentPeriodEndsAt` — the effective expiry described above, on every
 *   event (grace-period-aware, per docs §17).
 * - `productId` — `product_id`, except on `PRODUCT_CHANGE` where it's
 *   `new_product_id` (the product the subscriber switched TO — confirmed via
 *   RevenueCat's docs that `product_id` on that event type is the OLD
 *   product), falling back to `product_id` if `new_product_id` is absent
 *   (RevenueCat omits it for some immediate Google Play changes).
 *
 * Sprint 4.1: no longer sets `lastEventId` (or any `lastEventTimestampMs`) —
 * both are now set exclusively by `applySubscriptionEventAtomically`'s
 * transaction, which needs `eventId`/`eventTimestampMs` as explicit
 * parameters anyway to make its duplicate/stale/conflict decision. `eventTimestampMs`
 * must be extracted and validated by the CALLER (see
 * `extractEventTimestampMs`) — this function no longer falls back to
 * `Date.now()` for it, since that would defeat the entire point of ordering
 * by RevenueCat's own clock (see the Sprint 4 audit report).
 */
export function normalizeSubscription(
  event: RawRevenueCatEvent,
  eventType: SupportedRevenueCatWebhookEventType,
  eventTimestampMs: number,
): Partial<SubscriptionMirror> {
  const expirationAtMs = typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null;
  const gracePeriodExpirationAtMs =
    typeof event.grace_period_expiration_at_ms === 'number'
      ? event.grace_period_expiration_at_ms
      : null;
  const effectiveExpiryMs = gracePeriodExpirationAtMs ?? expirationAtMs;

  const entitlementIds = Array.isArray(event.entitlement_ids)
    ? event.entitlement_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const concernsPremium = entitlementIds.includes(PREMIUM_ENTITLEMENT_ID);
  if (!concernsPremium) {
    logWarn(SCOPE, 'webhook event does not reference the premium entitlement', {
      eventType,
      entitlementIds,
    });
  }

  const entitlementActive =
    concernsPremium &&
    eventType !== 'EXPIRATION' &&
    (effectiveExpiryMs === null || effectiveExpiryMs > eventTimestampMs);

  const periodType = typeof event.period_type === 'string' ? event.period_type : undefined;

  const partial: Partial<SubscriptionMirror> = {
    status: mapRevenueCatStatus(eventType, periodType),
    entitlementActive,
    provider: REVENUECAT_PROVIDER,
    currentPeriodEndsAt: effectiveExpiryMs !== null ? Timestamp.fromMillis(effectiveExpiryMs) : null,
  };

  const productId =
    eventType === 'PRODUCT_CHANGE'
      ? typeof event.new_product_id === 'string'
        ? event.new_product_id
        : typeof event.product_id === 'string'
          ? event.product_id
          : undefined
      : typeof event.product_id === 'string'
        ? event.product_id
        : undefined;
  if (productId) partial.productId = productId;

  if (
    typeof event.store === 'string' &&
    (SUBSCRIPTION_STORES as readonly string[]).includes(event.store)
  ) {
    partial.store = event.store as SubscriptionStore;
  }

  if (eventType === 'INITIAL_PURCHASE') {
    partial.startedAt = Timestamp.fromMillis(eventTimestampMs);
  }

  if (periodType === 'TRIAL' && effectiveExpiryMs !== null) {
    partial.trialEndsAt = Timestamp.fromMillis(effectiveExpiryMs);
  }

  if (eventType === 'CANCELLATION') {
    partial.canceledAt = Timestamp.fromMillis(eventTimestampMs);
  }

  if (eventType === 'RENEWAL') {
    partial.lastRenewedAt = Timestamp.fromMillis(eventTimestampMs);
    // A successful renewal can only happen with auto-renewal ON, so any
    // earlier CANCELLATION no longer applies — clear it, otherwise it stays
    // stuck at the old timestamp forever (merge:true never erases a field
    // that isn't explicitly included), making an ACTIVE, renewing
    // subscription look like it's still canceled to anyone reading the
    // mirror (audit finding, Sprint 4 robustness review).
    partial.canceledAt = null;
  }

  if (eventType === 'INITIAL_PURCHASE') {
    // Same reasoning as RENEWAL above: a brand-new purchase (first-ever or a
    // fresh resubscription after a full lapse) starts a new lifecycle with
    // no cancellation in effect — a leftover `canceledAt` from a previous
    // cycle must not survive into this one.
    partial.canceledAt = null;
  }

  return partial;
}

/**
 * FASE 4B helpers — deliberately standalone, NOT extracted from/shared with
 * `normalizeSubscription`'s own inline equivalents. `normalizeSubscription`
 * is covered by an extensive existing test suite
 * (`__tests__/normalizeSubscription.test.ts`); refactoring its internals to
 * share code with a brand-new call site would risk that suite for a change
 * that isn't otherwise necessary — a few duplicated lines is the smaller,
 * safer diff here.
 */
function eventConcernsPremiumEntitlement(event: RawRevenueCatEvent): boolean {
  const entitlementIds = Array.isArray(event.entitlement_ids)
    ? event.entitlement_ids.filter((id): id is string => typeof id === 'string')
    : [];
  return entitlementIds.includes(PREMIUM_ENTITLEMENT_ID);
}

function extractPeriodType(event: RawRevenueCatEvent): string | undefined {
  return typeof event.period_type === 'string' ? event.period_type : undefined;
}

/** FASE 4C.3A — same standalone-duplication rationale as the helpers above. */
function extractStore(event: RawRevenueCatEvent): string | undefined {
  return typeof event.store === 'string' ? event.store : undefined;
}

function extractProductId(event: RawRevenueCatEvent): string | undefined {
  return typeof event.product_id === 'string' ? event.product_id : undefined;
}

/**
 * `null` (the store explicitly reported no offer) and `undefined` (the
 * field is absent/malformed) are BOTH valid, distinct raw outcomes here —
 * `attribution/googlePlayOfferCorrelation.ts`'s `correlateGooglePlayOffer`
 * treats them identically (no proof of an offer), but this function still
 * reports what was actually on the wire rather than collapsing it early.
 */
function extractOfferCode(event: RawRevenueCatEvent): string | null | undefined {
  if (event.offer_code === null) return null;
  return typeof event.offer_code === 'string' ? event.offer_code : undefined;
}

/**
 * FASE 4B.1 — typed, explicit outcome of one attribution-confirmation
 * attempt from the webhook's point of view. `not_applicable`/`confirmed`/
 * `skipped` are all NORMAL results (never represented as exceptions);
 * `temporary_failure` is the only one that should make the webhook
 * response retryable — see `respondConsideringAttribution`.
 */
type PromoCodeAttributionWebhookOutcome =
  | { status: 'not_applicable' }
  | { status: 'confirmed' }
  | { status: 'skipped'; reason: AttributionConfirmationSkipReason }
  | { status: 'temporary_failure' };

/**
 * FASE 4B entry point. Called by `respondConsideringAttribution` for
 * billing outcomes `processed`, `duplicate`, and `stale` (FASE 4B.1 — see
 * this file's top doc comment for why `duplicate`/`stale` were added and
 * why that's safe).
 *
 * Scope, per the Fase 4B rules:
 * - Only `INITIAL_PURCHASE`/`RENEWAL` — never `CANCELLATION`/`EXPIRATION`/
 *   `BILLING_ISSUE`/`PRODUCT_CHANGE` (rule 7: no additional metrics yet)
 *   and never `TRANSFER` (handled entirely separately by
 *   `handleTransferEvent`, which never calls this — rule 5: attribution is
 *   never moved/created/copied on transfer).
 * - Only when the event concerns the `premium` entitlement — an event for
 *   an unrelated product/entitlement must never lock/confirm a promo-code
 *   attribution.
 *
 * FASE 4B.1: a thrown error from `applyAttributionRevenueCatEvent` (a real
 * infrastructure/transaction failure) is caught here and turned into
 * `{ status: 'temporary_failure' }` — no longer swallowed. It is the
 * CALLER's (`respondConsideringAttribution`'s) job to turn that into a
 * retryable HTTP response; this function never touches `res` itself.
 */
async function confirmPromoCodeAttributionIfApplicable(
  event: RawRevenueCatEvent,
  eventType: SupportedRevenueCatWebhookEventType,
  eventId: string,
  uid: string,
  maskedUid: string,
  eventTimestampMs: number,
): Promise<PromoCodeAttributionWebhookOutcome> {
  if (eventType !== 'INITIAL_PURCHASE' && eventType !== 'RENEWAL') {
    return { status: 'not_applicable' };
  }
  if (!eventConcernsPremiumEntitlement(event)) {
    return { status: 'not_applicable' };
  }

  try {
    const result =
      eventType === 'INITIAL_PURCHASE'
        ? await applyAttributionRevenueCatEvent(uid, {
            eventType: 'INITIAL_PURCHASE',
            eventTimestampMs,
            eventId,
            purchasedAtMs: extractPurchaseTimestampMs(event),
            periodType: extractPeriodType(event),
            store: extractStore(event),
            productId: extractProductId(event),
            offerCode: extractOfferCode(event),
          })
        : await applyAttributionRevenueCatEvent(uid, {
            eventType: 'RENEWAL',
            eventTimestampMs,
            isTrialConversion: event.is_trial_conversion === true,
          });

    if (result.status === 'confirmed') {
      logInfo(SCOPE, 'attribution_confirmed', { eventId, eventType, uid: maskedUid });
      return { status: 'confirmed' };
    }

    logInfo(SCOPE, 'attribution_confirmation_skipped', {
      eventId,
      eventType,
      uid: maskedUid,
      reason: result.reason,
    });
    return { status: 'skipped', reason: result.reason };
  } catch (err) {
    logFunctionError(SCOPE, err, {
      eventId,
      eventType,
      uid: maskedUid,
      operation: 'attribution_confirmation',
    });
    return { status: 'temporary_failure' };
  }
}

/**
 * FASE 4B.1 — shared response path for the three billing outcomes that now
 * also evaluate attribution (`processed`/`duplicate`/`stale`). Attribution
 * being `not_applicable`/`confirmed`/`skipped` (all normal) never changes
 * the response the billing outcome alone would have produced. Only
 * `temporary_failure` overrides it, with `503` — signaling RevenueCat to
 * retry so attribution gets another chance, without re-litigating billing
 * (which already reached a terminal, correct state for this delivery).
 */
async function respondConsideringAttribution(
  res: Response,
  billingStatus: 'processed' | 'duplicate' | 'stale',
  event: RawRevenueCatEvent,
  eventType: SupportedRevenueCatWebhookEventType,
  eventId: string,
  uid: string,
  maskedUid: string,
  eventTimestampMs: number,
): Promise<void> {
  const attribution = await confirmPromoCodeAttributionIfApplicable(
    event,
    eventType,
    eventId,
    uid,
    maskedUid,
    eventTimestampMs,
  );

  if (attribution.status === 'temporary_failure') {
    res.status(503).json({ error: 'attribution_temporary_failure' });
    return;
  }

  res.status(200).json({ status: billingStatus });
}

/**
 * HTTP entry point for the RevenueCat webhook (docs §25/§28). Wired as the
 * `revenueCatWebhook` Cloud Function in index.ts.
 *
 * FULL FLOW: signature → envelope/id/type → TRANSFER identity handling or
 * supported commercial type → `app_user_id` → `event_timestamp_ms` →
 * direct/alias-aware identity resolution → normalize → validate →
 * `applySubscriptionEventAtomically` (which itself does the
 * duplicate/stale/conflict decision, atomically, as one transaction — see
 * that function's doc comment, subscriptionSync.ts). Every early return is
 * a deliberate "don't process, but tell RevenueCat what happened" decision —
 * see the inline comments for why each one uses the HTTP status it does.
 *
 * ERROR HANDLING: no exception ever escapes this function uncaught —
 * RevenueCat retries on any non-200 (5 times, 5–80 min backoff), so a
 * genuinely transient failure (e.g. a Firestore/transaction hiccup) SHOULD
 * return 5xx to get retried, while a permanent condition (bad signature,
 * malformed payload, unknown uid, duplicate/stale/conflicting event) returns
 * a 2xx/4xx that RevenueCat won't usefully retry — retrying those would just
 * repeat the same outcome.
 */
export async function handleRevenueCatWebhook(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const signatureHeader = req.get(SIGNATURE_HEADER);
  if (!isValidWebhookSignature(req.rawBody, signatureHeader, REVENUECAT_WEBHOOK_SECRET.value())) {
    // Invalid/missing signature: could be a misconfigured secret or an
    // actual forged request. Either way, nothing about the body is
    // processed or even parsed — matches the Sprint 4 requirement literally
    // ("nenhum processamento deve ocorrer").
    logWarn(SCOPE, 'rejected webhook: invalid or missing signature');
    res.status(401).json({ error: 'invalid_signature' });
    return;
  }

  const envelope = req.body as { event?: unknown } | null | undefined;
  const event = envelope?.event as RawRevenueCatEvent | undefined;
  const eventId = typeof event?.id === 'string' ? event.id : null;
  const eventType = typeof event?.type === 'string' ? event.type : null;

  if (!event || !eventId || !eventType) {
    logWarn(SCOPE, 'rejected webhook: invalid payload', {
      hasEvent: !!event,
      hasEventId: !!eventId,
      hasEventType: !!eventType,
    });
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  logInfo(SCOPE, 'webhook event received', { eventId, eventType });

  if (eventType === 'TRANSFER') {
    await handleTransferEvent(event, eventId, res);
    return;
  }

  if (!isSupportedEventType(eventType)) {
    // Recognized-but-unhandled (currently UNCANCELLATION) and truly unknown
    // future event types both land here. TRANSFER is handled above as a
    // separate identity-only signal.
    logInfo(SCOPE, 'event ignored: unsupported event type', { eventId, eventType });
    res.status(200).json({ status: 'ignored', reason: 'unsupported_event_type' });
    return;
  }

  // Only commercial event types normalized by this backend require
  // app_user_id. TRANSFER uses transferred_from/transferred_to and has
  // already taken its separate path above.
  const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id : null;
  if (!appUserId) {
    logWarn(SCOPE, 'rejected webhook: invalid payload', {
      hasEvent: true,
      hasEventId: true,
      hasEventType: true,
      hasAppUserId: false,
    });
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  // Sprint 4.1: required for every SUPPORTED event from here on — this is
  // the ordering key `applySubscriptionEventAtomically` depends on.
  // Missing/invalid is a permanent payload defect (retrying won't produce a
  // valid timestamp), so this is a 400, not a 5xx — consistent with the
  // other payload-shape checks above.
  const eventTimestampMs = extractEventTimestampMs(event);
  if (eventTimestampMs === null) {
    logWarn(SCOPE, 'rejected webhook: missing or invalid event_timestamp_ms', {
      eventId,
      eventType,
    });
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  let identity: RevenueCatIdentityResolution;
  try {
    identity = await resolveWebhookIdentity({
      directAppUserId: appUserId,
      originalAppUserId:
        typeof event.original_app_user_id === 'string' ? event.original_app_user_id : null,
      aliases: stringArray(event.aliases),
      lookupIds: [appUserId],
    });
  } catch (err) {
    if (respondToRevenueCatApiFailure(err, res, { eventId, eventType })) return;
    logFunctionError(SCOPE, err, { eventId, eventType, operation: 'identity_resolution' });
    res.status(500).json({ error: 'internal_error' });
    return;
  }

  if (identity.status === 'ambiguous') {
    logWarn(SCOPE, 'identity_ambiguous', {
      eventId,
      eventType,
      candidateCount: identity.candidateCount,
    });
    res.status(200).json({ status: 'ignored', reason: 'identity_ambiguous' });
    return;
  }

  if (identity.status === 'unresolved') {
    logWarn(SCOPE, 'identity_unresolved', {
      eventId,
      eventType,
      appUserId: maskRevenueCatIdentifier(appUserId),
    });
    res.status(200).json({ status: 'ignored', reason: 'identity_unresolved' });
    return;
  }

  const uid = identity.uid;
  const maskedUid = maskRevenueCatIdentifier(uid);
  logInfo(
    SCOPE,
    identity.source === 'direct' ? 'identity_direct_match' : 'identity_resolved_via_revenuecat',
    { eventId, eventType, uid: maskedUid, identitySource: identity.source },
  );

  try {
    const partial = normalizeSubscription(event, eventType, eventTimestampMs);
    const validation = validateSubscriptionPayload(partial);
    if (!validation.ok) {
      // Our own normalization produced something `validateSubscriptionPayload`
      // rejects — a bug in this module, not bad external input (the raw
      // event fields were already read defensively above). 500 so it's
      // retried and surfaced, since retrying an identical bug won't help by
      // itself but silently dropping it would lose the event entirely.
      logFunctionError(SCOPE, new Error(validation.error), { eventId, eventType, uid: maskedUid });
      res.status(500).json({ error: 'normalization_failed' });
      return;
    }

    const result = await applySubscriptionEventAtomically(
      uid,
      eventId,
      eventTimestampMs,
      validation.data,
    );

    switch (result.status) {
      case 'processed':
        logInfo(SCOPE, 'subscription updated from webhook event', {
          eventId,
          eventType,
          uid: maskedUid,
        });
        await respondConsideringAttribution(
          res,
          'processed',
          event,
          eventType,
          eventId,
          uid,
          maskedUid,
          eventTimestampMs,
        );
        return;
      case 'duplicate':
        // Already logged (as a warning, with full context) inside the
        // transaction — no need to duplicate that here. FASE 4B.1: billing
        // being a duplicate does NOT mean attribution has already had its
        // chance — see this file's top doc comment.
        logInfo(SCOPE, 'event ignored: duplicate (already applied)', {
          eventId,
          eventType,
          uid: maskedUid,
        });
        await respondConsideringAttribution(
          res,
          'duplicate',
          event,
          eventType,
          eventId,
          uid,
          maskedUid,
          eventTimestampMs,
        );
        return;
      case 'stale':
        logInfo(SCOPE, 'event ignored: stale (older than last applied event)', {
          eventId,
          eventType,
          uid: maskedUid,
        });
        // FASE 4B.1: a `stale` billing delivery can still be the ONLY
        // INITIAL_PURCHASE/RENEWAL attribution has ever seen for this uid
        // (e.g. it arrived after a chronologically later RENEWAL already
        // won the billing mirror's ordering race) — attribution's own
        // write-once fields make evaluating it here safe. See this file's
        // top doc comment and `attributionSync.ts`'s doc comment on
        // `applyAttributionRevenueCatEvent`.
        await respondConsideringAttribution(
          res,
          'stale',
          event,
          eventType,
          eventId,
          uid,
          maskedUid,
          eventTimestampMs,
        );
        return;
      case 'conflict':
        // Already logged as a structured error (with full context) inside
        // the transaction. Still HTTP 200: reprocessing this exact event
        // again would hit the exact same ambiguity — retrying is not
        // useful, and this needs human investigation, not automatic retry.
        logInfo(SCOPE, 'event ignored: conflict (see structured error log above)', {
          eventId,
          eventType,
          uid: maskedUid,
        });
        res.status(200).json({ status: 'conflict' });
        return;
      case 'user_not_found':
        logWarn(SCOPE, 'identity_unresolved', {
          eventId,
          eventType,
          uid: maskedUid,
          reason: 'user_deleted_before_transaction',
        });
        res.status(200).json({ status: 'ignored', reason: 'identity_unresolved' });
        return;
    }
  } catch (err) {
    logFunctionError(SCOPE, err, { eventId, eventType, uid: maskedUid });
    res.status(500).json({ error: 'internal_error' });
  }
}
