import { Timestamp } from 'firebase-admin/firestore';
import { normalizePromoCode } from './normalize';
import type { PromoCodeDocument } from './types';

/**
 * Pure, Firestore-free allowlist validation for the promo-code ADMIN write
 * surface (`adminCreatePromoCode`/`adminUpdatePromoCode`). Zero dependency
 * on `firebase-admin`'s Firestore client beyond the `Timestamp` value type,
 * so this is fully unit-testable without an emulator — same split as
 * `attributionSync.ts`'s decision functions vs. its transaction wrapper.
 *
 * This is the SINGLE place that turns an untrusted admin-panel payload into
 * the exact writable subset of `PromoCodeDocument` (everything except
 * `createdAt`/`updatedAt`/`createdBy`, which the handler controls — see
 * `promoCodeAdmin.ts`). Every field is allowlisted explicitly; nothing here
 * ever spreads/forwards an arbitrary client object into a Firestore write.
 */

export type PromoCodeWritableFields = Omit<
  PromoCodeDocument,
  'createdAt' | 'updatedAt' | 'createdBy' | 'appleConfigurationConfirmedAt' | 'appleConfigurationConfirmedBy'
> & { appleConfigurationConfirmed: boolean };

export type AdminPromoCodeValidationError =
  | 'invalid_code_format'
  | 'invalid_campaign_id'
  | 'invalid_influencer_id'
  | 'invalid_internal_name'
  | 'invalid_active'
  | 'invalid_starts_at'
  | 'invalid_ends_at'
  | 'ends_at_before_starts_at'
  | 'invalid_notes'
  | 'invalid_apple_configuration_confirmation'
  | 'active_requires_apple_configuration_confirmation'
  | 'apple_configuration_requires_ios_promotion'
  | 'android_monthly_partial'
  | 'android_annual_partial'
  | 'ios_promotion_invalid';

export type AdminPromoCodeValidationResult =
  | { ok: true; fields: PromoCodeWritableFields }
  | { ok: false; error: AdminPromoCodeValidationError };

/** Defensive bound only — no business rule caps `campaignId`/`influencerId` length today. */
const IDENTIFIER_MAX_LENGTH = 100;
const NOTES_MAX_LENGTH = 2000;

function trimmedNonEmpty(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/** `undefined`/`null`/empty-string all mean "not provided" — distinct from a present-but-invalid value, which the caller rejects separately. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);
}

interface AndroidPlanResult {
  ok: boolean;
  value: { basePlanId: string; offerId: string | null; offeringIdentifier: string | null } | null;
}

/**
 * WRITE-time validation for one Android plan's `(basePlanId, offerId,
 * offeringIdentifier)` triple — the admin-facing counterpart of
 * `promoCodeCatalog.ts`'s `resolveAndroidOfferPair` (which resolves on
 * READ).
 *
 * `basePlanId` is required whenever the plan is configured at all — never
 * inferred, `offerId`/`offeringIdentifier` present without it is always
 * rejected.
 *
 * With `basePlanId` present, exactly ONE of `offerId`/`offeringIdentifier`
 * must also be present:
 * - `offerId` alone (FASE 4C.3A LEGACY shape) — identifies one exact
 *   `SubscriptionOption`.
 * - `offeringIdentifier` alone (FASE 5.7 NEW shape) — the coupon selects
 *   only the promotional base plan plus which RevenueCat Offering the
 *   client resolves its package from; the offer itself (trial or not) is
 *   left to Google Play/RevenueCat.
 * - BOTH present (ambiguous — which shape?) or NEITHER present alongside a
 *   `basePlanId` (incomplete — `basePlanId` alone no longer identifies a
 *   usable config since FASE 5.7) are both rejected (`ok: false`) — an
 *   admin submitting either almost certainly made a mistake, and the
 *   catalog document should never be allowed to encode an ambiguous or
 *   incomplete state silently.
 */
function validateAndroidPlanPair(
  basePlanIdRaw: unknown,
  offerIdRaw: unknown,
  offeringIdentifierRaw: unknown,
  maxLength: number,
): AndroidPlanResult {
  const basePlanIdBlank = isBlank(basePlanIdRaw);
  const offerIdBlank = isBlank(offerIdRaw);
  const offeringIdentifierBlank = isBlank(offeringIdentifierRaw);

  if (basePlanIdBlank && offerIdBlank && offeringIdentifierBlank) return { ok: true, value: null };
  if (basePlanIdBlank) return { ok: false, value: null };

  const basePlanId = trimmedNonEmpty(basePlanIdRaw, maxLength);
  if (basePlanId === null) return { ok: false, value: null };

  if (offerIdBlank === offeringIdentifierBlank) {
    // Both present (ambiguous) or both absent (incomplete) — reject either way.
    return { ok: false, value: null };
  }

  if (!offerIdBlank) {
    const offerId = trimmedNonEmpty(offerIdRaw, maxLength);
    if (offerId === null) return { ok: false, value: null };
    return { ok: true, value: { basePlanId, offerId, offeringIdentifier: null } };
  }

  const offeringIdentifier = trimmedNonEmpty(offeringIdentifierRaw, maxLength);
  if (offeringIdentifier === null) return { ok: false, value: null };
  return { ok: true, value: { basePlanId, offerId: null, offeringIdentifier } };
}

interface IOSPromotionResult {
  ok: boolean;
  value: { offeringIdentifier: string; monthlyProductId: string; annualProductId: string } | null;
}

/**
 * FASE 1 — write-time validation for `iosPromotion`, the admin-facing
 * counterpart of `promoCodeCatalog.ts`'s `isValidIOSPromotionShape` (which
 * validates on READ). Unlike `validatePair` (exactly 2 fields, `first`/
 * `second`), this is a THREE-field all-or-nothing group: `offeringIdentifier`
 * covers both plans, so there is no meaningful "two of three set" state —
 * any input where the three fields aren't uniformly blank or uniformly
 * present-and-valid is rejected as `ok: false`, never silently accepted with
 * one field defaulted.
 */
function validateIOSPromotionInput(input: {
  offeringIdentifier?: unknown;
  monthlyProductId?: unknown;
  annualProductId?: unknown;
} | null | undefined): IOSPromotionResult {
  const offeringIdentifierRaw = input?.offeringIdentifier;
  const monthlyProductIdRaw = input?.monthlyProductId;
  const annualProductIdRaw = input?.annualProductId;

  const blanks = [offeringIdentifierRaw, monthlyProductIdRaw, annualProductIdRaw].map(isBlank);
  if (blanks.every(Boolean)) return { ok: true, value: null };
  if (blanks.some(Boolean)) return { ok: false, value: null };

  const offeringIdentifier = trimmedNonEmpty(offeringIdentifierRaw, IDENTIFIER_MAX_LENGTH);
  const monthlyProductId = trimmedNonEmpty(monthlyProductIdRaw, IDENTIFIER_MAX_LENGTH);
  const annualProductId = trimmedNonEmpty(annualProductIdRaw, IDENTIFIER_MAX_LENGTH);
  if (offeringIdentifier === null || monthlyProductId === null || annualProductId === null) {
    return { ok: false, value: null };
  }

  return { ok: true, value: { offeringIdentifier, monthlyProductId, annualProductId } };
}

function parseNullableTimestamp(value: unknown): { ok: true; value: Timestamp | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' && typeof value !== 'number') return { ok: false };

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };

  return { ok: true, value: Timestamp.fromDate(date) };
}

interface AndroidPlanInput {
  basePlanId?: unknown;
  /** LEGACY shape — mutually exclusive with `offeringIdentifier` (FASE 5.7). */
  offerId?: unknown;
  /** NEW shape (FASE 5.7) — mutually exclusive with `offerId`. */
  offeringIdentifier?: unknown;
}

export interface AdminPromoCodeWriteInput {
  code?: unknown;
  campaignId?: unknown;
  influencerId?: unknown;
  internalName?: unknown;
  active?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  notes?: unknown;
  appleConfigurationConfirmed?: unknown;
  android?: {
    monthly?: AndroidPlanInput | null;
    annual?: AndroidPlanInput | null;
  } | null;
  /**
   * FASE 1 — the new iOS promotional (Offering/SKU) authorization. All
   * three sub-fields required together or the whole object must be
   * blank/absent — see `validateIOSPromotionInput`'s doc comment for why
   * this has no partial state.
   */
  iosPromotion?: {
    offeringIdentifier?: unknown;
    monthlyProductId?: unknown;
    annualProductId?: unknown;
  } | null;
}

/**
 * `requireCode: true` for CREATE (the admin-supplied code becomes the
 * document ID); `false` for UPDATE, where the code is already fixed by the
 * document path and this function's `fields.code` is simply not read by the
 * caller (see `promoCodeAdmin.ts`'s `adminUpdatePromoCodeHandler`) — the
 * code is immutable after creation (Parte 9 of the task spec: renaming means
 * creating a new code, never migrating one in place).
 */
export function validateAdminPromoCodeWrite(
  data: unknown,
  options: { requireCode: boolean },
): AdminPromoCodeValidationResult {
  const input = (typeof data === 'object' && data !== null ? data : {}) as AdminPromoCodeWriteInput;

  let code = '';
  if (options.requireCode) {
    const normalized = normalizePromoCode(input.code);
    if (normalized === null) return { ok: false, error: 'invalid_code_format' };
    code = normalized;
  }

  const campaignId = trimmedNonEmpty(input.campaignId, IDENTIFIER_MAX_LENGTH);
  if (campaignId === null) return { ok: false, error: 'invalid_campaign_id' };

  const influencerId = trimmedNonEmpty(input.influencerId, IDENTIFIER_MAX_LENGTH);
  if (influencerId === null) return { ok: false, error: 'invalid_influencer_id' };

  let internalName: string | null = null;
  if (!isBlank(input.internalName)) {
    internalName = trimmedNonEmpty(input.internalName, IDENTIFIER_MAX_LENGTH);
    if (internalName === null) return { ok: false, error: 'invalid_internal_name' };
  }

  if (typeof input.active !== 'boolean') return { ok: false, error: 'invalid_active' };
  if (typeof input.appleConfigurationConfirmed !== 'boolean') {
    return { ok: false, error: 'invalid_apple_configuration_confirmation' };
  }
  if (input.active && !input.appleConfigurationConfirmed) {
    return { ok: false, error: 'active_requires_apple_configuration_confirmation' };
  }

  const startsAtResult = parseNullableTimestamp(input.startsAt);
  if (!startsAtResult.ok) return { ok: false, error: 'invalid_starts_at' };

  const endsAtResult = parseNullableTimestamp(input.endsAt);
  if (!endsAtResult.ok) return { ok: false, error: 'invalid_ends_at' };

  if (
    startsAtResult.value !== null &&
    endsAtResult.value !== null &&
    endsAtResult.value.toMillis() < startsAtResult.value.toMillis()
  ) {
    return { ok: false, error: 'ends_at_before_starts_at' };
  }

  let notes: string | null = null;
  if (!isBlank(input.notes)) {
    notes = trimmedNonEmpty(input.notes, NOTES_MAX_LENGTH);
    if (notes === null) return { ok: false, error: 'invalid_notes' };
  }

  const androidMonthly = validateAndroidPlanPair(
    input.android?.monthly?.basePlanId,
    input.android?.monthly?.offerId,
    input.android?.monthly?.offeringIdentifier,
    IDENTIFIER_MAX_LENGTH,
  );
  if (!androidMonthly.ok) return { ok: false, error: 'android_monthly_partial' };

  const androidAnnual = validateAndroidPlanPair(
    input.android?.annual?.basePlanId,
    input.android?.annual?.offerId,
    input.android?.annual?.offeringIdentifier,
    IDENTIFIER_MAX_LENGTH,
  );
  if (!androidAnnual.ok) return { ok: false, error: 'android_annual_partial' };

  const iosPromotion = validateIOSPromotionInput(input.iosPromotion);
  if (!iosPromotion.ok) return { ok: false, error: 'ios_promotion_invalid' };
  if (input.appleConfigurationConfirmed && iosPromotion.value === null) {
    return { ok: false, error: 'apple_configuration_requires_ios_promotion' };
  }

  return {
    ok: true,
    fields: {
      code,
      active: input.active,
      startsAt: startsAtResult.value,
      endsAt: endsAtResult.value,
      influencerId,
      campaignId,
      internalName,
      androidBasePlanIdMonthly: androidMonthly.value?.basePlanId ?? null,
      androidOfferIdMonthly: androidMonthly.value?.offerId ?? null,
      androidOfferingIdentifierMonthly: androidMonthly.value?.offeringIdentifier ?? null,
      androidBasePlanIdAnnual: androidAnnual.value?.basePlanId ?? null,
      androidOfferIdAnnual: androidAnnual.value?.offerId ?? null,
      androidOfferingIdentifierAnnual: androidAnnual.value?.offeringIdentifier ?? null,
      iosPromotion: iosPromotion.value,
      appleConfigurationConfirmed: input.appleConfigurationConfirmed,
      notes,
    },
  };
}
