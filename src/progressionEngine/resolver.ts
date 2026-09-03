import {
  BEGINNER_STAGE_MIN_DAYS,
  NORMAL_ADHERENCE_THRESHOLD,
  NORMAL_PROGRAM_CYCLE_DAYS,
  type EvaluateWorkoutProgressionInput,
  type NotEligibleReasonCode,
  type ProgressionResolution,
} from './types';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMidnight(value: string): number {
  if (!LOCAL_DATE_PATTERN.test(value)) throw new Error(`INVALID_LOCAL_DATE:${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days elapsed between two local dates (never negative — a program can't be activated in the future). */
function daysBetweenLocalDates(from: string, to: string): number {
  return Math.max(0, Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY));
}

/**
 * Pure, deterministic core of the Progression Engine. No I/O — the caller
 * resolves the active program, its execution counts, and "today" before
 * calling this (docs §47/§49). Reading this function never mutates
 * anything; applying a transition is a separate, explicit step (docs §50).
 */
export function evaluateWorkoutProgression(input: EvaluateWorkoutProgressionInput): ProgressionResolution {
  if (!input.hasValidActiveProgram) return { status: 'INVALID_PROGRAM_STATE' };
  if (input.hasActiveExecution) return { status: 'BLOCKED_ACTIVE_EXECUTION' };

  const elapsedDays = daysBetweenLocalDates(input.activatedAtLocalDate, input.todayLocalDate);

  if (input.adaptationStage === 1 || input.adaptationStage === 2) {
    const reasonCodes: NotEligibleReasonCode[] = [];
    if (elapsedDays < BEGINNER_STAGE_MIN_DAYS) reasonCodes.push('MINIMUM_TIME_NOT_REACHED');
    if (input.completedOrPartialSessionCount < input.trainingDaysPerWeek) reasonCodes.push('MINIMUM_SESSIONS_NOT_REACHED');
    if (reasonCodes.length > 0) return { status: 'NOT_ELIGIBLE', reasonCodes };
    return input.adaptationStage === 1
      ? { status: 'BEGINNER_STAGE_PROGRESSION_AVAILABLE', fromStage: 1, toStage: 2 }
      : { status: 'BEGINNER_STAGE_PROGRESSION_AVAILABLE', fromStage: 2, toStage: 3 };
  }

  // adaptationStage === 3, or undefined (never a Beginner) — both are "full
  // training", governed only by the normal renewal cycle (docs §16/§66:
  // Stage 3 never re-enters weekly stage gating).
  const expectedSessions = (input.trainingDaysPerWeek * elapsedDays) / 7;
  const minimumSessions = Math.ceil(expectedSessions * NORMAL_ADHERENCE_THRESHOLD);
  const reasonCodes: NotEligibleReasonCode[] = [];
  if (elapsedDays < NORMAL_PROGRAM_CYCLE_DAYS) reasonCodes.push('PROGRAM_AGE_NOT_REACHED');
  if (input.completedOrPartialSessionCount < minimumSessions) reasonCodes.push('ADHERENCE_TOO_LOW');
  if (reasonCodes.length > 0) return { status: 'NOT_ELIGIBLE', reasonCodes };
  return { status: 'NORMAL_ROTATION_AVAILABLE' };
}
