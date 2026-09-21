import { WEEKDAY_ORDER, type Weekday } from '../state/AppState';
import { normalizeWeekdays } from '../lib/questionnaireSchema';
import { isRecoverySessionType } from './sessionTypes';
import type {
  FinalWorkoutSession,
  WorkoutAvailability,
  WorkoutDayState,
  WorkoutWeekdayPrescription,
} from './types';

export function sessionDayState(session: Pick<FinalWorkoutSession, 'type'>): Exclude<WorkoutDayState, 'REST'> {
  return isRecoverySessionType(session.type.toLowerCase()) ? 'ACTIVE_RECOVERY' : 'TRAINING';
}

export function trainingSessionIndexes(sessions: readonly Pick<FinalWorkoutSession, 'type'>[]): number[] {
  return sessions.flatMap((session, index) => sessionDayState(session) === 'TRAINING' ? [index] : []);
}

export function activeRecoverySessionIndexes(sessions: readonly Pick<FinalWorkoutSession, 'type'>[]): number[] {
  return sessions.flatMap((session, index) => sessionDayState(session) === 'ACTIVE_RECOVERY' ? [index] : []);
}

function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const result: T[][] = [];
  for (let index = 0; index <= items.length - count; index += 1) {
    for (const tail of combinations(items.slice(index + 1), count - 1)) {
      result.push([items[index], ...tail]);
    }
  }
  return result;
}

function maxCircularRun(days: readonly Weekday[]): number {
  const selected = WEEKDAY_ORDER.map((day) => days.includes(day));
  if (selected.every(Boolean)) return 7;
  let best = 0;
  for (let start = 0; start < 7; start += 1) {
    let run = 0;
    while (run < 7 && selected[(start + run) % 7]) run += 1;
    best = Math.max(best, run);
  }
  return best;
}

function gapSpread(days: readonly Weekday[]): number {
  const indexes = days.map((day) => WEEKDAY_ORDER.indexOf(day)).sort((a, b) => a - b);
  const gaps = indexes.map((value, index) => {
    const next = indexes[(index + 1) % indexes.length];
    return (next - value + 7) % 7 || 7;
  });
  return Math.max(...gaps) - Math.min(...gaps);
}

/** Selects a stable, evenly distributed subset without ever leaving availability. */
export function selectTrainingWeekdays(available: readonly Weekday[], count: number): Weekday[] {
  const normalized = normalizeWeekdays([...available]);
  if (count <= 0 || count > normalized.length) return [];
  return combinations(normalized, count).sort((left, right) =>
    maxCircularRun(left) - maxCircularRun(right)
    || gapSpread(left) - gapSpread(right)
    || left.map((day) => WEEKDAY_ORDER.indexOf(day)).join('').localeCompare(
      right.map((day) => WEEKDAY_ORDER.indexOf(day)).join(''),
    ),
  )[0] ?? [];
}

export function buildWorkoutWeek(
  availability: WorkoutAvailability,
  sessions: readonly FinalWorkoutSession[],
  prescribedTrainingFrequency: number,
): WorkoutWeekdayPrescription[] {
  if (availability.weekdays.length === 0) return [];
  const trainingIndexes = trainingSessionIndexes(sessions);
  const recoveryIndexes = activeRecoverySessionIndexes(sessions);
  const trainingDays = selectTrainingWeekdays(availability.weekdays, prescribedTrainingFrequency);
  const remainingAvailable = availability.weekdays.filter((day) => !trainingDays.includes(day));
  const recoveryDays = remainingAvailable.slice(0, recoveryIndexes.length);
  const trainingByDay = new Map(trainingDays.map((day, index) => [day, trainingIndexes[index]]));
  const recoveryByDay = new Map(recoveryDays.map((day, index) => [day, recoveryIndexes[index]]));

  return WEEKDAY_ORDER.map((weekday) => {
    const trainingIndex = trainingByDay.get(weekday);
    if (trainingIndex != null) return { weekday, state: 'TRAINING', sessionIndex: trainingIndex };
    const recoveryIndex = recoveryByDay.get(weekday);
    if (recoveryIndex != null) return { weekday, state: 'ACTIVE_RECOVERY', sessionIndex: recoveryIndex };
    return { weekday, state: 'REST' };
  });
}

export function legacyTrainingDays(plan: {
  weeklySchedule?: readonly WorkoutWeekdayPrescription[];
}): Weekday[] {
  return plan.weeklySchedule
    ?.filter((day) => day.state === 'TRAINING')
    .map((day) => day.weekday) ?? [];
}
