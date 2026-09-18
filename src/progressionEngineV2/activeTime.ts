import { addDaysLocal, compareLocalDates, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import type { ScheduleMode, Weekday } from '../state/AppState';
import type { ActiveTime } from '../workoutLifecycle/types';
import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';

/** Safety cap — no legitimate cycle is walked for more than ~10 years. */
const MAX_WALK_DAYS = 3660;

export interface ComputeActiveTimeInput {
  /** Local date the current Training Cycle started (inclusive). */
  startDateInclusive: LocalDate;
  /** "Now", already resolved to the user's local date (inclusive). */
  todayLocalDate: LocalDate;
  /** Prescribed weekly training days. Empty/unknown schedule never triggers a pause (docs progression/07 — no signal, no false inactivity). */
  trainingDays: readonly Weekday[];
  /** Flexible has no weekday debt, so inactivity cannot be inferred from a missed weekday. */
  scheduleMode?: ScheduleMode;
  /** Every `scheduledLocalDate` with a recorded execution of ANY status in this cycle — proof of engagement, distinct from `isValidProgressionSession` (docs §26/§55). */
  executionDates: ReadonlySet<LocalDate>;
}

export interface ActiveTimeTrace {
  activeTime: ActiveTime;
  /** Civil dates that belong to the effective progression window. */
  countedDates: ReadonlySet<LocalDate>;
}

/**
 * Active Time (docs progression/07, ADR-002, ADR-007): calendar time elapsed
 * in the current cycle, minus any prolonged-inactivity pause.
 *
 * Algorithm (deterministic, explainable — the exact detection rule is left
 * open by the docs, resolved here and recorded in ADR-007):
 *
 * Walk every calendar day from `startDateInclusive` to `todayLocalDate`.
 * - A day only counts toward `activeDays` while not paused.
 * - A *prescribed* day (per `trainingDays`) with no recorded execution
 *   increments a "consecutive missed opportunity" streak. Reaching
 *   `inactivityMissedOpportunityThreshold` freezes `activeDays` (pause).
 * - Rest days (not prescribed) never affect the streak — they are normal
 *   programming, not disengagement (docs §22, §25).
 * - ANY recorded execution (prescribed day or not) resets the streak and
 *   clears the pause — the user is back, active time resumes from where it
 *   froze, never resetting the accumulated total (docs §26).
 *
 * The threshold is expressed in *missed prescribed opportunities*, not raw
 * calendar days, so a 2x/week and a 6x/week schedule are held to the same
 * standard of "how many expected sessions in a row were skipped", not the
 * same wall-clock gap.
 */
export function computeActiveTime(
  input: ComputeActiveTimeInput,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): ActiveTime {
  return computeActiveTimeTrace(input, config).activeTime;
}

/**
 * Same domain calculation as `computeActiveTime`, with the exact civil-date
 * membership exposed for consumers that must enumerate real prescribed
 * opportunities. Keeping both outputs in one walk prevents adherence and the
 * active-time gate from developing subtly different pause/resume semantics.
 */
export function computeActiveTimeTrace(
  input: ComputeActiveTimeInput,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): ActiveTimeTrace {
  if (compareLocalDates(input.startDateInclusive, input.todayLocalDate) > 0) {
    return { activeTime: { activeDays: 0, pausedAt: null }, countedDates: new Set() };
  }

  const prescribedDays = new Set(input.trainingDays);
  const threshold = config.inactivityMissedOpportunityThreshold;

  let activeDays = 0;
  let consecutiveMissed = 0;
  let paused = false;
  let pausedAt: LocalDate | null = null;
  const countedDates = new Set<LocalDate>();
  let cursor = input.startDateInclusive;
  let guard = 0;

  while (compareLocalDates(cursor, input.todayLocalDate) <= 0 && guard < MAX_WALK_DAYS) {
    const isPastDay = compareLocalDates(cursor, input.todayLocalDate) < 0;
    const isPrescribedDay = prescribedDays.has(weekdayOfLocalDate(cursor));
    const hasExecution = input.executionDates.has(cursor);

    if (hasExecution) {
      consecutiveMissed = 0;
      if (paused) {
        paused = false;
        pausedAt = null;
      }
    }

    // A real return is part of the resumed active window. Clearing the pause
    // before counting fixes the old boundary where the return day engaged the
    // user but was silently excluded from both Active Time and adherence.
    if (!paused) {
      activeDays += 1;
      countedDates.add(cursor);
    }

    if (input.scheduleMode !== 'flexible' && !hasExecution && isPrescribedDay && isPastDay) {
      consecutiveMissed += 1;
      if (consecutiveMissed >= threshold && !paused) {
        paused = true;
        pausedAt = cursor;
      }
    }

    cursor = addDaysLocal(cursor, 1);
    guard += 1;
  }

  return { activeTime: { activeDays, pausedAt }, countedDates };
}
