import { addDaysLocal, trainingDayOccurrences, weekdayOfLocalDate } from './calendar';
import type { ResolveWorkoutScheduleInput, ScheduleResolution } from './types';

/**
 * Pure, deterministic core of the Schedule Engine. No I/O, no `Date.now()` —
 * the caller resolves "today" in the user's local timezone and passes it in.
 *
 * Weekdays organize; completion controls the sequence (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md). Reading this function never mutates anything — the
 * one piece of derived state that must be persisted (a first-detected miss)
 * is the caller's job (see src/services/workoutSchedule.ts), so that the
 * question is asked exactly once and repeat reads are idempotent.
 */
export function resolveWorkoutSchedule(input: ResolveWorkoutScheduleInput): ScheduleResolution {
  const { hasActiveProgram, sessionCount, config, state, activatedAtLocalDate, todayLocalDate } = input;

  if (!hasActiveProgram || sessionCount <= 0) return { status: 'PROGRAM_NOT_AVAILABLE' };
  if (!config || config.trainingDays.length === 0) return { status: 'SCHEDULE_SETUP_REQUIRED' };

  if (state?.pendingMissDecision) {
    return {
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: state.pendingMissDecision.missedSessionIndex,
      calendarSessionIndex: state.pendingMissDecision.calendarSessionIndex,
    };
  }

  const nextSessionIndex = state?.nextSessionIndex ?? 0;
  // No state yet (program just activated): the day *before* activation is
  // the walk's starting point, so an activation that lands on a trainingDay
  // still counts as this program's first occurrence (docs §Data de ativação)
  // instead of being skipped as "before the cursor".
  const cursorDate = state?.cursorDate ?? addDaysLocal(activatedAtLocalDate, -1);

  const occurrences = trainingDayOccurrences(config.trainingDays, cursorDate, todayLocalDate);

  if (occurrences.length === 0) return { status: 'REST_DAY' };

  if (occurrences.length === 1) {
    // The lone occurrence may be a still-unconsumed trainingDay that isn't
    // today (e.g. today is a rest day, but an earlier trainingDay in a
    // non-consecutive schedule was skipped). That's not yet a conflict worth
    // asking about — it stays REST_DAY until the next actual trainingDay
    // reveals whether there's really a gap (docs §Detecção de miss).
    if (!config.trainingDays.includes(weekdayOfLocalDate(todayLocalDate))) return { status: 'REST_DAY' };
    return { status: 'SESSION_READY', sessionIndex: nextSessionIndex };
  }

  // More than one trainingDay elapsed since the cursor without a completion:
  // collapse the whole gap into a single decision (docs §Múltiplos dias
  // perdidos) instead of one popup per missed day.
  const missedCount = occurrences.length - 1;
  return {
    status: 'MISSED_SESSION_DECISION_REQUIRED',
    missedSessionIndex: nextSessionIndex,
    calendarSessionIndex: (nextSessionIndex + missedCount) % sessionCount,
  };
}

/**
 * Read-only helper for the persistence layer: does today's walk reveal a gap
 * that isn't recorded yet? Returns the pending decision to persist, or null
 * when there's nothing new (already recorded, or no gap at all). Kept
 * separate from `resolveWorkoutSchedule` so the "detect" step and the "what
 * do I show the user" step can't drift from each other.
 */
export function detectMissedSessionGap(input: ResolveWorkoutScheduleInput): {
  missedSessionIndex: number;
  calendarSessionIndex: number;
  missedScheduledDate: string;
} | null {
  if (input.state?.pendingMissDecision) return null;
  if (!input.config || input.config.trainingDays.length === 0) return null;
  if (!input.hasActiveProgram || input.sessionCount <= 0) return null;

  const nextSessionIndex = input.state?.nextSessionIndex ?? 0;
  const cursorDate = input.state?.cursorDate ?? addDaysLocal(input.activatedAtLocalDate, -1);
  const occurrences = trainingDayOccurrences(input.config.trainingDays, cursorDate, input.todayLocalDate);
  if (occurrences.length <= 1) return null;

  return {
    missedSessionIndex: nextSessionIndex,
    calendarSessionIndex: (nextSessionIndex + occurrences.length - 1) % input.sessionCount,
    missedScheduledDate: occurrences[0],
  };
}
