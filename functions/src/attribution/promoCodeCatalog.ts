import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError } from '../lib/logger';
import { PROMO_CODES_COLLECTION } from './constants';
import type {
  AndroidSubscriptionOfferConfig,
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
  'internalName',
  'androidBasePlanIdMonthly',
  'androidOfferIdMonthly',
  // FASE 5.7 — optional-on-read for documents created before this phase.
  'androidOfferingIdentifierMonthly',
  'androidBasePlanIdAnnual',
  'androidOfferIdAnnual',
  // FASE 5.7 — optional-on-read for documents created before this phase.
  'androidOfferingIdentifierAnnual',
  // FASE 1 — optional-on-read for documents created before Promo SKU.
  'iosPromotion',
  'appleConfigurationConfirmedAt',
  'appleConfigurationConfirmedBy',
  'createdAt',
  'updatedAt',
  'createdBy',
  'notes',
] as const;

/**
 * Retired FASE 8 fields accepted only so historical Firestore documents do
 * not become malformed. They are never validated, returned, or used by the
 * active catalog model.
 */
const HISTORICAL_APPLE_OFFER_CODE_KEYS = [
  'appleOfferCodeMonthly',
  'appleOfferCodeAnnual',
  'appleProductIdMonthly',
  'appleOfferReferenceMonthly',
  'appleProductIdAnnual',
  'appleOfferReferenceAnnual',
] as const;

const ACCEPTED_PROMO_CODE_DOCUMENT_KEYS: readonly string[] = [
  ...PROMO_CODE_DOCUMENT_KEYS,
  ...HISTORICAL_APPLE_OFFER_CODE_KEYS,
];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableTimestamp(value: unknown): value is Timestamp | null {
  return value === null || value instanceof Timestamp;
}

/**
 * FASE 1 — strict shape check for `IOSPromotionConfig`: exactly the three
 * required keys, each a non-empty string. No partial-pair leniency like
 * `resolveAndroidOfferPair` (which fails closed to `null`) — this is a
 * THREE-field config with
 * no meaningful "some fields set" state (Parte 11 of the task spec:
 * `offeringIdentifier` covers both plans), so anything short of the complete
 * shape is treated as a malformed document, not a partial config.
 */
export function isValidIOSPromotionConfig(value: unknown): value is IOSPromotionConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  const expectedKeys = ['offeringIdentifier', 'monthlyProductId', 'annualProductId'];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((k) => keys.includes(k))) {
    return false;
  }
  return (
    typeof v.offeringIdentifier === 'string' &&
    v.offeringIdentifier.trim().length > 0 &&
    typeof v.monthlyProductId === 'string' &&
    v.monthlyProductId.trim().length > 0 &&
    typeof v.annualProductId === 'string' &&
    v.annualProductId.trim().length > 0
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
 * authorization (docs Fase 1 §35). The exported
 * `isValidIOSPromotionConfig` guard is reused by Fase 2 when reading the
 * snapshotted config from `couponRedemptions/{uid}`.
 */
function isOptionalNullableIOSPromotion(
  value: unknown,
): value is IOSPromotionConfig | null | undefined {
  return value === undefined || value === null || isValidIOSPromotionConfig(value);
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
 * FASE 8: the six retired Apple Offer Code keys are accepted as historical
 * extras but deliberately ignored. This preserves read compatibility with
 * existing Firestore data without keeping those fields in the active type.
 */
export function parsePromoCodeDocument(data: unknown): PromoCodeDocument | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;

  const d = data as Record<string, unknown>;

  const unknownFields = Object.keys(d).filter(
    (key) => !ACCEPTED_PROMO_CODE_DOCUMENT_KEYS.includes(key),
  );
  if (unknownFields.length > 0) return null;

  if (
    typeof d.code !== 'string' ||
    typeof d.active !== 'boolean' ||
    !isNullableTimestamp(d.startsAt) ||
    !isNullableTimestamp(d.endsAt) ||
    typeof d.influencerId !== 'string' ||
    typeof d.campaignId !== 'string' ||
    !(d.internalName === undefined || isNullableString(d.internalName)) ||
    !isNullableString(d.androidBasePlanIdMonthly) ||
    !isNullableString(d.androidOfferIdMonthly) ||
    !(d.androidOfferingIdentifierMonthly === undefined || isNullableString(d.androidOfferingIdentifierMonthly)) ||
    !isNullableString(d.androidBasePlanIdAnnual) ||
    !isNullableString(d.androidOfferIdAnnual) ||
    !(d.androidOfferingIdentifierAnnual === undefined || isNullableString(d.androidOfferingIdentifierAnnual)) ||
    !isOptionalNullableIOSPromotion(d.iosPromotion) ||
    !(d.appleConfigurationConfirmedAt === undefined || isNullableTimestamp(d.appleConfigurationConfirmedAt)) ||
    !(d.appleConfigurationConfirmedBy === undefined || isNullableString(d.appleConfigurationConfirmedBy)) ||
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
    ...(d.internalName !== undefined ? { internalName: d.internalName as string | null } : {}),
    androidBasePlanIdMonthly: d.androidBasePlanIdMonthly,
    androidOfferIdMonthly: d.androidOfferIdMonthly,
    androidOfferingIdentifierMonthly: (d.androidOfferingIdentifierMonthly as string | null | undefined) ?? null,
    androidBasePlanIdAnnual: d.androidBasePlanIdAnnual,
    androidOfferIdAnnual: d.androidOfferIdAnnual,
    androidOfferingIdentifierAnnual: (d.androidOfferingIdentifierAnnual as string | null | undefined) ?? null,
    iosPromotion: (d.iosPromotion as IOSPromotionConfig | null | undefined) ?? null,
    ...(d.appleConfigurationConfirmedAt !== undefined ? { appleConfigurationConfirmedAt: d.appleConfigurationConfirmedAt as Timestamp | null } : {}),
    ...(d.appleConfigurationConfirmedBy !== undefined ? { appleConfigurationConfirmedBy: d.appleConfigurationConfirmedBy as string | null } : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdBy: d.createdBy,
    notes: d.notes,
  };
}

/**
 * FASE 4C.1, revised FASE 5.3/5.7 — resolves one Android plan's
 * `(basePlanId, offerId, offeringIdentifier)` triple into an
 * `AndroidSubscriptionOfferConfig`, or `null`.
 *
 * `basePlanId === null` means the plan isn't configured for Android at all —
 * always `null` for the whole plan, regardless of the other two fields (an
 * `offerId`/`offeringIdentifier` present without a `basePlanId` is a
 * data-integrity problem, never a valid partial config; this function never
 * guesses/infers a missing `basePlanId`, which would be fabricating store
 * configuration the backend was never actually told).
 *
 * With `basePlanId !== null`, exactly ONE of `offerId`/`offeringIdentifier`
 * must be set:
 * - `offerId !== null`, `offeringIdentifier === null` — pre-5.3 LEGACY
 *   shape, preserved byte-for-byte: `validatePromoCode`/the webhook
 *   correlation continue to treat it as an exact `SubscriptionOption`
 *   identifier.
 * - `offeringIdentifier !== null`, `offerId === null` — FASE 5.7 NEW shape:
 *   the coupon selects only the promotional base plan plus the Offering the
 *   client must resolve its package from; Google Play/RevenueCat decides
 *   which `SubscriptionOption` (trial or not) applies.
 * - BOTH set (ambiguous) or BOTH null (incomplete — the FASE 5.3-only
 *   `basePlanId`-alone shape is no longer a complete config now that the
 *   client needs an Offering to search) — fail-closed to `null` for the
 *   whole plan; see `AndroidSubscriptionOfferConfig`'s doc comment.
 */
export function resolveAndroidOfferPair(
  basePlanId: string | null,
  offerId: string | null,
  offeringIdentifier: string | null,
): AndroidSubscriptionOfferConfig | null {
  if (basePlanId === null) return null;
  if (offerId !== null && offeringIdentifier !== null) return null;
  if (offerId === null && offeringIdentifier === null) return null;
  return { basePlanId, offerId, offeringIdentifier };
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
