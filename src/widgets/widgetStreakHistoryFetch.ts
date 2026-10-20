import { addDaysLocal, type LocalDate } from '../scheduleEngine/calendar';
import { computeStreak, type Streak, type StreakInput } from '../home/streak';
import {
  computeDailyActivityStreak,
  dailyActivityLookbackDays,
  unionActivityDays,
  type DailyActivityStreak,
} from '../home/dailyActivityStreak';

/**
 * Phase 2.5 fix for the Phase 2 truncation bug: fetching a single fixed
 * 180-day window and handing it to `computeStreak` could silently
 * UNDER-report a real streak longer than 180 days — the walk would hit a
 * day with no `completedDates` entry simply because it was never fetched,
 * and (before Phase 2.5) had no way to tell that apart from a real miss.
 *
 * `computeStreak` now accepts `historyAvailableFromLocalDate` and reports
 * `complete: false` instead of guessing when it runs out of fetched data.
 * This module uses that signal to grow the fetch window — doubling each
 * time — until `computeStreak` reports a genuine break (`complete: true`)
 * or the hard safety cap is reached. For the overwhelming majority of
 * users (any real gap within the base window), this is exactly ONE query,
 * byte-for-byte the same cost as before. Only a genuinely unbroken streak
 * longer than the base window pays for additional queries — and even then,
 * at most `log2(MAX/BASE) ≈ 3` extra ones.
 */

/** Deliberately the same starting point Phase 2 used — see the Phase 2.5 report §A for the cost analysis. */
export const WIDGET_STREAK_BASE_LOOKBACK_DAYS = 180;

/**
 * Hard safety cap. ~3 years. Beyond this, `computeStreak` still returns
 * `complete: false` (never silently promoted to "exact") — the CALLER
 * (`buildWidgetSnapshot`, by way of `streak.complete`) is responsible for
 * ever surfacing that uncertainty, this module never lies about it either.
 */
export const WIDGET_STREAK_MAX_LOOKBACK_DAYS = 1095;

export type CompletedWorkoutActivityDatesFetcher = (
  uid: string,
  fromLocalDate: LocalDate,
  toLocalDate: LocalDate,
) => Promise<{ performedDates: string[]; scheduledDates: string[] }>;

export interface FetchWidgetStreakHistoryInput {
  uid: string;
  todayLocalDate: LocalDate;
  /** Everything `computeStreak` needs except the completion data and the floor, which this function determines. */
  streakInput: Omit<StreakInput, 'todayLocalDate' | 'completedDates' | 'fulfilledScheduledDates' | 'historyAvailableFromLocalDate'>;
  fetchRange: CompletedWorkoutActivityDatesFetcher;
}

export interface FetchWidgetStreakHistoryResult {
  completedDates: ReadonlySet<LocalDate>;
  fulfilledScheduledDates: ReadonlySet<LocalDate>;
  /** The actual `from` bound used for the LAST (successful or capped) fetch — pass straight into `buildWidgetSnapshot`'s `historyAvailableFromLocalDate`. */
  historyAvailableFromLocalDate: LocalDate;
  streak: Streak;
  /** How many days were actually fetched — 180 for the common case, more only for a genuinely long streak. Exposed for logging/telemetry, not required by callers. */
  lookbackDaysUsed: number;
}

export async function fetchWidgetStreakHistory(
  input: FetchWidgetStreakHistoryInput,
): Promise<FetchWidgetStreakHistoryResult> {
  let lookbackDays = WIDGET_STREAK_BASE_LOOKBACK_DAYS;

  for (;;) {
    const from = addDaysLocal(input.todayLocalDate, -lookbackDays);
    const dates = await input.fetchRange(input.uid, from, input.todayLocalDate);
    const completedDates = new Set(dates.performedDates);
    const fulfilledScheduledDates = new Set(dates.scheduledDates);
    const streak = computeStreak({
      ...input.streakInput,
      todayLocalDate: input.todayLocalDate,
      completedDates,
      fulfilledScheduledDates,
      historyAvailableFromLocalDate: from,
    });

    if (streak.complete || lookbackDays >= WIDGET_STREAK_MAX_LOOKBACK_DAYS) {
      return {
        completedDates,
        fulfilledScheduledDates,
        historyAvailableFromLocalDate: from,
        streak,
        lookbackDaysUsed: lookbackDays,
      };
    }

    lookbackDays = Math.min(lookbackDays * 2, WIDGET_STREAK_MAX_LOOKBACK_DAYS);
  }
}

/**
 * Chama 2.0 for the widget — the SAME metric the Home shows.
 *
 * Deliberately reuses `computeDailyActivityStreak` and the two activity
 * readers rather than deriving a second definition: the widget and the Home
 * must never disagree about the number, the colour or the break rule, and the
 * only way to guarantee that is to share the computation.
 *
 * Same incremental widening strategy as `fetchWidgetStreakHistory` above: a
 * small window first, doubling only while the streak is still unresolved, so
 * the common case costs one pair of queries instead of a 500-day scan on
 * every widget resync.
 */
export const WIDGET_DAILY_STREAK_BASE_LOOKBACK_DAYS = 35;
export const WIDGET_DAILY_STREAK_MAX_LOOKBACK_DAYS = dailyActivityLookbackDays(520);

export interface FetchWidgetDailyActivityStreakInput {
  uid: string;
  todayLocalDate: LocalDate;
  /** Canonical streak timezone and aggregate coverage floor (`streakSettings`). */
  settings: { timezone: string; nutritionEvidenceFrom: LocalDate | null };
  fetchWorkoutRange: CompletedWorkoutActivityDatesFetcher;
  fetchNutritionDays: (input: {
    uid: string; fromLocalDate: LocalDate; timezone: string; evidenceFrom: LocalDate | null;
  }) => Promise<Set<LocalDate>>;
}

export async function fetchWidgetDailyActivityStreak(
  input: FetchWidgetDailyActivityStreakInput,
): Promise<{ streak: DailyActivityStreak; lookbackDaysUsed: number }> {
  let lookbackDays = WIDGET_DAILY_STREAK_BASE_LOOKBACK_DAYS;

  for (;;) {
    const fromLocalDate = addDaysLocal(input.todayLocalDate, -lookbackDays);
    const [workout, nutrition] = await Promise.all([
      input.fetchWorkoutRange(input.uid, fromLocalDate, input.todayLocalDate),
      input.fetchNutritionDays({
        uid: input.uid,
        fromLocalDate,
        timezone: input.settings.timezone,
        evidenceFrom: input.settings.nutritionEvidenceFrom,
      }),
    ]);
    const streak = computeDailyActivityStreak({
      todayLocalDate: input.todayLocalDate,
      activityDates: unionActivityDays(workout.performedDates as LocalDate[], nutrition),
      historyAvailableFromLocalDate: fromLocalDate,
    });
    if (streak.complete || lookbackDays >= WIDGET_DAILY_STREAK_MAX_LOOKBACK_DAYS) {
      return { streak, lookbackDaysUsed: lookbackDays };
    }
    lookbackDays = Math.min(lookbackDays * 2, WIDGET_DAILY_STREAK_MAX_LOOKBACK_DAYS);
  }
}
