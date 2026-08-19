import { logPhotoVaultIssue } from './photoVaultErrors';
import type { GalleryPhoto } from './photoVaultGallery';
import { localDateKey, type ProgressPhotoPose } from './photoVaultIdentity';

/**
 * Read-side projection of the gallery, grouped by calendar day.
 *
 * Firestore still stores exactly one photo per document. Nothing here is
 * persisted, aggregated remotely or written back — this is a pure view model
 * rebuilt from metadata the controller already has.
 *
 * Deliberately free of Firebase, Storage, crypto and the cache: grouping must
 * never trigger a download, a decrypt or a second query. It is O(n) over
 * metadata plus one sort of the resulting days.
 */

const SCOPE = 'photoVault.dayGrouping';

export interface ProgressDay {
  /** `YYYY-MM-DD`. Stored for posed photos, derived for earlier ones. */
  dateKey: string;
  /** Local midnight of `dateKey`, for locale-aware formatting in the UI. */
  date: Date;
  /** `YYYY-MM`, so the flat list can render month headings without nesting. */
  monthKey: string;
  /**
   * True on the first day of each month in the ordered result. Lets a single
   * flat list render month headings inline instead of nesting a second list,
   * which would cost the virtualization the grid depends on.
   */
  startsMonth: boolean;
  front?: GalleryPhoto;
  side?: GalleryPhoto;
  back?: GalleryPhoto;
  /**
   * Photos recorded before poses existed, plus anything the defensive checks
   * below refuse to place in a slot. Never hidden and never silently merged
   * into a pose.
   */
  unclassified: GalleryPhoto[];
}

/** Fixed visual order, independent of the order Firestore returned. */
export const POSE_SLOTS: readonly ProgressPhotoPose[] = ['front', 'side', 'back'];

/** Which photos the gallery is currently showing. Presentation only. */
export type ProgressPhotoFilter = 'all' | ProgressPhotoPose;

export const PROGRESS_PHOTO_FILTERS: readonly ProgressPhotoFilter[] = [
  'all',
  'front',
  'side',
  'back',
];

/**
 * The day a photo belongs to.
 *
 * A posed photo carries the day it was filed under, frozen at creation. An
 * earlier photo has none, so it is derived from `takenAt` in the LOCAL
 * calendar — best effort by definition: the original capture time zone was
 * never recorded, so a photo taken abroad may group under the day the current
 * device would call it. Grouping is the only thing affected, and nothing is
 * written back to Firestore to "fix" it.
 */
function dayKeyOf(photo: GalleryPhoto): string {
  return photo.dateKey ?? localDateKey(photo.takenAt);
}

function emptyDay(dateKey: string): ProgressDay {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return {
    dateKey,
    // Local midnight: the UI only formats month/day/year from this.
    date: new Date(year, month - 1, day),
    monthKey: dateKey.slice(0, 7),
    startsMonth: false,
    unclassified: [],
  };
}

/**
 * Groups a flat gallery into days, newest first.
 *
 * `YYYY-MM-DD` is zero-padded, so lexical ordering is chronological and no
 * date parsing is needed to sort.
 */
export function groupProgressPhotosByDay(photos: GalleryPhoto[]): ProgressDay[] {
  const byDay = new Map<string, ProgressDay>();
  let duplicateSlots = 0;

  for (const photo of photos) {
    const dateKey = dayKeyOf(photo);
    let day = byDay.get(dateKey);
    if (!day) {
      day = emptyDay(dateKey);
      byDay.set(dateKey, day);
    }

    // Only a photo that actually carries a pose can claim a slot. An
    // optimistic upload has no pose yet and is treated as unclassified until
    // its metadata arrives.
    const pose = photo.pose;
    if (pose === undefined) {
      day.unclassified.push(photo);
      continue;
    }

    if (day[pose] === undefined) {
      day[pose] = photo;
      continue;
    }

    // The posed schema makes this impossible through the database — the
    // document id IS the (day, pose) pair. Reaching here means corrupted or
    // hand-written data. Keeping the first occurrence (the newest, since the
    // input is ordered by `takenAt` descending) and demoting the rest keeps
    // the extra photo visible and deletable instead of vanishing, and never
    // affects the other slots.
    duplicateSlots += 1;
    day.unclassified.push(photo);
  }

  if (duplicateSlots > 0) {
    // Aggregate only: no photoId, day or pose reaches the log.
    logPhotoVaultIssue(SCOPE, 'vaultMetadataInvalid');
  }

  const days = [...byDay.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));

  let previousMonth: string | null = null;
  for (const day of days) {
    day.startsMonth = day.monthKey !== previousMonth;
    previousMonth = day.monthKey;
  }
  return days;
}


/**
 * Narrows the day projection to one pose.
 *
 * Purely derived, like the grouping itself: it builds new day objects and
 * never touches the ones it was given, so switching filters cannot leak state
 * between views. No query, no download, no decrypt — the metadata is already
 * in memory and this is O(n).
 *
 * Photos recorded before poses existed are shown only under `all`. Their pose
 * is genuinely unknown, and guessing one from order or aspect ratio would be
 * inventing data.
 */
export function filterProgressDays(
  days: ProgressDay[],
  filter: ProgressPhotoFilter,
): ProgressDay[] {
  if (filter === 'all') return days;

  const narrowed: ProgressDay[] = [];
  for (const day of days) {
    const photo = day[filter];
    if (!photo) continue;
    narrowed.push({
      dateKey: day.dateKey,
      date: day.date,
      monthKey: day.monthKey,
      // Recomputed below: the day that used to open a month may be gone.
      startsMonth: false,
      [filter]: photo,
      unclassified: [],
    } as ProgressDay);
  }

  let previousMonth: string | null = null;
  for (const day of narrowed) {
    day.startsMonth = day.monthKey !== previousMonth;
    previousMonth = day.monthKey;
  }
  return narrowed;
}

/**
 * The photos of `days`, in the exact order the grid paints them.
 *
 * The full-screen viewer pages through this sequence, so it has to agree with
 * what the user just tapped on: day by day, poses in `POSE_SLOTS` order, then
 * that day's unclassified photos — the same order `PhotoVaultDayRow` renders.
 *
 * Takes the ALREADY-FILTERED days, so an active pose filter narrows the swipe
 * sequence for free and `all` spans the whole gallery. Pure projection over
 * metadata already in memory: no query, download or decrypt.
 */
export function flattenProgressDayPhotos(days: ProgressDay[]): GalleryPhoto[] {
  const ordered: GalleryPhoto[] = [];
  for (const day of days) {
    for (const pose of POSE_SLOTS) {
      const photo = day[pose];
      if (photo) ordered.push(photo);
    }
    // Empty on every filtered day (`filterProgressDays` drops them), so this
    // only contributes under `all`.
    ordered.push(...day.unclassified);
  }
  return ordered;
}
