export type PhotoCacheVersion =
  | number
  | string
  | { toMillis(): number }
  | null
  | undefined;

/** Produces a new request identity only when the persisted photo changes. */
export function versionedPhotoURL(
  photoURL: string,
  version: PhotoCacheVersion,
): string {
  if (!version || photoURL.startsWith('file:') || photoURL.startsWith('data:')) {
    return photoURL;
  }
  const value = typeof version === 'object' ? version.toMillis() : version;
  const separator = photoURL.includes('?') ? '&' : '?';
  return `${photoURL}${separator}v=${encodeURIComponent(String(value))}`;
}
