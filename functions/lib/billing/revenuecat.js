"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVENUECAT_WEBHOOK_SECRET = void 0;
exports.isValidWebhookSignature = isValidWebhookSignature;
exports.extractEventTimestampMs = extractEventTimestampMs;
exports.mapRevenueCatStatus = mapRevenueCatStatus;
exports.normalizeSubscription = normalizeSubscription;
exports.handleRevenueCatWebhook = handleRevenueCatWebhook;
const crypto = __importStar(require("crypto"));
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const logger_1 = require("../lib/logger");
const constants_1 = require("./constants");
const subscriptionSync_1 = require("./subscriptionSync");
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
 */
const SCOPE = 'billing:revenuecat';
/**
 * Per-integration HMAC signing secret (RevenueCat dashboard → Project
 * settings → Webhooks → Signing secret). Resolved from Secret Manager at
 * runtime via `firebase-functions/params` — bound to the `revenueCatWebhook`
 * function in index.ts (`{ secrets: [REVENUECAT_WEBHOOK_SECRET] }`). Never
 * hardcoded, never committed. Set once with:
 *   firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
 */
exports.REVENUECAT_WEBHOOK_SECRET = (0, params_1.defineSecret)('REVENUECAT_WEBHOOK_SECRET');
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
function isValidWebhookSignature(rawBody, header, secret) {
    if (!header || !secret)
        return false;
    const fields = new Map();
    for (const part of header.split(',')) {
        const [key, value] = part.split('=');
        if (key && value)
            fields.set(key.trim(), value.trim());
    }
    const timestamp = fields.get('t');
    const signature = fields.get('v1');
    if (!timestamp || !signature)
        return false;
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds))
        return false;
    // Rejects both stale replays and (defensively) far-future timestamps.
    if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
        return false;
    }
    const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(signedPayload).digest('hex'), 'hex');
    const provided = Buffer.from(signature, 'hex');
    // Length check before timingSafeEqual: it throws on mismatched lengths
    // rather than returning false, and the length check itself leaks no
    // useful timing information (hex signature length is fixed-format).
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
function isSupportedEventType(type) {
    return constants_1.SUPPORTED_REVENUECAT_WEBHOOK_EVENT_TYPES.includes(type);
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
function extractEventTimestampMs(event) {
    const value = event.event_timestamp_ms;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return null;
    }
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
function mapRevenueCatStatus(eventType, periodType) {
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
function normalizeSubscription(event, eventType, eventTimestampMs) {
    const expirationAtMs = typeof event.expiration_at_ms === 'number' ? event.expiration_at_ms : null;
    const gracePeriodExpirationAtMs = typeof event.grace_period_expiration_at_ms === 'number'
        ? event.grace_period_expiration_at_ms
        : null;
    const effectiveExpiryMs = gracePeriodExpirationAtMs ?? expirationAtMs;
    const entitlementIds = Array.isArray(event.entitlement_ids)
        ? event.entitlement_ids.filter((id) => typeof id === 'string')
        : [];
    const concernsPremium = entitlementIds.includes(constants_1.PREMIUM_ENTITLEMENT_ID);
    if (!concernsPremium) {
        (0, logger_1.logWarn)(SCOPE, 'webhook event does not reference the premium entitlement', {
            eventType,
            entitlementIds,
        });
    }
    const entitlementActive = concernsPremium &&
        eventType !== 'EXPIRATION' &&
        (effectiveExpiryMs === null || effectiveExpiryMs > eventTimestampMs);
    const periodType = typeof event.period_type === 'string' ? event.period_type : undefined;
    const partial = {
        status: mapRevenueCatStatus(eventType, periodType),
        entitlementActive,
        provider: constants_1.REVENUECAT_PROVIDER,
        currentPeriodEndsAt: effectiveExpiryMs !== null ? firestore_1.Timestamp.fromMillis(effectiveExpiryMs) : null,
    };
    const productId = eventType === 'PRODUCT_CHANGE'
        ? typeof event.new_product_id === 'string'
            ? event.new_product_id
            : typeof event.product_id === 'string'
                ? event.product_id
                : undefined
        : typeof event.product_id === 'string'
            ? event.product_id
            : undefined;
    if (productId)
        partial.productId = productId;
    if (typeof event.store === 'string' &&
        constants_1.SUBSCRIPTION_STORES.includes(event.store)) {
        partial.store = event.store;
    }
    if (eventType === 'INITIAL_PURCHASE') {
        partial.startedAt = firestore_1.Timestamp.fromMillis(eventTimestampMs);
    }
    if (periodType === 'TRIAL' && effectiveExpiryMs !== null) {
        partial.trialEndsAt = firestore_1.Timestamp.fromMillis(effectiveExpiryMs);
    }
    if (eventType === 'CANCELLATION') {
        partial.canceledAt = firestore_1.Timestamp.fromMillis(eventTimestampMs);
    }
    if (eventType === 'RENEWAL') {
        partial.lastRenewedAt = firestore_1.Timestamp.fromMillis(eventTimestampMs);
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
 * HTTP entry point for the RevenueCat webhook (docs §25/§28). Wired as the
 * `revenueCatWebhook` Cloud Function in index.ts.
 *
 * FULL FLOW: signature → payload shape → supported event type →
 * `event_timestamp_ms` → resolve uid → user exists → normalize → validate →
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
async function handleRevenueCatWebhook(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
    }
    const signatureHeader = req.get(SIGNATURE_HEADER);
    if (!isValidWebhookSignature(req.rawBody, signatureHeader, exports.REVENUECAT_WEBHOOK_SECRET.value())) {
        // Invalid/missing signature: could be a misconfigured secret or an
        // actual forged request. Either way, nothing about the body is
        // processed or even parsed — matches the Sprint 4 requirement literally
        // ("nenhum processamento deve ocorrer").
        (0, logger_1.logWarn)(SCOPE, 'rejected webhook: invalid or missing signature');
        res.status(401).json({ error: 'invalid_signature' });
        return;
    }
    const envelope = req.body;
    const event = envelope?.event;
    const eventId = typeof event?.id === 'string' ? event.id : null;
    const eventType = typeof event?.type === 'string' ? event.type : null;
    const appUserId = typeof event?.app_user_id === 'string' ? event.app_user_id : null;
    if (!event || !eventId || !eventType || !appUserId) {
        (0, logger_1.logWarn)(SCOPE, 'rejected webhook: invalid payload', {
            hasEvent: !!event,
            hasEventId: !!eventId,
            hasEventType: !!eventType,
            hasAppUserId: !!appUserId,
        });
        res.status(400).json({ error: 'invalid_payload' });
        return;
    }
    (0, logger_1.logInfo)(SCOPE, 'webhook event received', { eventId, eventType });
    if (!isSupportedEventType(eventType)) {
        // Recognized-but-unhandled (UNCANCELLATION/TRANSFER) and truly unknown
        // future event types both land here — same treatment either way (docs
        // §25 processes a fixed list; anything else is logged and acknowledged,
        // never an error).
        (0, logger_1.logInfo)(SCOPE, 'event ignored: unsupported event type', { eventId, eventType });
        res.status(200).json({ status: 'ignored', reason: 'unsupported_event_type' });
        return;
    }
    // Sprint 4.1: required for every SUPPORTED event from here on — this is
    // the ordering key `applySubscriptionEventAtomically` depends on.
    // Missing/invalid is a permanent payload defect (retrying won't produce a
    // valid timestamp), so this is a 400, not a 5xx — consistent with the
    // other payload-shape checks above.
    const eventTimestampMs = extractEventTimestampMs(event);
    if (eventTimestampMs === null) {
        (0, logger_1.logWarn)(SCOPE, 'rejected webhook: missing or invalid event_timestamp_ms', {
            eventId,
            eventType,
        });
        res.status(400).json({ error: 'invalid_payload' });
        return;
    }
    const uid = (0, subscriptionSync_1.resolveUserIdFromAppUserId)(appUserId);
    if (!uid) {
        (0, logger_1.logWarn)(SCOPE, 'event ignored: unresolvable App User ID', { eventId, eventType });
        res.status(200).json({ status: 'ignored', reason: 'unresolvable_app_user_id' });
        return;
    }
    try {
        const exists = await (0, subscriptionSync_1.userExists)(uid);
        if (!exists) {
            // A permanently missing uid won't be fixed by a retry — ack with 200
            // rather than spending RevenueCat's retry budget on it. Policy
            // unchanged from Sprint 4 (documented in the Sprint 4 audit report as
            // an accepted, currently-unreachable edge case).
            (0, logger_1.logWarn)(SCOPE, 'event ignored: user does not exist', { eventId, eventType, uid });
            res.status(200).json({ status: 'ignored', reason: 'user_not_found' });
            return;
        }
        const partial = normalizeSubscription(event, eventType, eventTimestampMs);
        const validation = (0, subscriptionSync_1.validateSubscriptionPayload)(partial);
        if (!validation.ok) {
            // Our own normalization produced something `validateSubscriptionPayload`
            // rejects — a bug in this module, not bad external input (the raw
            // event fields were already read defensively above). 500 so it's
            // retried and surfaced, since retrying an identical bug won't help by
            // itself but silently dropping it would lose the event entirely.
            (0, logger_1.logFunctionError)(SCOPE, new Error(validation.error), { eventId, eventType, uid });
            res.status(500).json({ error: 'normalization_failed' });
            return;
        }
        const result = await (0, subscriptionSync_1.applySubscriptionEventAtomically)(uid, eventId, eventTimestampMs, validation.data);
        switch (result.status) {
            case 'processed':
                (0, logger_1.logInfo)(SCOPE, 'subscription updated from webhook event', { eventId, eventType, uid });
                res.status(200).json({ status: 'processed' });
                return;
            case 'duplicate':
                // Already logged (as a warning, with full context) inside the
                // transaction — no need to duplicate that here.
                (0, logger_1.logInfo)(SCOPE, 'event ignored: duplicate (already applied)', { eventId, eventType, uid });
                res.status(200).json({ status: 'duplicate' });
                return;
            case 'stale':
                (0, logger_1.logInfo)(SCOPE, 'event ignored: stale (older than last applied event)', {
                    eventId,
                    eventType,
                    uid,
                });
                res.status(200).json({ status: 'stale' });
                return;
            case 'conflict':
                // Already logged as a structured error (with full context) inside
                // the transaction. Still HTTP 200: reprocessing this exact event
                // again would hit the exact same ambiguity — retrying is not
                // useful, and this needs human investigation, not automatic retry.
                (0, logger_1.logInfo)(SCOPE, 'event ignored: conflict (see structured error log above)', {
                    eventId,
                    eventType,
                    uid,
                });
                res.status(200).json({ status: 'conflict' });
                return;
        }
    }
    catch (err) {
        (0, logger_1.logFunctionError)(SCOPE, err, { eventId, eventType, uid });
        res.status(500).json({ error: 'internal_error' });
    }
}
//# sourceMappingURL=revenuecat.js.map