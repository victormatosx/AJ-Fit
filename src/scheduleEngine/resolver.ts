import { addDaysLocal, nextTrainingDayOnOrAfter, normalizeWeekdayOrder, trainingDayOccurrences, weekdayOfLocalDate } from './calendar';
import type { LocalDate } from './calendar';
import type { ResolveWorkoutScheduleInput, ScheduleResolution } from './types';
import type { Weekday } from '../state/AppState';

/**
 * First-activation anchor (docs §Ancoragem inicial): seeds the rotation at
 * `weekday`'s position within the user's ordered trainingDays, so a plan
 * that starts mid-week (e.g. activated on a Friday with MON..FRI/A..E) opens
 * on E, not A. Only ever used once per program, when there is no persisted
 * `nextSessionIndex` yet — every later read/completion/miss is entirely
 * owned by the rotation-by-completion cursor (`ScheduleState`), never
 * recomputed from the calendar again.
 *
 * Exported so callers outside the resolver (`completeScheduledSession`,
 * `src/services/workoutSchedule.ts`) never need a second, independently
 * maintained formula for "what session does this weekday anchor to" — see
 * `initialSessionIndexFor` below for the full first-completion derivation.
 */
export function anchorSessionIndex(trainingDays: readonly Weekday[], weekday: Weekday, sessionCount: number): number {
  const position = normalizeWeekdayOrder(trainingDays).indexOf(weekday);
  return position < 0 ? 0 : position % sessionCount;
}

/**
 * The exact session index `resolveWorkoutSchedule` would anchor to for
 * `todayLocalDate` when no `ScheduleState` exists yet (a first-ever
 * completion) — same cursor/occurrences walk as the no-state branches above
 * (lines "No state yet" / occurrences[0]), extracted so it can be reused
 * verbatim by `completeScheduledSession` instead of a second, drifted
 * fallback. Regression: an account whose ProgramInstance activates on a
 * trainingDay that isn't the first in the ordered list (e.g. activates on a
 * Thursday with trainingDays=[MON,TUE,WED,THU]) anchors to a non-zero
 * session (3, not 0) — `completeScheduledSession`'s old `?? 0` fallback
 * rejected that legitimate first completion as SESSION_INDEX_OUT_OF_SEQUENCE.
 */
export function initialSessionIndexFor(input: {
  trainingDays: readonly Weekday[];
  activatedAtLocalDate: LocalDate;
  todayLocalDate: LocalDate;
  sessionCount: number;
}): number {
  const cursorDate = addDaysLocal(input.activatedAtLocalDate, -1);
  const occurrences = trainingDayOccurrences(input.trainingDays, cursorDate, input.todayLocalDate);
  const anchorDate = occurrences[0] ?? input.todayLocalDate;
  return anchorSessionIndex(input.trainingDays, weekdayOfLocalDate(anchorDate), input.sessionCount);
}

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
  const { hasActiveProgram, sessionCount, config, state, activatedAtLocalDate, todayLocalDate, resolvedMissScheduledDate } = input;

  if (!hasActiveProgram || sessionCount <= 0) return { status: 'PROGRAM_NOT_AVAILABLE' };
  if (!config || config.trainingDays.length === 0) return { status: 'SCHEDULE_SETUP_REQUIRED' };

  if (state?.pendingMissDecision) {
    return {
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: state.pendingMissDecision.missedSessionIndex,
      calendarSessionIndex: state.pendingMissDecision.calendarSessionIndex,
      missedScheduledDate: state.pendingMissDecision.missedScheduledDate,
    };
  }

  // No state yet (program just activated): the day *before* activation is
  // the walk's starting point, so an activation that lands on a trainingDay
  // still counts as this program's first occurrence (docs §Data de ativação)
  // instead of being skipped as "before the cursor".
  const cursorDate = state?.cursorDate ?? addDaysLocal(activatedAtLocalDate, -1);

  const occurrences = trainingDayOccurrences(config.trainingDays, cursorDate, todayLocalDate);

  if (occurrences.length === 0) {
    // Distinguishes "nothing scheduled today" from "already trained today"
    // (docs §Conclusão diária): `lastCompletedAt` only ever advances on an
    // actual COMPLETED event, so it equaling today is exactly "the session
    // due today was just finished" — never a guess from `cursorDate` alone
    // (a FOLLOW_SCHEDULE miss resolution also lands cursorDate on today
    // without a completion).
    const nextWorkoutDate = nextTrainingDayOnOrAfter(config.trainingDays, addDaysLocal(todayLocalDate, 1));
    const nextSessionIndex = state?.nextSessionIndex
      ?? anchorSessionIndex(config.trainingDays, weekdayOfLocalDate(nextWorkoutDate), sessionCount);
    return state?.lastCompletedAt === todayLocalDate
      ? { status: 'TODAY_COMPLETED', nextWorkoutDate, nextSessionIndex }
      : config.activeRecoveryDays?.includes(weekdayOfLocalDate(todayLocalDate))
        ? { status: 'ACTIVE_RECOVERY_DAY', nextWorkoutDate, nextSessionIndex }
        : { status: 'REST_DAY', nextWorkoutDate, nextSessionIndex };
  }

  const nextSessionIndex = state?.nextSessionIndex
    ?? anchorSessionIndex(config.trainingDays, weekdayOfLocalDate(occurrences[0]), sessionCount);

  if (occurrences.length === 1) {
    // The lone occurrence may be a still-unconsumed trainingDay that isn't
    // today (e.g. today is a rest day, but an earlier trainingDay in a
    // non-consecutive schedule was skipped). That's not yet a conflict worth
    // asking about — it stays REST_DAY until the next actual trainingDay
    // reveals whether there's really a gap (docs §Detecção de miss).
    if (!config.trainingDays.includes(weekdayOfLocalDate(todayLocalDate))) {
      const nextWorkoutDate = nextTrainingDayOnOrAfter(config.trainingDays, addDaysLocal(todayLocalDate, 1));
      return config.activeRecoveryDays?.includes(weekdayOfLocalDate(todayLocalDate))
        ? { status: 'ACTIVE_RECOVERY_DAY', nextWorkoutDate, nextSessionIndex }
        : { status: 'REST_DAY', nextWorkoutDate, nextSessionIndex };
    }
    return { status: 'SESSION_READY', sessionIndex: nextSessionIndex };
  }

  // More than one trainingDay elapsed since the cursor without a completion.
  // If THIS exact gap (same first occurrence) already has a MISS_RESOLVED
  // ledger event, a decision was already made for it — never re-ask just
  // because more days went by without the pending session being completed
  // (docs §Decisão idempotente). It stays SESSION_READY on the missed
  // session, identical to any other day it just hasn't been done yet.
  if (occurrences[0] === resolvedMissScheduledDate) {
    return { status: 'SESSION_READY', sessionIndex: nextSessionIndex };
  }

  // Otherwise, collapse the whole (still-undecided) gap into a single
  // decision (docs §Múltiplos dias perdidos) instead of one popup per
  // missed day.
  const missedCount = occurrences.length - 1;
  return {
    status: 'MISSED_SESSION_DECISION_REQUIRED',
    missedSessionIndex: nextSessionIndex,
    calendarSessionIndex: (nextSessionIndex + missedCount) % sessionCount,
    missedScheduledDate: occurrences[0],
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

  const cursorDate = input.state?.cursorDate ?? addDaysLocal(input.activatedAtLocalDate, -1);
  const occurrences = trainingDayOccurrences(input.config.trainingDays, cursorDate, input.todayLocalDate);
  if (occurrences.length <= 1) return null;
  // Same identity rule as `resolveWorkoutSchedule`: a gap whose first
  // occurrence already has a MISS_RESOLVED event isn't a NEW, undecided gap
  // — nothing new to persist (docs §Decisão idempotente).
  if (occurrences[0] === input.resolvedMissScheduledDate) return null;

  const nextSessionIndex = input.state?.nextSessionIndex
    ?? anchorSessionIndex(input.config.trainingDays, weekdayOfLocalDate(occurrences[0]), input.sessionCount);

  return {
    missedSessionIndex: nextSessionIndex,
    calendarSessionIndex: (nextSessionIndex + occurrences.length - 1) % input.sessionCount,
    missedScheduledDate: occurrences[0],
  };
}
