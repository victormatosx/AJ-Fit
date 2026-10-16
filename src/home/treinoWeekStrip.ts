import type { ScheduleMode, Weekday } from '../state/AppState';
import type { LocalDate } from '../scheduleEngine/calendar';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import type { WeekOverviewViewModel } from './weekOverview';
import { buildUpcomingWorkouts } from './upcomingWorkouts';

export type TreinoWeekStripGlyph = 'COMPLETED' | 'MISSED' | 'FULFILLED_EARLY';

export interface TreinoWeekStripDayViewModel {
  localDate: LocalDate;
  weekday: Weekday;
  isToday: boolean;
  /** Two-digit day-of-month, e.g. "05". */
  dayNumber: string;
  /** Whether this day carries a training obligation at all (vs REST/ACTIVE_RECOVERY/BEFORE_PROGRAM). */
  isTrainingDay: boolean;
  glyph: TreinoWeekStripGlyph | null;
  /** plan.sessions index for this day's session — null when there is no honest projection (rest day, or glyph already tells the story). */
  sessionIndex: number | null;
  /** True for the single day that is the very next session to perform. */
  isNextSession: boolean;
}

const TRAINING_STATUSES = new Set([
  'COMPLETED', 'TODAY_COMPLETED', 'FULFILLED_EARLY', 'MISSED', 'TODAY_PENDING', 'UPCOMING',
]);

/**
 * "Faixa da semana" (Treino · Opção B). Labels which of THIS WEEK's
 * training days carries which `plan.sessions` letter by reusing the exact
 * same forward projection "Próximos treinos" already calls
 * (`buildUpcomingWorkouts`), with a week-sized limit — never a second
 * scheduler. Past days keep the Schedule Engine's own week-overview glyph
 * (COMPLETED/MISSED/FULFILLED_EARLY) instead of a session letter, because
 * the engine does not expose which session a missed/early day belonged to.
 */
export function buildTreinoWeekStrip(input: {
  overview: WeekOverviewViewModel;
  todayLocalDate: LocalDate;
  scheduleMode?: ScheduleMode;
  trainingDays: readonly Weekday[];
  sessions: readonly FinalWorkoutSession[];
  resolution: ScheduleResolution | null | undefined;
  /** `effectiveNextSessionIndex(resolution)` — the rotation's current cursor. */
  nextSessionIndex: number | null;
}): TreinoWeekStripDayViewModel[] {
  const { overview, todayLocalDate, scheduleMode, trainingDays, sessions, resolution, nextSessionIndex } = input;

  const projected = buildUpcomingWorkouts({
    todayLocalDate,
    scheduleMode,
    trainingDays,
    sessions,
    resolution,
    limit: 7,
  });
  const sessionIndexByDate = new Map(projected.map((workout) => [workout.localDate, workout.sessionIndex]));
  const firstUpcomingDate = projected[0]?.localDate ?? null;

  const todayHasPendingSession = resolution?.status === 'SESSION_READY'
    || resolution?.status === 'MISSED_SESSION_DECISION_REQUIRED';

  return overview.days.map((day): TreinoWeekStripDayViewModel => {
    const glyph: TreinoWeekStripGlyph | null =
      day.status === 'COMPLETED' || day.status === 'TODAY_COMPLETED' ? 'COMPLETED' :
      day.status === 'MISSED' ? 'MISSED' :
      day.status === 'FULFILLED_EARLY' ? 'FULFILLED_EARLY' :
      null;

    const sessionIndex = glyph
      ? null
      : day.isToday && todayHasPendingSession
        ? nextSessionIndex
        : sessionIndexByDate.get(day.localDate) ?? null;

    const isNextSession = !glyph && (
      (day.isToday && todayHasPendingSession)
      || (!todayHasPendingSession && day.localDate === firstUpcomingDate)
    );

    return {
      localDate: day.localDate,
      weekday: day.weekday,
      isToday: day.isToday,
      dayNumber: day.localDate.slice(8, 10),
      isTrainingDay: TRAINING_STATUSES.has(day.status),
      glyph,
      sessionIndex,
      isNextSession,
    };
  });
}
