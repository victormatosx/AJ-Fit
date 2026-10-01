import type { ScheduleMode, Weekday } from '../state/AppState';
import { addDaysLocal, compareLocalDates, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import { classifyDayStatus } from './weekOverview';
import { mondayOfWeek, weekDates } from './calendarWeek';

/**
 * "Streak" (Home) — consecutive prescribed training obligations fulfilled,
 * never consecutive calendar days. Product definition (2026-10):
 *
 *   - `fixed` schedules prescribe specific weekdays, so the streak's unit is
 *     individual obligations (`unit: 'obligations'`): one per trainingDay
 *     fulfilled, walking backward from today day by day via the same
 *     `classifyDayStatus` precedence `buildWeekOverview` uses.
 *   - `flexible` schedules prescribe a weekly frequency target, not specific
 *     weekdays (`weekOverview.ts` never marks a flexible day MISSED — see
 *     `classifyDayStatus`). There is no single prescribed obligation to walk
 *     day by day, so the streak's unit is consecutive weeks whose weekly
 *     goal was met (`unit: 'weeks'`). `fixed` and `flexible` streaks are
 *     DIFFERENT units and must never be rendered or compared as the same
 *     number without checking `unit` first.
 *
 * Both walks are driven purely by real completion evidence
 * (`completedDates`/`fulfilledScheduledDates`) and the CURRENT
 * ScheduleConfig — never by `activatedAtLocalDate`/program identity. This is
 * deliberate: `workoutProgramState/scheduleConfig` is a single user-scoped
 * document, not versioned per program (`src/services/workoutSchedule.ts:61-62,
 * 113-116`), so switching programs never changes which weekdays are
 * prescribed and is never itself a reason to reset or reinterpret the
 * streak. The walk simply stops at the first real, elapsed gap — whether
 * that gap is a genuine miss or the edge of the user's history before any
 * program existed, the practical effect (stop counting) is identical, so no
 * separate "before program" floor is needed here.
 *
 * Known limitation, inherited from `weekOverview.ts`/`frequencyHeatmap.ts`,
 * not unique to streak: if the user edits `trainingDays`/`scheduleMode`
 * directly (not a program switch — `scheduleConfig` has no version history),
 * days before that edit are evaluated against the CURRENT config. This is a
 * pre-existing, accepted class of limitation across the home calendar
 * surface, just more visible here due to streak's longer lookback.
 */
export type Streak =
  | {
      scheduleMode: 'fixed';
      /** Prescribed training obligations fulfilled consecutively — never a calendar-day count. */
      unit: 'obligations';
      current: number;
      /** See `StreakInput.historyAvailableFromLocalDate` — `false` means `current` is a LOWER BOUND, not an exact count: the walk ran out of fetched history before finding a real break. Never render this as if it were exact. */
      complete: boolean;
    }
  | {
      scheduleMode: 'flexible';
      /** Consecutive calendar weeks whose weekly frequency goal was met. */
      unit: 'weeks';
      current: number;
      /** Same meaning as the `fixed` variant's `complete`, at week granularity. */
      complete: boolean;
    };

export interface StreakInput {
  todayLocalDate: LocalDate;
  scheduleMode?: ScheduleMode;
  /** Weekly target for `flexible` schedules; ignored for `fixed`. */
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  /** All-time completed local dates, not just the current week/window. */
  completedDates: ReadonlySet<LocalDate>;
  /** All-time fulfilled-early scheduled dates (`fixed` only). */
  fulfilledScheduledDates?: ReadonlySet<LocalDate>;
  /**
   * Earliest local date `completedDates`/`fulfilledScheduledDates` are
   * guaranteed to exhaustively cover (e.g. the `from` bound of whatever
   * Firestore range the caller fetched). When the backward walk would need
   * to look earlier than this to keep counting, treating "no entry found"
   * as "no entry EXISTS" would be wrong — absence of fetched data is not
   * evidence of a miss. The walk instead STOPS there and reports
   * `complete: false`, so the caller knows `current` is a lower bound, not
   * an exact count (see the Phase 2.5 report's truncation diagnosis).
   *
   * `null`/omitted asserts `completedDates` is already exhaustive back to
   * the beginning of time — the walk then only stops on a real MISSED
   * day/unmet week, or the `MAX_*_WALK` safety cap (also `complete: false`,
   * since that cap exists purely to bound pathological input, not as a
   * trustworthy product answer). This is the right default for callers
   * (tests, small fixtures) that already hand over a complete dataset.
   */
  historyAvailableFromLocalDate?: LocalDate | null;
}

// Defensive guards against a pathological infinite walk (e.g. a malformed
// zero-length trainingDays list) — NOT a product-level streak cap. A
// legitimate caller should always supply `historyAvailableFromLocalDate`
// well inside this bound (see `useWidgetSnapshotSync`'s incremental fetch),
// so in practice the floor check below is what stops the walk, not this.
const MAX_DAY_WALK = 3650; // ~10 years
const MAX_WEEK_WALK = 520; // ~10 years

function computeFixedStreak(input: StreakInput): { current: number; complete: boolean } {
  const trainingSet = new Set(input.trainingDays);
  const recoverySet = new Set(input.activeRecoveryDays);
  const floor = input.historyAvailableFromLocalDate ?? null;

  let cursor = input.todayLocalDate;
  let count = 0;

  for (let i = 0; i < MAX_DAY_WALK; i += 1) {
    if (floor !== null && compareLocalDates(cursor, floor) < 0) {
      return { current: count, complete: false };
    }

    const status = classifyDayStatus({
      localDate: cursor,
      weekday: weekdayOfLocalDate(cursor),
      todayLocalDate: input.todayLocalDate,
      scheduleMode: 'fixed',
      trainingSet,
      recoverySet,
      // Deliberately null — see module doc comment: streak is never gated
      // by program activation, only by real completion evidence.
      activatedAtLocalDate: null,
      completedDates: input.completedDates,
      fulfilledScheduledDates: input.fulfilledScheduledDates,
    });

    if (status === 'COMPLETED' || status === 'TODAY_COMPLETED') {
      count += 1;
    } else if (status === 'MISSED') {
      return { current: count, complete: true };
    }
    // FULFILLED_EARLY: the obligation was already counted on the day it was
    // actually performed — no increment, no break (user's own example: Wed
    // #5, Fri's session done Thu = #6, Fri itself stays #6).
    // REST / ACTIVE_RECOVERY / TODAY_PENDING / UPCOMING: no obligation here,
    // continue walking backward without counting or breaking.

    cursor = addDaysLocal(cursor, -1);
  }

  return { current: count, complete: false };
}

function computeFlexibleStreak(input: StreakInput): { current: number; complete: boolean } {
  const goal = input.prescribedTrainingFrequency ?? 0;
  if (goal <= 0) return { current: 0, complete: true };
  const floor = input.historyAvailableFromLocalDate ?? null;

  let weekStart = mondayOfWeek(input.todayLocalDate);
  let count = 0;

  for (let i = 0; i < MAX_WEEK_WALK; i += 1) {
    if (floor !== null && compareLocalDates(weekStart, floor) < 0) {
      return { current: count, complete: false };
    }

    const days = weekDates(weekStart);
    const completedInWeek = days.reduce(
      (total, localDate) => total + (input.completedDates.has(localDate) ? 1 : 0),
      0,
    );
    const goalMet = completedInWeek >= goal;
    const isCurrentWeek = i === 0;

    if (isCurrentWeek) {
      // Never break on the in-progress week — the goal can still be met
      // before it ends. Credit it immediately if already met (mirrors
      // `fixed`'s FULFILLED_EARLY: fulfilling early advances the streak
      // right away, it never waits for the week to formally close).
      if (goalMet) count += 1;
    } else if (goalMet) {
      count += 1;
    } else {
      return { current: count, complete: true };
    }

    weekStart = addDaysLocal(weekStart, -7);
  }

  return { current: count, complete: false };
}

export function computeStreak(input: StreakInput): Streak {
  if (input.scheduleMode === 'flexible') {
    const result = computeFlexibleStreak(input);
    return { scheduleMode: 'flexible', unit: 'weeks', ...result };
  }
  const result = computeFixedStreak(input);
  return { scheduleMode: 'fixed', unit: 'obligations', ...result };
}
