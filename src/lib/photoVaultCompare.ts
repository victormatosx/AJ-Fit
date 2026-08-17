import { POSE_SLOTS } from './photoVaultDayGrouping';
import type { GalleryPhoto } from './photoVaultGallery';
import {
  isValidDateKey,
  localDateKey,
  type ProgressPhotoPose,
} from './photoVaultIdentity';

/**
 * Pairing rules for the progress comparator.
 *
 * Pure domain logic, extracted so the rules that decide what may be compared
 * can be exercised directly — the project has no component renderer. No
 * Firebase, no Storage, no crypto, no cache, no React: this only reads
 * metadata the gallery controller already holds in memory.
 *
 * Two rules drive everything here:
 *
 *   - a pair must share a pose. `front` against `side` compares different
 *     framings and would misrepresent progress rather than show it;
 *   - photos recorded before poses existed pair only with each other. Their
 *     pose is genuinely unknown, and guessing one to allow a comparison would
 *     be inventing data.
 */

/**
 * What two photos have in common for pairing purposes.
 *
 * A posed photo's group is its pose. Every pre-pose photo shares one group,
 * because nothing distinguishes them — this is a bucket for "unknown", never
 * a fourth pose.
 */
export type ComparisonGroup = ProgressPhotoPose | 'unclassified';

/** The comparison groups, in the gallery's fixed visual order. */
export const COMPARISON_GROUPS: readonly ComparisonGroup[] = [
  ...POSE_SLOTS,
  'unclassified',
];

/** Which bucket a photo pairs within. */
export function comparisonGroupOf(photo: GalleryPhoto): ComparisonGroup {
  return photo.pose ?? 'unclassified';
}

/**
 * Whether a photo can take part in a comparison at all.
 *
 * An optimistic upload has no remote metadata yet, so its ciphertext cannot
 * be read for the composition a later phase performs. Excluding it here keeps
 * a half-uploaded card from ever entering a selection that would then fail.
 */
export function isComparable(photo: GalleryPhoto): boolean {
  return photo.metadata !== null && photo.uploadStatus === null;
}

/**
 * Whether any valid pair exists anywhere in the gallery.
 *
 * Deliberately not `photos.length >= 2`: a library holding one `front` and
 * one `side` has two photos and zero valid pairs. The comparator entry point
 * must reflect that, or it would open onto a dead end.
 */
export function canCompareProgressPhotos(photos: GalleryPhoto[]): boolean {
  const counts = new Map<ComparisonGroup, number>();
  for (const photo of photos) {
    if (!isComparable(photo)) continue;
    const group = comparisonGroupOf(photo);
    const next = (counts.get(group) ?? 0) + 1;
    if (next >= 2) return true;
    counts.set(group, next);
  }
  return false;
}

/** Every photo that could open a comparison, newest first. */
export function comparisonStartCandidates(photos: GalleryPhoto[]): GalleryPhoto[] {
  const eligible = photos.filter(isComparable);
  const counts = new Map<ComparisonGroup, number>();
  for (const photo of eligible) {
    const group = comparisonGroupOf(photo);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  // A photo with no partner in its own group can never complete a pair, so
  // offering it as a first pick would only lead to an empty second step.
  return eligible.filter((photo) => (counts.get(comparisonGroupOf(photo)) ?? 0) >= 2);
}

/**
 * Every photo that can pair with `photo`.
 *
 * Same group, never itself, and never a photo taken at the same instant —
 * two images of one moment show no progress, and the before/after ordering
 * would be undefined.
 */
export function comparisonCandidatesFor(
  photo: GalleryPhoto,
  photos: GalleryPhoto[],
): GalleryPhoto[] {
  const group = comparisonGroupOf(photo);
  return photos.filter(
    (candidate) =>
      isComparable(candidate) &&
      candidate.photoId !== photo.photoId &&
      comparisonGroupOf(candidate) === group &&
      candidate.takenAt.getTime() !== photo.takenAt.getTime(),
  );
}

export type BeforeAfter =
  | { ok: true; before: GalleryPhoto; after: GalleryPhoto }
  | { ok: false; reason: 'sameMoment' | 'differentGroup' };

/**
 * Orders a chosen pair chronologically.
 *
 * The user picks two photos; which one is "before" is a fact about their
 * capture times, not about tap order, so picking the recent one first is
 * normalised rather than rejected. `takenAt` is the authority — never
 * `createdAt`, which records when the upload happened and can invert the
 * real chronology for a photo imported from the library.
 */
export function normalizeBeforeAfter(a: GalleryPhoto, b: GalleryPhoto): BeforeAfter {
  if (comparisonGroupOf(a) !== comparisonGroupOf(b)) {
    return { ok: false, reason: 'differentGroup' };
  }
  const first = a.takenAt.getTime();
  const second = b.takenAt.getTime();
  if (first === second) return { ok: false, reason: 'sameMoment' };
  return first < second
    ? { ok: true, before: a, after: b }
    : { ok: true, before: b, after: a };
}

const CIVIL_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a frozen local-calendar key into a timezone-free day ordinal.
 *
 * `Date.UTC` is intentional: subtracting local midnights can yield 23 or 25
 * hours across daylight-saving transitions. The round-trip validation also
 * rejects calendar rollovers such as `2026-02-31`, which the shared date-key
 * shape validator correctly leaves to domain callers to handle.
 */
function civilDayOrdinal(dateKey: string): number | null {
  if (!isValidDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(utc / CIVIL_DAY_MS);
}

function comparisonDayOrdinal(
  photo: Pick<GalleryPhoto, 'dateKey' | 'takenAt'>,
): number {
  const frozenDay = photo.dateKey ? civilDayOrdinal(photo.dateKey) : null;
  if (frozenDay !== null) return frozenDay;

  // Pre-pose photos never stored a dateKey. Match the gallery's established
  // legacy fallback: derive the civil day in the device's local calendar,
  // then compare ordinals in UTC so DST cannot change the result.
  const legacyDay = civilDayOrdinal(localDateKey(photo.takenAt));
  // `localDateKey` always emits the validated shape; the null fallback is
  // purely defensive so this render helper never introduces a raw UI error.
  return legacyDay ?? 0;
}

/**
 * Whole civil days elapsed between an already-normalized before/after pair.
 *
 * Posed photos prefer their immutable `dateKey`; legacy photos consistently
 * fall back to `takenAt`. A defensive clamp guarantees the poster can never
 * show a negative period even if a caller bypasses pair normalization.
 */
export function comparisonElapsedDays(
  before: Pick<GalleryPhoto, 'dateKey' | 'takenAt'>,
  after: Pick<GalleryPhoto, 'dateKey' | 'takenAt'>,
): number {
  return Math.max(
    0,
    comparisonDayOrdinal(after) - comparisonDayOrdinal(before),
  );
}
