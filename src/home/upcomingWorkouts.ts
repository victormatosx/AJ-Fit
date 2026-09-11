import type { Weekday } from '../state/AppState';
import {
  addDaysLocal,
  nextTrainingDayOnOrAfter,
  weekdayOfLocalDate,
  type LocalDate,
} from '../scheduleEngine/calendar';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import { estimateSessionMinutes } from './sessionDuration';

/**
 * "Próximos treinos" (Home) — a pure projection of the Schedule Engine's own
 * answer for TODAY (`ScheduleResolution`) extended forward over the user's
 * real `trainingDays`. It is deliberately NOT a second scheduler:
 *
 *  - the FIRST upcoming entry is either the engine's own `nextWorkoutDate`/
 *    `nextSessionIndex` (rest/recovery/completed days), or the first
 *    trainingDay strictly after today (when today itself still has a session
 *    to do — that one belongs to the Today poster, not to "próximos");
 *  - every later entry just advances the calendar to the next trainingDay and
 *    the rotation by one, which is exactly what the engine does on a
 *    completion ("weekdays organize; completion controls the sequence").
 *
 * Because the rotation only ever advances on a real completion, these are a
 * PROJECTION of the plan as it stands today, not a promise: skipping a
 * session shifts everything after it, which is the engine's documented
 * behavior and not something this module tries to predict.
 */
export interface UpcomingWorkoutViewModel {
  localDate: LocalDate;
  weekday: Weekday;
  /** Index into `plan.sessions` — the same identity the Today poster and Meu Plano use. */
  sessionIndex: number;
  /** Structural name; presentation goes through `resolveSessionDisplayName`. */
  sessionName: string;
  sessionType: string;
  sessionDisplayName?: string;
  exerciseCount: number;
  /** Approximate — see `estimateSessionMinutes`. `0` means "not estimable", and the UI must omit it rather than render "0 min". */
  estimatedMinutes: number;
}

const DEFAULT_LIMIT = 3;

/**
 * Where the forward walk starts, or null when there is nothing honest to
 * project (no program / no schedule configured yet).
 */
function walkStart(
  resolution: ScheduleResolution,
  trainingDays: readonly Weekday[],
  todayLocalDate: LocalDate,
  sessionCount: number,
): { localDate: LocalDate; sessionIndex: number } | null {
  switch (resolution.status) {
    case 'REST_DAY':
    case 'ACTIVE_RECOVERY_DAY':
    case 'TODAY_COMPLETED':
      // The engine already answered "when/what next" for these — never
      // re-derived here (docs §Próximo treino != próximo dia).
      return {
        localDate: resolution.nextWorkoutDate,
        sessionIndex: resolution.nextSessionIndex % sessionCount,
      };
    case 'SESSION_READY':
      return {
        localDate: nextTrainingDayOnOrAfter(trainingDays, addDaysLocal(todayLocalDate, 1)),
        sessionIndex: (resolution.sessionIndex + 1) % sessionCount,
      };
    case 'MISSED_SESSION_DECISION_REQUIRED':
      // No decision has been made yet, so the rotation after today is not a
      // settled fact. CONTINUE_SEQUENCE is what the Today poster already
      // previews (HomeScreen's `scheduledSessionIndex`), so this stays
      // consistent with it instead of introducing a third reading.
      return {
        localDate: nextTrainingDayOnOrAfter(trainingDays, addDaysLocal(todayLocalDate, 1)),
        sessionIndex: (resolution.missedSessionIndex + 1) % sessionCount,
      };
    default:
      // PROGRAM_NOT_AVAILABLE / SCHEDULE_SETUP_REQUIRED — the section is
      // omitted rather than guessed.
      return null;
  }
}

export function buildUpcomingWorkouts(input: {
  todayLocalDate: LocalDate;
  trainingDays: readonly Weekday[];
  /** `plan.sessions`, in plan order. The rotation modulus is this length — the same array every `plan.sessions[index]` lookup on Home reads. */
  sessions: readonly FinalWorkoutSession[];
  resolution: ScheduleResolution | null | undefined;
  limit?: number;
}): UpcomingWorkoutViewModel[] {
  const { todayLocalDate, trainingDays, sessions, resolution } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!resolution || trainingDays.length === 0 || sessions.length === 0 || limit <= 0) return [];

  const start = walkStart(resolution, trainingDays, todayLocalDate, sessions.length);
  if (!start) return [];

  const upcoming: UpcomingWorkoutViewModel[] = [];
  let localDate = start.localDate;
  for (let step = 0; step < limit; step += 1) {
    if (step > 0) localDate = nextTrainingDayOnOrAfter(trainingDays, addDaysLocal(localDate, 1));
    const sessionIndex = (start.sessionIndex + step) % sessions.length;
    const session = sessions[sessionIndex];
    if (!session) continue;
    upcoming.push({
      localDate,
      weekday: weekdayOfLocalDate(localDate),
      sessionIndex,
      sessionName: session.name,
      sessionType: session.type,
      ...(session.displayName ? { sessionDisplayName: session.displayName } : {}),
      exerciseCount: session.exercises.length,
      estimatedMinutes: estimateSessionMinutes(session),
    });
  }
  return upcoming;
}
