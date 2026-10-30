import { compareLocalDates, type LocalDate } from '../scheduleEngine/calendar';
import { mondayOfWeek } from '../home/calendarWeek';
import {
  isValidWeeklyGoal,
  weeklyGoalForWeek,
  type ProgramInstanceGoalWindow,
} from '../home/weeklyFrequency';
import type { ActiveTime, Adherence } from '../workoutLifecycle/types';
import { adherenceBasisPoints, computeAdherence } from './adherence';
import { computeActiveTimeTrace, inactivityThresholdDays } from './activeTime';
import { collectWeeklyTrainedDays } from './prescribedOpportunities';
import type { PrescribedSessionShape } from './sessionQualification';
import { PROGRESSION_V2_CONFIG, type ProgressionV2Config } from './config';

/**
 * Progression accounting for a whole TrainingCycle, across every
 * ProgramInstance that belonged to it.
 *
 * ## Why this module exists
 *
 * Changing the weekly frequency goes through ADAPT, which supersedes the
 * active ProgramInstance and activates a new one INSIDE THE SAME TrainingCycle
 * (`adaptWorkoutProgram` passes `expectedCycleId` and deliberately no
 * `nextCycle`; the authority's ADAPT grant writes the new instance with the
 * same `cycleId`). The domain was therefore always cycle-scoped — but every
 * reader was instance-scoped: Active Time started at
 * `activeInstance.activatedAt` and adherence only ever saw that one instance's
 * executions. So adapting a routine silently reset the progress the user had
 * already earned, which is the defect this module removes.
 *
 * Everything here is cycle-scoped and nothing is carried ACROSS cycles: the
 * caller passes the windows of ONE cycle, and an earned evolution (which does
 * open a new cycle) therefore starts from zero exactly as before.
 *
 * ## The rule, stated once
 *
 *     meta(semana)     = min(frequência vigente naquela semana, dias ativos na semana)
 *     cumprido(semana) = min(meta(semana), dias DISTINTOS treinados na semana)
 *     ratio            = Σ cumprido / Σ meta        (capped at 1.0)
 *
 * It is the same rule for every account — there is no fixed/flexible/pilot
 * variant. Recommended weekdays are recommendations: they are not an input to
 * this calculation at all.
 *
 * ## What keeps history honest
 *
 * - The frequency used for a week is the one that was IN FORCE that week,
 *   reconstructed by `weeklyGoalForWeek` from the instances' immutable
 *   `activatedAt`/`supersededAt` windows and their sealed
 *   `prescribedTrainingFrequency`. A frequency change therefore never
 *   rewrites an older week's goal.
 * - `weeklyGoalForWeek` returns exactly ONE goal per week, so the week in
 *   which the frequency changed — mid-week included — can never produce two
 *   full targets.
 * - Trained DAYS are unioned across instances before being capped, so two
 *   instances of the same cycle holding a record for the same date credit one
 *   day, never two.
 * - Every integrity guard of the single-instance counter is preserved per
 *   instance: the execution must belong to that instance, a matching
 *   `COMPLETED` schedule-ledger event must exist, and
 *   `isValidProgressionSessionAgainstPrescription` must accept it against
 *   that instance's own immutable prescription snapshot. Nothing here reads a
 *   counter that was ever displayed in the UI.
 */

export interface CycleInstanceProgressionWindow {
  programInstanceId: string;
  /** Local date the instance became active (inclusive). */
  activatedAtLocalDate: LocalDate;
  /** Local date it was superseded (inclusive); `null` while still active. */
  supersededAtLocalDate: LocalDate | null;
  /** Sealed weekly goal of this instance's program. */
  prescribedTrainingFrequency: number;
  /** This instance's immutable prescription, for session qualification. */
  prescribedSessions: readonly PrescribedSessionShape[];
}

export interface CycleProgressionExecution {
  programInstanceId?: string;
  sessionIndex: number;
  scheduledLocalDate: string;
  performedLocalDate?: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  exercises: readonly {
    exerciseIndex?: number;
    exerciseId?: string;
    prescribedExerciseId?: string;
    sets: readonly { setIndex?: number; status: 'PENDING' | 'COMPLETED' | 'SKIPPED' }[];
  }[];
}

export interface CycleProgressionScheduleEvent {
  type: 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED' | 'REPOSITIONED';
  programInstanceId?: string;
  sessionIndex: number;
  scheduledDate: string;
}

export interface CycleProgression {
  /** Local date the cycle's FIRST instance activated — the window's origin. */
  cycleStartLocalDate: LocalDate;
  activeTime: ActiveTime;
  countedDates: ReadonlySet<LocalDate>;
  /** Monday -> target, one entry per week with a usable goal. */
  weeklyTargets: ReadonlyMap<LocalDate, number>;
  expectedSessions: number;
  validSessionCount: number;
  adherence: Adherence;
  /**
   * The SAME integer the EARN authority records in the immutable ledger
   * (`adherenceBasisPoints`). Exposed so every caller transports or displays
   * this one value instead of re-deriving it from `adherence.ratio`.
   */
  adherenceAtEarnBp: number;
  /** Distinct credited training days, deduplicated across instances. */
  trainedLocalDates: ReadonlySet<LocalDate>;
  /**
   * Consecutive untrained days that would freeze Active Time, as of TODAY
   * (`null` = never). Diagnostics only — the walk itself resolves the
   * threshold per day from the window in force then, see
   * `cycleInactivityDayThresholdAt`.
   */
  inactivityDayThreshold: number | null;
}

/**
 * Per-week targets for a cycle whose weekly goal may have changed partway
 * through.
 *
 * `min(meta, dias ativos)` is what keeps a partial week honest: the week a
 * cycle starts mid-Thursday expects at most the days it actually had, and the
 * week still in progress expects at most the days elapsed. A week whose goal
 * cannot be reconstructed (no instance covered it, or the sealed goal is
 * structurally invalid) yields NO target — it is neither expected nor
 * creditable, which is strictly safer than inventing a denominator.
 */
export function buildCycleWeeklyTargets(input: {
  countedActiveDates: ReadonlySet<LocalDate>;
  goalWindows: readonly ProgramInstanceGoalWindow[];
}): ReadonlyMap<LocalDate, number> {
  const activeDaysByWeek = new Map<LocalDate, number>();
  for (const date of input.countedActiveDates) {
    const week = mondayOfWeek(date);
    activeDaysByWeek.set(week, (activeDaysByWeek.get(week) ?? 0) + 1);
  }
  const targets = new Map<LocalDate, number>();
  for (const [week, activeDays] of activeDaysByWeek) {
    const goal = weeklyGoalForWeek(week, input.goalWindows);
    if (goal === null) continue;
    targets.set(week, Math.min(goal, activeDays));
  }
  return targets;
}

function goalWindowsOf(
  windows: readonly CycleInstanceProgressionWindow[],
): ProgramInstanceGoalWindow[] {
  return windows.map((window) => ({
    goal: window.prescribedTrainingFrequency,
    activatedAtLocalDate: window.activatedAtLocalDate,
    supersededAtLocalDate: window.supersededAtLocalDate,
  }));
}

/**
 * The ProgramInstance window that was in force on `date`.
 *
 * Windows are `[activatedAt, supersededAt]` inclusive on both ends, and an
 * ADAPT writes the same instant as one window's `supersededAt` and the next
 * one's `activatedAt` — so the changeover day belongs to both. The LATEST
 * window that had already activated by `date` wins, which resolves that
 * overlap the same way `weeklyGoalForWeek` does (ties to the most recent
 * activation) and keeps the two in agreement.
 *
 * `windows` must be sorted ascending by `activatedAtLocalDate`.
 */
function windowInForceOn(
  windows: readonly CycleInstanceProgressionWindow[],
  date: LocalDate,
): CycleInstanceProgressionWindow | null {
  let match: CycleInstanceProgressionWindow | null = null;
  for (const window of windows) {
    if (compareLocalDates(window.activatedAtLocalDate, date) > 0) break;
    match = window;
  }
  return match;
}

/**
 * The inactivity tolerance in force on each day of the cycle.
 *
 * Deliberately NOT a single value for the whole cycle. Taking one — the
 * lowest frequency the cycle ever prescribed was the first attempt — makes a
 * pause decision depend on a LATER, unrelated choice: lowering the weekly
 * goal lengthened the tolerance retroactively, un-paused old silent
 * stretches, let those weeks back into the counted window carrying their own
 * historical goals with zero fulfilment, and so collapsed the ratio. Measured
 * on the real engine, a Beginner at 54 active days / 89.36% became 70 active
 * days / 68.85% — losing an eligibility they had already earned — purely by
 * adapting 6x to 1x.
 *
 * Resolving per day fixes it by construction: the answer for a given date
 * depends only on the window covering that date, which is immutable once
 * superseded. Successive frequency changes therefore cannot produce different
 * results for the same closed history, and the same history always yields the
 * same `countedDates`, `activeDays`, adherence and eligibility.
 *
 * A date with no usable prescribed frequency yields `null` — no signal, no
 * false inactivity (docs progression/07).
 */
export function cycleInactivityDayThresholdAt(
  windows: readonly CycleInstanceProgressionWindow[],
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): (date: LocalDate) => number | null {
  const cache = new Map<LocalDate, number | null>();
  return (date: LocalDate) => {
    const cached = cache.get(date);
    if (cached !== undefined) return cached;
    const window = windowInForceOn(windows, date);
    const resolved = window && isValidWeeklyGoal(window.prescribedTrainingFrequency)
      ? inactivityThresholdDays(window.prescribedTrainingFrequency, config)
      : null;
    cache.set(date, resolved);
    return resolved;
  };
}

export function computeCycleProgression(
  input: {
    windows: readonly CycleInstanceProgressionWindow[];
    todayLocalDate: LocalDate;
    /** Executions of every instance in the cycle, in any order. */
    executions: readonly CycleProgressionExecution[];
    /** Schedule-ledger events of every instance in the cycle, in any order. */
    scheduleEvents: readonly CycleProgressionScheduleEvent[];
  },
  config: ProgressionV2Config = PROGRESSION_V2_CONFIG,
): CycleProgression | null {
  if (input.windows.length === 0) return null;
  const sorted = [...input.windows].sort((left, right) =>
    compareLocalDates(left.activatedAtLocalDate, right.activatedAtLocalDate));
  const cycleStartLocalDate = sorted[0].activatedAtLocalDate;

  // Proof of ENGAGEMENT, not of credit: any recorded execution of any status
  // counts, on both the day it was scheduled for and the day it was actually
  // performed. Taking both is deliberate — an execution is evidence the user
  // showed up, and the stricter reading could only ever invent an absence.
  const engagementDates = new Set<LocalDate>();
  for (const execution of input.executions) {
    if (typeof execution.scheduledLocalDate === 'string') engagementDates.add(execution.scheduledLocalDate);
    if (typeof execution.performedLocalDate === 'string') engagementDates.add(execution.performedLocalDate);
  }

  const inactivityDayThresholdAt = cycleInactivityDayThresholdAt(sorted, config);
  const trace = computeActiveTimeTrace({
    startDateInclusive: cycleStartLocalDate,
    todayLocalDate: input.todayLocalDate,
    inactivityDayThresholdAt,
    executionDates: engagementDates,
  }, config);

  const weeklyTargets = buildCycleWeeklyTargets({
    countedActiveDates: trace.countedDates,
    goalWindows: goalWindowsOf(sorted),
  });

  // Union of DAYS per week across instances: two instances of this cycle with
  // a credited record on the same date are one trained day.
  const trainedDaysByWeek = new Map<LocalDate, Set<LocalDate>>();
  for (const window of sorted) {
    const perInstance = collectWeeklyTrainedDays({
      programInstanceId: window.programInstanceId,
      executions: input.executions,
      scheduleEvents: input.scheduleEvents,
      prescribedSessions: window.prescribedSessions,
      weeklyTargets,
    });
    for (const [week, days] of perInstance) {
      const merged = trainedDaysByWeek.get(week) ?? new Set<LocalDate>();
      for (const day of days) merged.add(day);
      trainedDaysByWeek.set(week, merged);
    }
  }

  let expectedSessions = 0;
  let validSessionCount = 0;
  for (const [week, target] of weeklyTargets) {
    expectedSessions += target;
    validSessionCount += Math.min(target, trainedDaysByWeek.get(week)?.size ?? 0);
  }

  const trainedLocalDates = new Set<LocalDate>();
  for (const days of trainedDaysByWeek.values()) {
    for (const day of days) trainedLocalDates.add(day);
  }

  return {
    cycleStartLocalDate,
    activeTime: trace.activeTime,
    countedDates: trace.countedDates,
    weeklyTargets,
    expectedSessions,
    validSessionCount,
    adherence: computeAdherence(validSessionCount, expectedSessions, config),
    adherenceAtEarnBp: adherenceBasisPoints(validSessionCount, expectedSessions),
    trainedLocalDates,
    inactivityDayThreshold: inactivityDayThresholdAt(input.todayLocalDate),
  };
}
