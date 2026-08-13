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
