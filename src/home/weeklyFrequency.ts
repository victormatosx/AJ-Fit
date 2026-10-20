import { addDaysLocal, compareLocalDates, type LocalDate } from '../scheduleEngine/calendar';
import { mondayOfWeek, weekDates } from './calendarWeek';

/**
 * "Frequência semanal" (Home) — how many DISTINCT days of the current week
 * the user actually trained, over their weekly goal.
 *
 *     frequência = min(100, diasTreinados / metaSemanal × 100)
 *
 * Deliberately independent of the calendar's recommended weekdays. Under the
 * new training model those weekdays are a suggestion, never an obligation, so
 * training on a day that was not recommended counts exactly the same and
 * skipping a recommended day costs nothing beyond the day itself. That is the
 * whole difference from `src/home/streak.ts`'s `computeStreak`, which counts
 * prescribed obligations and is left untouched for adherence/progression.
 *
 * ## What counts as a trained day
 *
 * A day with at least one execution in a terminal, credited state —
 * `COMPLETED` or `PARTIALLY_COMPLETED`, the same pair every other credited
 * surface uses (`listCompletedWorkoutActivityDatesInRange`,
 * `authorizeMutation`'s earned-cycle accounting). `ABANDONED` and
 * `IN_PROGRESS` never count, and merely SELECTING a session writes no
 * execution at all, so it cannot count either.
 *
 * Counted by the day the session was PERFORMED, never by the day it was
 * scheduled for: those differ whenever a session was completed ahead of its
 * own opportunity, and the user trained on the day of the effort.
 *
 * Two sessions in one day are still one day — the unit is the day.
 *
 * ## Over-achievement is kept, not clamped away
 *
 * `percent` is capped at 100 so the ring never overflows, but `trainedDays`
 * and `extraDays` carry the real numbers so the UI can say "6 de 5".
 */

export interface WeeklyFrequency {
  /** Monday of the week this describes. */
  weekStartLocalDate: LocalDate;
  /** Distinct days trained in the week (uncapped). */
  trainedDays: number;
  /** The goal in force for this week; `null` when unknown/invalid. */
  goal: number | null;
  /** `0..100`, rounded to an integer; `null` when there is no usable goal. */
  percent: number | null;
  /** Days beyond the goal — `0` unless the goal was exceeded. */
  extraDays: number;
  /** True once `trainedDays >= goal`. */
  goalMet: boolean;
  /** The actual dates counted, in order — what the week strip highlights. */
  trainedLocalDates: LocalDate[];
}

/** Weekly goals outside this range are treated as unusable rather than clamped. */
const MIN_GOAL = 1;
const MAX_GOAL = 7;

export function isValidWeeklyGoal(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_GOAL && (value as number) <= MAX_GOAL;
}

export interface WeeklyFrequencyInput {
  todayLocalDate: LocalDate;
  /** Weekly target. Absent/invalid yields `percent: null`, never a divide-by-zero or a fake 0%. */
  goal: number | null | undefined;
  /** Days with a credited execution, by PERFORMED date. May span more than this week. */
  performedLocalDates: ReadonlySet<LocalDate>;
  /**
   * Which week to describe, as an offset from the current one (`0` = this
   * week, `-1` = last week). Lets the same pure function serve history
   * without a second implementation.
   */
  weekOffset?: number;
}

export function computeWeeklyFrequency(input: WeeklyFrequencyInput): WeeklyFrequency {
  const weekStartLocalDate = addDaysLocal(mondayOfWeek(input.todayLocalDate), (input.weekOffset ?? 0) * 7);
  // Only elapsed days can have been trained; a future date in `performedLocalDates`
  // would be data corruption and is ignored rather than credited.
  const trainedLocalDates = weekDates(weekStartLocalDate).filter((localDate) =>
    compareLocalDates(localDate, input.todayLocalDate) <= 0 && input.performedLocalDates.has(localDate));
  const trainedDays = trainedLocalDates.length;
  const goal = isValidWeeklyGoal(input.goal) ? input.goal : null;

  return {
    weekStartLocalDate,
    trainedDays,
    goal,
    percent: goal === null ? null : Math.min(100, Math.round((trainedDays / goal) * 100)),
    extraDays: goal === null ? 0 : Math.max(0, trainedDays - goal),
    goalMet: goal !== null && trainedDays >= goal,
    trainedLocalDates,
  };
}

/**
 * The weekly goal in force during a given week, reconstructed from the
 * program instances that were actually active then.
 *
 * `workoutProgramState/scheduleConfig` is a single overwritten document with
 * no history, so it can never answer "what was the goal in March?". The goal
 * itself, however, is `prescribedTrainingFrequency` on
 * `workoutPrograms/{programId}` — a SEALED, immutable document — and its
 * period of validity is delimited by its instance's `activatedAt` /
 * `supersededAt`. Changing the weekly frequency goes through `ADAPT`, which
 * supersedes the instance and activates a new one, so every past week has a
 * recoverable goal with no new storage at all.
 *
 * Selection rule when several instances overlap one week: the instance that
 * covered the most days of that week wins; ties go to the most recent
 * activation, which is the one the user was actually looking at by week's end.
 * The current week deliberately uses the goal in force NOW — raising the goal
 * mid-week makes today's ring harder, it does not rewrite the week.
 */
export interface ProgramInstanceGoalWindow {
  goal: number;
  /** Local date the instance became active (inclusive). */
  activatedAtLocalDate: LocalDate;
  /** Local date it was superseded (inclusive); `null` while still active. */
  supersededAtLocalDate: LocalDate | null;
}

export function weeklyGoalForWeek(
  weekStartLocalDate: LocalDate,
  windows: readonly ProgramInstanceGoalWindow[],
): number | null {
  const week = weekDates(weekStartLocalDate);
  let best: { goal: number; days: number; activatedAt: LocalDate } | null = null;

  for (const window of windows) {
    if (!isValidWeeklyGoal(window.goal)) continue;
    const days = week.filter((localDate) =>
      compareLocalDates(localDate, window.activatedAtLocalDate) >= 0
      && (window.supersededAtLocalDate === null
        || compareLocalDates(localDate, window.supersededAtLocalDate) <= 0)).length;
    if (days === 0) continue;
    const better = best === null
      || days > best.days
      || (days === best.days && compareLocalDates(window.activatedAtLocalDate, best.activatedAt) > 0);
    if (better) best = { goal: window.goal, days, activatedAt: window.activatedAtLocalDate };
  }

  return best?.goal ?? null;
}
