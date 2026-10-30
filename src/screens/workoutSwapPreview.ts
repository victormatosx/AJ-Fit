/**
 * Pure `WorkoutProgramSnapshot` → "Treino trocado" view-model derivation,
 * split out exactly like `myPlanPresentation.ts` so it is independently
 * testable in this project's Node-only Vitest suite (which cannot import a
 * react-native component module at all) and so the screen can never grow its
 * own copy of scheduling or prescription logic.
 *
 * Everything here is a reshaping of values the Prescription Engine already
 * sealed into the two snapshots. Nothing is estimated, and no value is
 * derived from a domain rule that lives elsewhere.
 */
import { WEEKDAY_ORDER, type Weekday } from '../state/AppState';
import type {
  FinalWorkoutPlan,
  WorkoutDayState,
  WorkoutWeekdayPrescription,
} from '../workoutPrescription/types';

/** The frequency the plan actually prescribes, through the same fallback chain every other reader uses. */
export function planFrequency(plan: FinalWorkoutPlan): number {
  return plan.prescribedTrainingFrequency ?? plan.prescribedStructuredDays ?? plan.sessions.length;
}

export function planExerciseCount(plan: FinalWorkoutPlan): number {
  return plan.sessions.reduce((total, session) => total + session.exercises.length, 0);
}

export interface SwapMetricChange {
  from: number;
  to: number;
  changed: boolean;
}

export interface WorkoutSwapComparison {
  frequency: SwapMetricChange;
  sessionCount: SwapMetricChange;
  exerciseCount: SwapMetricChange;
  /** Both plans' `split` labels, and whether the division itself was renamed. */
  split: { from: string; to: string; changed: boolean };
}

function metric(from: number, to: number): SwapMetricChange {
  return { from, to, changed: from !== to };
}

/**
 * The honest "antes → depois" of a program swap.
 *
 * Deliberately stops at this granularity. An availability change rebuilds the
 * whole division (e.g. 4 sessions become 5), so slot `n` of the old session
 * `i` has no counterpart in the new plan — a per-exercise "antes: X" would be
 * invented correspondence, not a diff. The one engine that does produce real
 * exercise-level replacements (`evolution.diff`, consumed by
 * `NewPlanRevealScreen`) only works because an evolution preserves the plan's
 * shape; adaptation does not.
 */
export function workoutSwapComparison(
  previous: FinalWorkoutPlan,
  next: FinalWorkoutPlan,
): WorkoutSwapComparison {
  return {
    frequency: metric(planFrequency(previous), planFrequency(next)),
    sessionCount: metric(previous.sessions.length, next.sessions.length),
    exerciseCount: metric(planExerciseCount(previous), planExerciseCount(next)),
    split: { from: previous.split, to: next.split, changed: previous.split !== next.split },
  };
}

export interface SwapPreviewDay {
  weekday: Weekday;
  state: WorkoutDayState;
  /** Only set when the plan itself sealed a session onto this weekday. */
  sessionIndex: number | null;
}

/**
 * The new plan's own Monday-first week.
 *
 * Reads `weeklySchedule` and nothing else: it is the calendar authority the
 * engine sealed for this program (`buildWeekView` gives it the same
 * precedence over a live `ScheduleConfig`), so the preview shows the week the
 * user just bought into rather than whatever the schedule reader has
 * reconciled so far. A `flexible` plan has no weekdays to show and returns an
 * empty list — the screen presents its frequency instead of guessing days.
 */
export function swapPreviewWeek(plan: FinalWorkoutPlan): SwapPreviewDay[] {
  if ((plan.scheduleMode ?? 'fixed') === 'flexible') return [];
  const weeklySchedule: readonly WorkoutWeekdayPrescription[] = Array.isArray(plan.weeklySchedule)
    ? plan.weeklySchedule
    : [];
  if (weeklySchedule.length === 0) return [];
  const byWeekday = new Map(weeklySchedule.map((day) => [day.weekday, day]));
  return WEEKDAY_ORDER.map((weekday) => {
    const prescribed = byWeekday.get(weekday);
    return {
      weekday,
      state: prescribed?.state ?? 'REST',
      sessionIndex: prescribed?.sessionIndex ?? null,
    };
  });
}

/**
 * The muscle groups a session actually trains, in the order they first appear
 * in it. Derived from the exercises' own resolved catalog target
 * (`workoutExercisesFromPlan`'s `target`, i.e. `exercise.target.primaryMuscle`)
 * — never from the session's name or `type`, which are authorial labels and
 * not a muscle list. Cardio/mobility activities legitimately have no target
 * (`''`) and simply contribute nothing.
 */
export function sessionMuscleGroups(exercises: readonly { target: string }[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const exercise of exercises) {
    const target = exercise.target.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    ordered.push(target);
  }
  return ordered;
}

/** AJ at full size while he presents. */
export const AJ_EXPANDED_SIZE = 104;

/**
 * The expanded layout, measured rather than guessed as a fraction of the
 * screen: AJ's top offset, his own size, the gap to his lines, the room those
 * lines need, and a last margin. The sheet gives up exactly this much and not
 * one point more, so the plan comes to rest right under what AJ is saying
 * instead of a screen's worth of empty space below it.
 */
export const AJ_EXPANDED_TOP = 10;
export const AJ_SPEECH_GAP = 14;
/** Three 22pt rows — the longest line any locale produces, plus slack. */
export const AJ_SPEECH_BOX = 72;
export const AJ_SPEECH_BOTTOM_MARGIN = 14;
/** Breathing room above the heading once the sheet is no longer the screen. */
export const AJ_SHEET_COLLAPSED_PADDING = 18;

/** Keeps the plan readable on a short screen and the lines readable on a tall one. */
export const EXPANDED_SHEET_BOUNDS = { min: 0.42, max: 0.78 } as const;

export function expandedSheetHeight(windowHeight: number, safeTop: number): number {
  const topArea = safeTop + AJ_EXPANDED_TOP + AJ_EXPANDED_SIZE
    + AJ_SPEECH_GAP + AJ_SPEECH_BOX + AJ_SPEECH_BOTTOM_MARGIN;
  return Math.min(
    windowHeight * EXPANDED_SHEET_BOUNDS.max,
    Math.max(windowHeight * EXPANDED_SHEET_BOUNDS.min, windowHeight - topArea),
  );
}
