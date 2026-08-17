import { PhotoVaultError } from './photoVaultErrors';

/**
 * Identity rules for a progress photo.
 *
 * Pure domain logic: no Firebase, no filesystem, no React. Two identifiers
 * coexist here and conflating them is the mistake this module exists to
 * prevent:
 *
 *   documentId — what Firestore stores the metadata under. For a posed photo
 *                it is `{dateKey}_{pose}`, which is what makes "at most one
 *                photo per pose per day" a database invariant rather than a
 *                client convention.
 *   assetId    — an opaque UUID naming the ciphertext in Storage and in the
 *                local encrypted cache. Deliberately carries no meaning, so an
 *                object name never reveals which day or pose it belongs to.
 *
 * Pre-pose photos have only one identifier: their document is named after the
 * asset, so `documentId === assetId`. Nothing is migrated to change that.
 */

export const PROGRESS_PHOTO_POSES = ['front', 'side', 'back'] as const;

export type ProgressPhotoPose = (typeof PROGRESS_PHOTO_POSES)[number];

export function isProgressPhotoPose(value: unknown): value is ProgressPhotoPose {
  return (
    typeof value === 'string' &&
    (PROGRESS_PHOTO_POSES as readonly string[]).includes(value)
  );
}

/**
 * Same UUID shape enforced by `firestore.rules` (`isVaultUuid`) and by the
 * backend in `functions/src/photoVault/orphanPolicy.ts`. Rules cannot import
 * code, so the pattern is mirrored in three places on purpose — keep them in
 * sync.
 */
const VAULT_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function isVaultUuid(value: unknown): value is string {
  return typeof value === 'string' && VAULT_UUID.test(value);
}

/** Mirrors the `dateKey` pattern in `firestore.rules`. */
const DATE_KEY = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY.test(value);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * The calendar day a photo belongs to, in the device's LOCAL calendar.
 *
 * `toISOString().slice(0, 10)` would be wrong here, and wrong in the way that
 * is hardest to notice: it reports the UTC day. A photo taken at 23:30 in
 * UTC−3 would be filed under the following day, so an evening photo would
 * silently join tomorrow's group. `getFullYear`/`getMonth`/`getDate` read the
 * local calendar, which is the one the user actually lives in.
 *
 * The result is frozen at creation and never recomputed on read, so the day
 * stays stable if the user later travels across time zones.
 */
export function localDateKey(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new PhotoVaultError('vaultMetadataInvalid');
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The document id that makes (day, pose) unique for a user.
 *
 * Validates its inputs rather than trusting callers: this string becomes a
 * Firestore path segment, and the rules pin the document id to exactly this
 * composition.
 */
export function progressPhotoDocumentId(dateKey: string, pose: ProgressPhotoPose): string {
  if (!isValidDateKey(dateKey) || !isProgressPhotoPose(pose)) {
    throw new PhotoVaultError('vaultMetadataInvalid');
  }
  return `${dateKey}_${pose}`;
}

/**
 * The identifier that addresses this photo's ciphertext.
 *
 * Single source of truth for the `assetId ?? documentId` fallback, so no call
 * site has to remember which generation of document it is holding. A pre-pose
 * document is named after its asset; a posed one carries the asset in a field.
 * Either way the answer must be a UUID — anything else would build a Storage
 * path or a cache filename out of an unvalidated string.
 */
export function resolveProgressPhotoAssetId(params: {
  documentId: string;
  assetId?: unknown;
}): string {
  const { documentId, assetId } = params;
  if (assetId !== undefined) {
    if (!isVaultUuid(assetId)) throw new PhotoVaultError('vaultMetadataInvalid');
    return assetId;
  }
  if (!isVaultUuid(documentId)) throw new PhotoVaultError('vaultMetadataInvalid');
  return documentId;
}
