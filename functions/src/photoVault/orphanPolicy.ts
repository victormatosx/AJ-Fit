/**
 * Conservative policy shared by the scheduled reconciliation and its tests.
 * No Firebase I/O belongs here.
 */

export const ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ORPHAN_CONFIRMATION_MS = 24 * 60 * 60 * 1000;

const PHOTO_OBJECT =
  /^users\/([^/]+)\/progressPhotos\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.thumb)?\.enc$/i;

export interface ParsedPhotoObject {
  uid: string;
  photoId: string;
  assetKind: 'full' | 'thumbnail';
}

export function parsePhotoObjectPath(path: string): ParsedPhotoObject | null {
  const match = PHOTO_OBJECT.exec(path);
  return match
    ? {
        uid: match[1]!,
        photoId: match[2]!,
        assetKind: match[3] ? 'thumbnail' : 'full',
      }
    : null;
}

/**
 * Whether a metadata document claims the asset stored under `assetIdFromPath`.
 *
 * Two document generations coexist and neither is migrated:
 *
 *   - pre-pose documents are named after the asset itself, so the document id
 *     IS the asset id;
 *   - posed documents are named `{dateKey}_{pose}`, so that Firestore itself
 *     enforces one photo per pose per day, and reference the asset by field.
 *
 * Storage object names stay opaque UUIDs in both cases, which is why
 * `PHOTO_OBJECT` above is unchanged.
 *
 * Deliberately generous — either form of proof is accepted. In this routine a
 * false negative eventually deletes ciphertext, while a false positive only
 * preserves an object that the next run re-examines. The asymmetry decides the
 * direction to err in.
 */
export function documentClaimsAsset(params: {
  documentId: string;
  assetId: unknown;
  assetIdFromPath: string;
}): boolean {
  const { documentId, assetId, assetIdFromPath } = params;
  if (typeof assetId === 'string' && assetId === assetIdFromPath) return true;
  return documentId === assetIdFromPath;
}

export function isOldEnough(createdAtMillis: number, nowMillis: number): boolean {
  return (
    Number.isFinite(createdAtMillis) &&
    createdAtMillis > 0 &&
    nowMillis - createdAtMillis >= ORPHAN_MIN_AGE_MS
  );
}

export function isConfirmedCandidate(
  firstSeenAtMillis: number,
  nowMillis: number,
): boolean {
  return (
    Number.isFinite(firstSeenAtMillis) &&
    firstSeenAtMillis > 0 &&
    nowMillis - firstSeenAtMillis >= ORPHAN_CONFIRMATION_MS
  );
}
