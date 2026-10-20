import { addDaysLocal, compareLocalDates, type LocalDate } from '../scheduleEngine/calendar';

/**
 * Daily activity streak — consecutive CALENDAR days on which the user
 * registered at least one valid activity (a finished workout OR a food entry).
 *
 * Deliberately separate from `src/home/streak.ts` (`computeStreak`), which
 * counts prescribed training OBLIGATIONS (`fixed`) or goal-met WEEKS
 * (`flexible`). That engine still drives adherence, the weekly overview and
 * the schedule surfaces and is NOT touched by this module. The two answer
 * different questions and must never be merged.
 *
 * ## What counts as a day
 *
 * A day counts exactly once, no matter how many activities happened in it.
 * The input is already a SET of registration days, so "1 workout + 3 meals"
 * collapses to one entry before it ever reaches this function.
 *
 * ## Registration day, not activity date (the retroactivity rule)
 *
 * The caller must build `activityDates` from the day each activity was
 * REGISTERED (server-proven), never from the date the user *says* the
 * activity happened. That is what makes back-dated entries unable to revive
 * a broken streak:
 *
 *  - Workouts: `performedLocalDate` is already server-validated to equal the
 *    execution's creation day in the user's timezone
 *    (`functions/src/workoutLifecycle/finalizeWorkoutSession.ts`), so a
 *    retroactive workout cannot exist at all.
 *  - Nutrition: the registration day is the day-document's immutable,
 *    server-set `createdAt` (Rules pin it to `request.time` and forbid
 *    changing it), NOT the diary date in the document id — which the client
 *    chooses freely. Logging today a meal dated three days ago therefore
 *    credits TODAY and leaves the broken streak broken.
 *
 * ## Today is a grace day, yesterday is not
 *
 * The day still in progress never breaks the streak: a user who trained
 * yesterday and has not logged anything yet today keeps their streak until
 * the day ends. But if YESTERDAY has no activity, the streak is already
 * gone — the walk below starts at today, credits it only if it has activity,
 * and then requires every earlier day to be present.
 */

export interface DailyActivityStreak {
  /** Consecutive days with at least one registered activity. */
  current: number;
  /**
   * `false` means `current` is a LOWER BOUND: the walk ran out of fetched
   * history before finding a real empty day, so the true streak may be
   * longer. Never present an incomplete value as an exact count, and never
   * let it trigger a milestone celebration.
   */
  complete: boolean;
}

export interface DailyActivityStreakInput {
  todayLocalDate: LocalDate;
  /** Days on which an activity was REGISTERED (see module doc). */
  activityDates: ReadonlySet<LocalDate>;
  /**
   * Earliest day `activityDates` exhaustively covers. When the walk would
   * need to look earlier than this, absence of data is not evidence of an
   * empty day, so it stops and reports `complete: false`.
   * `null`/omitted asserts the set is exhaustive back to the beginning.
   */
  historyAvailableFromLocalDate?: LocalDate | null;
}

/**
 * Safety bound against a pathological walk, not a product cap. The visual
 * tiers top out at 500, but the NUMBER keeps counting past it, so this has
 * to sit comfortably above any real streak.
 */
const MAX_DAY_WALK = 3650; // ~10 years

export function computeDailyActivityStreak(
  input: DailyActivityStreakInput,
): DailyActivityStreak {
  const floor = input.historyAvailableFromLocalDate ?? null;
  const belowFloor = (date: LocalDate) => floor !== null && compareLocalDates(date, floor) < 0;

  let count = 0;
  let cursor = input.todayLocalDate;

  // Today: credited when it has activity, skipped (never fatal) when it
  // doesn't — the day is still in progress.
  if (belowFloor(cursor)) return { current: 0, complete: false };
  if (input.activityDates.has(cursor)) count += 1;
  cursor = addDaysLocal(cursor, -1);

  // Every earlier day must be present; the first gap ends the streak.
  for (let i = 0; i < MAX_DAY_WALK; i += 1) {
    if (belowFloor(cursor)) return { current: count, complete: false };
    if (!input.activityDates.has(cursor)) return { current: count, complete: true };
    count += 1;
    cursor = addDaysLocal(cursor, -1);
  }

  return { current: count, complete: false };
}

/**
 * How far back the reader must fetch to resolve a streak of `expected` days
 * with one more day of slack for the terminating gap. Keeps the Home read
 * bounded instead of always scanning a fixed, oversized window.
 */
export function dailyActivityLookbackDays(expected: number): number {
  return Math.max(1, expected) + 2;
}

/**
 * The two independent sources, unioned into the day set the walk consumes.
 *
 * Kept as its own pure function because one product guarantee lives entirely
 * here: deleting a day's last food REVOKES the nutrition evidence but must
 * never revoke the day itself while a completed workout stands. The workout
 * side has no deletion operation at all — an execution is never un-completed
 * — so a day backed by training is permanent, and nutrition revocation can
 * only ever remove days that nothing else sustained.
 */
export function unionActivityDays(
  workoutDates: Iterable<LocalDate>,
  nutritionDates: Iterable<LocalDate>,
): Set<LocalDate> {
  const days = new Set<LocalDate>(nutritionDates);
  for (const date of workoutDates) days.add(date);
  return days;
}
