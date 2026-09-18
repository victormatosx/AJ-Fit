import type { ScheduleMode, Weekday } from '../state/AppState';
import { compareLocalDates, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import { mondayOfWeek, weekDates } from './calendarWeek';

/**
 * "Esta semana" (Home) — a pure projection of the Schedule Engine's own
 * `trainingDays`/`activeRecoveryDays` plus real completed dates. Never a
 * second source of truth for which days are training days: `REST` here
 * means "not a trainingDay per ScheduleConfig", not a guess.
 */
export type WeekDayStatus =
  | 'COMPLETED'
  | 'TODAY_COMPLETED'
  | 'TODAY_PENDING'
  | 'MISSED'
  | 'UPCOMING'
  | 'FULFILLED_EARLY'
  | 'ACTIVE_RECOVERY'
  | 'REST'
  | 'BEFORE_PROGRAM';

export interface WeekDayViewModel {
  localDate: LocalDate;
  weekday: Weekday;
  status: WeekDayStatus;
  isToday: boolean;
}

export interface WeekOverviewViewModel {
  days: WeekDayViewModel[];
  /** TrainingDays in this week that are already active (on/after `activatedAtLocalDate`). */
  scheduledCount: number;
  completedCount: number;
}

const COMPLETED_STATUSES: ReadonlySet<WeekDayStatus> = new Set(['COMPLETED', 'TODAY_COMPLETED']);

export function buildWeekOverview(input: {
  todayLocalDate: LocalDate;
  scheduleMode?: ScheduleMode;
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
  /** Null when unknown — no day is ever marked BEFORE_PROGRAM in that case. */
  activatedAtLocalDate: LocalDate | null;
  completedDates: ReadonlySet<LocalDate>;
  /** Scheduled opportunities already fulfilled, possibly on another real activity date. */
  fulfilledScheduledDates?: ReadonlySet<LocalDate>;
}): WeekOverviewViewModel {
  const trainingSet = new Set(input.trainingDays);
  const recoverySet = new Set(input.activeRecoveryDays);
  const monday = mondayOfWeek(input.todayLocalDate);

  const days = weekDates(monday).map((localDate): WeekDayViewModel => {
    const weekday = weekdayOfLocalDate(localDate);
    const isToday = localDate === input.todayLocalDate;
    const isBeforeProgram = input.activatedAtLocalDate != null
      && compareLocalDates(localDate, input.activatedAtLocalDate) < 0;

    let status: WeekDayStatus;
    if (isBeforeProgram) {
      status = 'BEFORE_PROGRAM';
    } else if (input.completedDates.has(localDate)) {
      // Actual activity wins over the calendar label. An advanced Friday
      // opportunity is fulfilled for adherence on Friday but was performed
      // on Thursday, so Thursday must not be visually hidden as REST.
      status = isToday ? 'TODAY_COMPLETED' : 'COMPLETED';
    } else if ((input.scheduleMode ?? 'fixed') === 'fixed'
      && input.fulfilledScheduledDates?.has(localDate)) {
      // Keep the actual check on the performed day without presenting the
      // original training day as pending/missed or double-counting activity.
      status = 'FULFILLED_EARLY';
    } else if (input.scheduleMode === 'flexible') {
      // Flexible has no calendar debt: the week is an actual-activity view,
      // so an untrained weekday is neutral REST and can never become MISSED.
      status = 'REST';
    } else if (recoverySet.has(weekday)) {
      status = 'ACTIVE_RECOVERY';
    } else if (!trainingSet.has(weekday)) {
      status = 'REST';
    } else if (isToday) {
      status = 'TODAY_PENDING';
    } else if (compareLocalDates(localDate, input.todayLocalDate) < 0) {
      status = 'MISSED';
    } else {
      status = 'UPCOMING';
    }

    return { localDate, weekday, status, isToday };
  });

  if (input.scheduleMode === 'flexible') {
    return {
      days,
      scheduledCount: input.prescribedTrainingFrequency ?? 0,
      completedCount: days.filter((day) => COMPLETED_STATUSES.has(day.status)).length,
    };
  }
  return {
    days,
    scheduledCount: days.filter((day) => trainingSet.has(day.weekday) && day.status !== 'BEFORE_PROGRAM').length,
    completedCount: days.filter((day) => COMPLETED_STATUSES.has(day.status)).length,
  };
}
