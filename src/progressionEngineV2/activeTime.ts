import { addDaysLocal, compareLocalDates, type LocalDate } from '../scheduleEngine/calendar';
import type { ActiveTime } from '../workoutLifecycle/types';
import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';

/** Safety cap — no legitimate cycle is walked for more than ~10 years. */
const MAX_WALK_DAYS = 3660;

/** Weekly frequencies outside this range carry no usable inactivity signal. */
const MIN_FREQUENCY = 1;
const MAX_FREQUENCY = 7;

/**
 * How many consecutive days WITHOUT ANY TRAINING mean prolonged inactivity.
 *
 * `inactivityMissedOpportunityThreshold` is still expressed in *missed
 * opportunities* — that config field and its purpose are unchanged. What
 * changed is how an opportunity is located in the calendar: it is no longer a
 * named weekday (which made a recommendation behave like an obligation) but
 * the user's own training cadence, `7 / frequência` days. Three missed
 * opportunities at 3x/week is therefore 3 × ceil(7/3) = 9 consecutive untrained
 * days; at 6x/week it is 6 days; at 1x/week it is 21.
 *
 * `null` means "no usable signal, never pause" — an unknown or structurally
 * invalid frequency must never be able to invent inactivity (docs
 * progression/07).
 */
export function inactivityThresholdDays(
  prescribedTrainingFrequency: number | null | undefined,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): number | null {
  if (!Number.isInteger(prescribedTrainingFrequency)) return null;
  const frequency = prescribedTrainingFrequency as number;
  if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null;
  return config.inactivityMissedOpportunityThreshold * Math.ceil(7 / frequency);
}

export interface ComputeActiveTimeInput {
  /** Local date the current Training Cycle started (inclusive). */
  startDateInclusive: LocalDate;
  /** "Now", already resolved to the user's local date (inclusive). */
  todayLocalDate: LocalDate;
  /**
   * Consecutive untrained days that constitute prolonged inactivity, from
   * `inactivityThresholdDays`. `null`/absent never pauses.
   *
   * Use this for a window with ONE prescribed frequency. A cycle that went
   * through an ADAPT must pass `inactivityDayThresholdAt` instead, so each
   * historical period is judged by the cadence that was actually in force
   * then.
   */
  inactivityDayThreshold?: number | null;
  /**
   * Per-day threshold, for a window whose prescribed frequency changed
   * partway through. Takes precedence over the scalar above.
   *
   * Resolved at the CURSOR's date, which is what makes a pause decision
   * depend only on immutable facts: the window covering that day, and the
   * length of the silence up to it. A later frequency change therefore cannot
   * reinterpret an older stretch of inactivity — the defect that let a user
   * who lowered their weekly goal retroactively lose active days, adherence
   * and an eligibility they had already earned.
   */
  inactivityDayThresholdAt?: (date: LocalDate) => number | null;
  /**
   * Every local date with a recorded execution of ANY status in this cycle —
   * proof of engagement, distinct from `isValidProgressionSession`
   * (docs §26/§55).
   */
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
 * Algorithm (deterministic, explainable):
 *
 * Walk every calendar day from `startDateInclusive` to `todayLocalDate`.
 * - A day only counts toward `activeDays` while not paused.
 * - An ELAPSED day with no recorded execution extends an idle streak.
 *   Reaching `inactivityDayThreshold` freezes `activeDays` (pause).
 * - ANY recorded execution resets the streak and clears the pause — the user
 *   is back, active time resumes from where it froze, never resetting the
 *   accumulated total (docs §26).
 *
 * ## What this deliberately no longer does
 *
 * It no longer asks whether a RECOMMENDED weekday went by unused. Under the
 * current training model the calendar is a suggestion, so "SEG/QUA/SEX
 * recommended, TER/QUI/SÁB trained" used to accumulate three missed
 * opportunities in the first week and pause a user who never stopped
 * training. Inactivity is now measured as absence of training, which is the
 * thing it was always meant to detect; training LESS than the weekly goal is
 * a separate concept and is expressed by adherence alone, never by a pause.
 *
 * Today is never counted as a miss: only `cursor < todayLocalDate` days
 * extend the idle streak, so neither a future date nor the day still in
 * progress can be a consumed absence.
 */
export function computeActiveTime(
  input: ComputeActiveTimeInput,
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): ActiveTime {
  return computeActiveTimeTrace(input, config).activeTime;
}

/**
 * Same domain calculation as `computeActiveTime`, with the exact civil-date
 * membership exposed for consumers that must enumerate real weekly targets.
 * Keeping both outputs in one walk prevents adherence and the active-time
 * gate from developing subtly different pause/resume semantics.
 */
export function computeActiveTimeTrace(
  input: ComputeActiveTimeInput,
  _config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): ActiveTimeTrace {
  if (compareLocalDates(input.startDateInclusive, input.todayLocalDate) > 0) {
    return { activeTime: { activeDays: 0, pausedAt: null }, countedDates: new Set() };
  }

  const thresholdAt = input.inactivityDayThresholdAt
    ?? ((): ((date: LocalDate) => number | null) => {
      const fixed = input.inactivityDayThreshold ?? null;
      return () => fixed;
    })();
  const usable = (value: number | null): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

  let activeDays = 0;
  let idleDays = 0;
  let paused = false;
  let pausedAt: LocalDate | null = null;
  const countedDates = new Set<LocalDate>();
  let cursor = input.startDateInclusive;
  let guard = 0;

  while (compareLocalDates(cursor, input.todayLocalDate) <= 0 && guard < MAX_WALK_DAYS) {
    const isPastDay = compareLocalDates(cursor, input.todayLocalDate) < 0;
    const hasExecution = input.executionDates.has(cursor);

    if (hasExecution) {
      idleDays = 0;
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

    if (!hasExecution && isPastDay) {
      idleDays += 1;
      // The threshold of the day being TESTED — not of the cycle, and never
      // of a later period. The day that completes the streak is still counted
      // (the check above already ran): the pause takes effect from the day
      // AFTER it, which is the first day for which there is real evidence of
      // absence.
      const threshold = thresholdAt(cursor);
      if (usable(threshold) && idleDays >= threshold && !paused) {
        paused = true;
        pausedAt = cursor;
      }
    }

    cursor = addDaysLocal(cursor, 1);
    guard += 1;
  }

  return { activeTime: { activeDays, pausedAt }, countedDates };
}
