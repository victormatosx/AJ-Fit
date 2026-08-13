import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError } from '../lib/logger';
import { PROMO_CODES_COLLECTION } from './constants';
import type {
  AndroidSubscriptionOfferConfig,
  AppleOfferCorrelationConfig,
  IOSPromotionConfig,
  PromoCodeDocument,
} from './types';

/**
 * Firestore-facing read path for the promo-code catalog
 * (`promoCodes/{normalizedCode}`). No writer exists in this module — the
 * catalog is administered by a future admin surface, out of scope for this
 * change (docs/13 audit, "criação de códigos pelo app" explicitly excluded).
 */

const SCOPE = 'attribution:promoCodeCatalog';

const PROMO_CODE_DOCUMENT_KEYS = [
  'code',
  'active',
  'startsAt',
  'endsAt',
  'influencerId',
  'campaignId',
  'androidBasePlanIdMonthly',
  'androidOfferIdMonthly',
  'androidBasePlanIdAnnual',
  'androidOfferIdAnnual',
  'appleOfferCodeMonthly',
  'appleOfferCodeAnnual',
  // FASE iOS-6 — see `parsePromoCodeDocument`'s doc comment for why these
  // four are validated LENIENTLY (optional-on-read) unlike every other field
  // above, which remains strictly required.
  'appleProductIdMonthly',
  'appleOfferReferenceMonthly',
  'appleProductIdAnnual',
  'appleOfferReferenceAnnual',
  // FASE 1 — same optional-on-read leniency as the four fields above (see
  // `isOptionalNullableIOSPromotion`'s doc comment).
  'iosPromotion',
  'createdAt',
  'updatedAt',
  'createdBy',
  'notes',
] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * FASE iOS-6 — like `isNullableString`, but also accepts `undefined` (the
 * key being entirely absent from the document). Used ONLY for the four new
 * `appleProductId*`/`appleOfferReference*` fields, so that every
 * `promoCodes` document written before this phase — which lacks them
 * entirely — keeps parsing successfully instead of being rejected as
 * malformed (Parte 4 of the FASE iOS-6 audit: "não quebre leitura"). Every
 * OTHER field on `PromoCodeDocument` stays strictly required via
 * `isNullableString`/explicit type checks below — this leniency is
 * deliberately scoped to just these four keys, never a blanket relaxation.
 */
function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableTimestamp(value: unknown): value is Timestamp | null {
  return value === null || value instanceof Timestamp;
}

/**
 * FASE 1 — strict shape check for `IOSPromotionConfig`: exactly the three
 * required keys, each a non-empty string. No partial-pair leniency like
 * `resolveAndroidOfferPair`/`resolveAppleOfferCorrelationPair` (which
 * fail-close a two-field pair to `null`) — this is a THREE-field config with
 * no meaningful "some fields set" state (Parte 11 of the task spec:
 * `offeringIdentifier` covers both plans), so anything short of the complete
 * shape is treated as a malformed document, not a partial config.
 */
function isValidIOSPromotionShape(value: unknown): value is IOSPromotionConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  const expectedKeys = ['offeringIdentifier', 'monthlyProductId', 'annualProductId'];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((k) => keys.includes(k))) {
    return false;
  }
  return (
    typeof v.offeringIdentifier === 'string' &&
    v.offeringIdentifier.length > 0 &&
    typeof v.monthlyProductId === 'string' &&
    v.monthlyProductId.length > 0 &&
    typeof v.annualProductId === 'string' &&
    v.annualProductId.length > 0
  );
}

/**
 * FASE 1 — like `isOptionalNullableString`, but for the new `iosPromotion`
 * object: `undefined` (field entirely absent — every `promoCodes` document
 * written before this phase) and explicit `null` (campaign has no iOS
 * promotional configuration) both parse successfully; anything else must be
 * the exact `IOSPromotionConfig` shape or the WHOLE catalog document is
 * rejected as malformed (same strict policy `parsePromoCodeDocument` already
 * applies to every other required-shape field) — never a silently partial
 * authorization (docs Fase 1 §35).
 */
function isOptionalNullableIOSPromotion(
  value: unknown,
): value is IOSPromotionConfig | null | undefined {
  return value === undefined || value === null || isValidIOSPromotionShape(value);
}

/**
 * Strict, defensive parse of a raw Firestore document into a
 * `PromoCodeDocument` — rejects unknown fields and any field with the wrong
 * type/nullability, exactly like `validateSubscriptionPayload`
 * (billing/subscriptionSync.ts) does for the subscription mirror. A
 * malformed catalog document (e.g. hand-edited in the console with a typo)
 * must never be silently trusted; `lookupPromoCode` treats a parse failure
 * the same as "not found" and logs it for investigation.
 *
 * FASE iOS-6: `appleProductIdMonthly`/`appleOfferReferenceMonthly`/
 * `appleProductIdAnnual`/`appleOfferReferenceAnnual` are validated via
 * `isOptionalNullableString`, not `isNullableString` — every `promoCodes`
 * document written before this phase lacks these four keys entirely
 * (`undefined`, not `null`), and that MUST keep parsing successfully
 * (Parte 4, "não quebre leitura") rather than making every pre-existing
 * promo code (including `ARNALDO`'s already-working Android config) suddenly
 * fail catalog lookup. Every other field remains strictly required.
 */
export function parsePromoCodeDocument(data: unknown): PromoCodeDocument | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;

  const d = data as Record<string, unknown>;

  const unknownFields = Object.keys(d).filter(
    (key) => !(PROMO_CODE_DOCUMENT_KEYS as readonly string[]).includes(key),
  );
  if (unknownFields.length > 0) return null;

  if (
    typeof d.code !== 'string' ||
    typeof d.active !== 'boolean' ||
    !isNullableTimestamp(d.startsAt) ||
    !isNullableTimestamp(d.endsAt) ||
    typeof d.influencerId !== 'string' ||
    typeof d.campaignId !== 'string' ||
    !isNullableString(d.androidBasePlanIdMonthly) ||
    !isNullableString(d.androidOfferIdMonthly) ||
    !isNullableString(d.androidBasePlanIdAnnual) ||
    !isNullableString(d.androidOfferIdAnnual) ||
    !isNullableString(d.appleOfferCodeMonthly) ||
    !isNullableString(d.appleOfferCodeAnnual) ||
    !isOptionalNullableString(d.appleProductIdMonthly) ||
    !isOptionalNullableString(d.appleOfferReferenceMonthly) ||
    !isOptionalNullableString(d.appleProductIdAnnual) ||
    !isOptionalNullableString(d.appleOfferReferenceAnnual) ||
    !isOptionalNullableIOSPromotion(d.iosPromotion) ||
    !(d.createdAt instanceof Timestamp) ||
    !(d.updatedAt instanceof Timestamp) ||
    typeof d.createdBy !== 'string' ||
    !isNullableString(d.notes)
  ) {
    return null;
  }

  return {
    code: d.code,
    active: d.active,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    influencerId: d.influencerId,
    campaignId: d.campaignId,
    androidBasePlanIdMonthly: d.androidBasePlanIdMonthly,
    androidOfferIdMonthly: d.androidOfferIdMonthly,
    androidBasePlanIdAnnual: d.androidBasePlanIdAnnual,
    androidOfferIdAnnual: d.androidOfferIdAnnual,
    appleOfferCodeMonthly: d.appleOfferCodeMonthly,
    appleOfferCodeAnnual: d.appleOfferCodeAnnual,
    // FASE iOS-6 — `?? null` normalizes the `undefined` (key absent, a
    // pre-iOS-6 document) case to `null` for every consumer downstream;
    // `PromoCodeDocument`'s type never has `undefined` as a valid value.
    appleProductIdMonthly: (d.appleProductIdMonthly as string | null | undefined) ?? null,
    appleOfferReferenceMonthly: (d.appleOfferReferenceMonthly as string | null | undefined) ?? null,
    appleProductIdAnnual: (d.appleProductIdAnnual as string | null | undefined) ?? null,
    appleOfferReferenceAnnual: (d.appleOfferReferenceAnnual as string | null | undefined) ?? null,
    iosPromotion: (d.iosPromotion as IOSPromotionConfig | null | undefined) ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdBy: d.createdBy,
    notes: d.notes,
  };
}

/**
 * FASE 4C.1 — resolves one Android plan's `(basePlanId, offerId)` pair into
 * a complete, unambiguous `AndroidSubscriptionOfferConfig`, or `null`.
 *
 * FAIL-CLOSED POLICY for a partial pair (rule 4 of the Fase 4C.1 task): if
 * exactly one of the two fields is set and the other is `null` — a data
 * inconsistency (e.g. an admin typo, or a half-finished catalog edit) —
 * this returns `null` for the WHOLE plan rather than exposing the one field
 * that happens to be present. `validatePromoCode` must never construct a
 * `SubscriptionOption` id from only half of the identifying pair, and this
 * function never guesses/infers the missing half (e.g. never derives
 * `basePlanId` from `offerId`) — that would be fabricating store
 * configuration the backend was never actually told.
 */
export function resolveAndroidOfferPair(
  basePlanId: string | null,
  offerId: string | null,
): AndroidSubscriptionOfferConfig | null {
  if (basePlanId === null || offerId === null) return null;
  return { basePlanId, offerId };
}

/**
 * FASE iOS-6 — mirrors `resolveAndroidOfferPair`'s fail-closed partial-pair
 * policy for Apple: if exactly one of `productId`/`offerReference` is set
 * and the other is `null` (a data inconsistency — admin typo, or a
 * half-finished catalog edit), this returns `null` for the WHOLE plan
 * rather than exposing the one field that happens to be present.
 * `validatePromoCode.ts` must never construct an `AppleOfferCorrelationConfig`
 * from only half of the pair, and this function never guesses/infers the
 * missing half.
 */
export function resolveAppleOfferCorrelationPair(
  productId: string | null,
  offerReference: string | null,
): AppleOfferCorrelationConfig | null {
  if (productId === null || offerReference === null) return null;
  return { productId, offerReference };
}

export type PromoCodeLookupResult =
  | { status: 'found'; promoCode: PromoCodeDocument }
  | { status: 'not_found' };

/**
 * Direct `get()` by document ID — `normalizedCode` MUST already be the
 * output of `normalizePromoCode`. No query, no listing: this is the only
 * way any server-side code reads the catalog, and it's never exposed to the
 * client directly (see firestore.rules).
 */
export async function lookupPromoCode(normalizedCode: string): Promise<PromoCodeLookupResult> {
  const snapshot = await db.collection(PROMO_CODES_COLLECTION).doc(normalizedCode).get();
  if (!snapshot.exists) return { status: 'not_found' };

  const promoCode = parsePromoCodeDocument(snapshot.data());
  if (!promoCode) {
    logFunctionError(SCOPE, new Error('malformed promoCodes document'), {
      code: normalizedCode,
    });
    return { status: 'not_found' };
  }

  return { status: 'found', promoCode };
}
