import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo } from '../lib/logger';
import { requireAdminUid } from './adminAuth';
import { PROMO_CODES_COLLECTION, promoCodeDocPath } from './constants';
import { normalizePromoCode } from './normalize';
import { parsePromoCodeDocument } from './promoCodeCatalog';
import {
  validateAdminPromoCodeWrite,
  type AdminPromoCodeWriteInput,
} from './promoCodeAdminValidation';
import type { PromoCodeDocument } from './types';

/**
 * THE admin write surface for `promoCodes/{code}` (Parte 11 of the task
 * spec: `firestore.rules`'s `promoCodes` block stays `allow read, write: if
 * false` for every client — this module is the only path in or out of the
 * catalog for the admin panel, exactly mirroring how `validatePromoCode.ts`
 * is the only path for the mobile client).
 *
 * Every handler: (1) `requireAdminUid` — re-verifies identity + role on the
 * server, never trusts the caller's own claim; (2) validates the payload
 * with `validateAdminPromoCodeWrite` (allowlisted field-by-field, never
 * `docRef.set(request.data)`); (3) writes via the Admin SDK, which bypasses
 * Firestore Rules by design — the rules stay closed to the client, this is
 * the trusted server path documented in `adminAuth.ts`.
 *
 * `couponRedemptions/{uid}` is NEVER read or written by this module — every
 * handler here touches `promoCodes/{code}` only, matching Parte 12 of the
 * task spec (editing/deactivating a catalog entry must never rewrite the
 * per-uid snapshot captured at the moment a code was applied).
 */

const SCOPE = 'attribution:promoCodeAdmin';

function invalidArgument(error: string): never {
  throw new HttpsError('invalid-argument', error);
}

function isAlreadyExists(err: unknown): boolean {
  // Admin SDK / gRPC ALREADY_EXISTS status code, surfaced on `.create()`
  // when the document already exists — see `DocumentReference.create`'s
  // documented behavior. Never treated as a generic `internal` failure so
  // the panel can show "código já existe" instead of a stack trace.
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 6;
}

export interface AdminCreatePromoCodeResponse {
  code: string;
}

/**
 * CREATE — document must NOT already exist. Uses `DocumentReference.create()`
 * (atomic exists-check baked into the Firestore write itself, Parte 14 of
 * the task spec) rather than a `get()`-then-`set()` pair, which would be
 * vulnerable to a race between two concurrent admins creating the same code.
 *
 * Writes every key `promoCodeCatalog.ts`'s `parsePromoCodeDocument` requires
 * (`PROMO_CODE_DOCUMENT_KEYS`), explicitly, including `null` placeholders
 * for anything the admin didn't configure — an omitted key (not `null`)
 * would make the document fail that strict parser (Parte 10 of the task
 * spec: the write contract must stay byte-for-byte compatible with the real
 * reader).
 */
export async function adminCreatePromoCodeHandler(
  request: CallableRequest<AdminPromoCodeWriteInput>,
): Promise<AdminCreatePromoCodeResponse> {
  const adminUid = await requireAdminUid(request);

  const validation = validateAdminPromoCodeWrite(request.data, { requireCode: true });
  if (!validation.ok) invalidArgument(validation.error);
  const { fields } = validation;

  const docRef = db.doc(promoCodeDocPath(fields.code));
  const now = FieldValue.serverTimestamp();

  const document: Omit<PromoCodeDocument, 'createdAt' | 'updatedAt'> & {
    createdAt: FieldValue;
    updatedAt: FieldValue;
  } = {
    ...fields,
    createdAt: now,
    updatedAt: now,
    createdBy: adminUid,
  };

  try {
    await docRef.create(document);
  } catch (err) {
    if (isAlreadyExists(err)) {
      throw new HttpsError('already-exists', 'promo_code_already_exists');
    }
    logFunctionError(SCOPE, err, { adminUid, operation: 'create', code: fields.code });
    throw new HttpsError('internal', 'internal_error');
  }

  logInfo(SCOPE, 'promo code created', { adminUid, code: fields.code });
  return { code: fields.code };
}

export interface AdminUpdatePromoCodeInput extends AdminPromoCodeWriteInput {
  code: unknown;
}

export interface AdminUpdatePromoCodeResponse {
  code: string;
}

/**
 * UPDATE — document MUST already exist. `code` in the request only LOCATES
 * the document (Parte 9 of the task spec: the code is immutable after
 * creation — this handler never writes a different `code` value than the
 * one the document already has, and never accepts a "rename").
 *
 * `createdAt`/`createdBy` are deliberately absent from the `update()` call —
 * Firestore's `update()` only touches the fields explicitly given, so
 * omitting them is what PRESERVES the original creation metadata (Parte 12:
 * "createdAt → nunca alterar", "createdBy → nunca alterar"). No
 * `updatedBy` field exists on `PromoCodeDocument`/`PROMO_CODE_DOCUMENT_KEYS`
 * (confirmed against `promoCodeCatalog.ts`'s parser) — adding one here
 * would make every future `parsePromoCodeDocument` read reject this
 * document as malformed (unknown field), so the acting admin is logged via
 * `logInfo` instead of persisted on the document itself.
 */
export async function adminUpdatePromoCodeHandler(
  request: CallableRequest<AdminUpdatePromoCodeInput>,
): Promise<AdminUpdatePromoCodeResponse> {
  const adminUid = await requireAdminUid(request);

  const normalizedCode = normalizeCodeOrThrow(request.data?.code);

  const validation = validateAdminPromoCodeWrite(request.data, { requireCode: false });
  if (!validation.ok) invalidArgument(validation.error);
  const { fields } = validation;

  const docRef = db.doc(promoCodeDocPath(normalizedCode));

  const update: Omit<PromoCodeDocument, 'code' | 'createdAt' | 'updatedAt' | 'createdBy'> & {
    updatedAt: FieldValue;
  } = {
    active: fields.active,
    startsAt: fields.startsAt,
    endsAt: fields.endsAt,
    influencerId: fields.influencerId,
    campaignId: fields.campaignId,
    androidBasePlanIdMonthly: fields.androidBasePlanIdMonthly,
    androidOfferIdMonthly: fields.androidOfferIdMonthly,
    androidBasePlanIdAnnual: fields.androidBasePlanIdAnnual,
    androidOfferIdAnnual: fields.androidOfferIdAnnual,
    appleOfferCodeMonthly: fields.appleOfferCodeMonthly,
    appleOfferCodeAnnual: fields.appleOfferCodeAnnual,
    appleProductIdMonthly: fields.appleProductIdMonthly,
    appleOfferReferenceMonthly: fields.appleOfferReferenceMonthly,
    appleProductIdAnnual: fields.appleProductIdAnnual,
    appleOfferReferenceAnnual: fields.appleOfferReferenceAnnual,
    iosPromotion: fields.iosPromotion,
    notes: fields.notes,
    updatedAt: FieldValue.serverTimestamp(),
  };

  try {
    await docRef.update(update);
  } catch (err) {
    if (isNotFound(err)) {
      throw new HttpsError('not-found', 'promo_code_not_found');
    }
    logFunctionError(SCOPE, err, { adminUid, operation: 'update', code: normalizedCode });
    throw new HttpsError('internal', 'internal_error');
  }

  logInfo(SCOPE, 'promo code updated', { adminUid, code: normalizedCode });
  return { code: normalizedCode };
}

export interface AdminSetPromoCodeActiveInput {
  code?: unknown;
  active?: unknown;
}

export interface AdminSetPromoCodeActiveResponse {
  code: string;
  active: boolean;
}

/**
 * SMALL, explicit operation (Parte 13 of the task spec) — accepts only
 * `{code, active}`, never the full document, so a stale/partial panel state
 * can never accidentally clobber the rest of the catalog entry when an
 * admin just wants to toggle availability. Preferred over delete (Parte 13:
 * "cupons podem fazer parte do histórico de attribution").
 */
export async function adminSetPromoCodeActiveHandler(
  request: CallableRequest<AdminSetPromoCodeActiveInput>,
): Promise<AdminSetPromoCodeActiveResponse> {
  const adminUid = await requireAdminUid(request);

  const normalizedCode = normalizeCodeOrThrow(request.data?.code);
  if (typeof request.data?.active !== 'boolean') invalidArgument('invalid_active');
  const active = request.data.active;

  const docRef = db.doc(promoCodeDocPath(normalizedCode));

  try {
    await docRef.update({ active, updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    if (isNotFound(err)) {
      throw new HttpsError('not-found', 'promo_code_not_found');
    }
    logFunctionError(SCOPE, err, { adminUid, operation: 'set_active', code: normalizedCode });
    throw new HttpsError('internal', 'internal_error');
  }

  logInfo(SCOPE, 'promo code active flag changed', { adminUid, code: normalizedCode, active });
  return { code: normalizedCode, active };
}

export interface AdminPromoCodeListItem extends PromoCodeDocument {
  id: string;
}

export interface AdminListPromoCodesResponse {
  promoCodes: AdminPromoCodeListItem[];
}

/**
 * READ path for the admin panel — necessary because `firestore.rules`
 * blocks `read` on `promoCodes` for every client, same as `write` (Parte 3
 * of the task spec doc comment on that block: no exception, not even for
 * the future admin surface). A full collection `get()` is acceptable here:
 * this is a small, admin-authored catalog (influencer codes), not a
 * high-cardinality collection — no query/index is introduced.
 *
 * A malformed document (fails `parsePromoCodeDocument`, same strict parser
 * `lookupPromoCode` uses) is skipped and logged rather than surfaced to the
 * panel or crashing the whole list — consistent with `lookupPromoCode`'s
 * existing "malformed == not found" policy.
 */
export async function adminListPromoCodesHandler(
  request: CallableRequest<unknown>,
): Promise<AdminListPromoCodesResponse> {
  const adminUid = await requireAdminUid(request);

  const snapshot = await db.collection(PROMO_CODES_COLLECTION).get();

  const promoCodes: AdminPromoCodeListItem[] = [];
  for (const doc of snapshot.docs) {
    const parsed = parsePromoCodeDocument(doc.data());
    if (!parsed) {
      logFunctionError(SCOPE, new Error('malformed promoCodes document'), {
        adminUid,
        operation: 'list',
        code: doc.id,
      });
      continue;
    }
    promoCodes.push({ ...parsed, id: doc.id });
  }

  return { promoCodes };
}

/** Reuses `normalizePromoCode` (never a second, hand-rolled normalization) — an update/activation target must satisfy the exact same code contract a create would. */
function normalizeCodeOrThrow(rawCode: unknown): string {
  const normalized = normalizePromoCode(rawCode);
  if (normalized === null) invalidArgument('invalid_code_format');
  return normalized;
}

function isNotFound(err: unknown): boolean {
  // Admin SDK / gRPC NOT_FOUND status code, surfaced on `.update()` when
  // the document does not exist.
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 5;
}
