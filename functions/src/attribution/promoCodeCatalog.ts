import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError } from '../lib/logger';
import { PROMO_CODES_COLLECTION } from './constants';
import type { AndroidSubscriptionOfferConfig, PromoCodeDocument } from './types';

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
  'createdAt',
  'updatedAt',
  'createdBy',
  'notes',
] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableTimestamp(value: unknown): value is Timestamp | null {
  return value === null || value instanceof Timestamp;
}

/**
 * Strict, defensive parse of a raw Firestore document into a
 * `PromoCodeDocument` — rejects unknown fields and any field with the wrong
 * type/nullability, exactly like `validateSubscriptionPayload`
 * (billing/subscriptionSync.ts) does for the subscription mirror. A
 * malformed catalog document (e.g. hand-edited in the console with a typo)
 * must never be silently trusted; `lookupPromoCode` treats a parse failure
 * the same as "not found" and logs it for investigation.
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
