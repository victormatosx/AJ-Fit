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

export interface DayStatusInput {
  localDate: LocalDate;
  weekday: Weekday;
  todayLocalDate: LocalDate;
  scheduleMode?: ScheduleMode;
  trainingSet: ReadonlySet<Weekday>;
  recoverySet: ReadonlySet<Weekday>;
  /** Null when unknown — no day is ever marked BEFORE_PROGRAM in that case. */
  activatedAtLocalDate: LocalDate | null;
  completedDates: ReadonlySet<LocalDate>;
  /** Scheduled opportunities already fulfilled, possibly on another real activity date. */
  fulfilledScheduledDates?: ReadonlySet<LocalDate>;
}

/**
 * The single per-day classification rule for the Schedule Engine's calendar
 * projection — shared by `buildWeekOverview` (one week at a time) and
 * `computeStreak` (an arbitrary backward walk). Never duplicate this
 * COMPLETED/FULFILLED_EARLY/REST/ACTIVE_RECOVERY/MISSED precedence anywhere
 * else; both callers must see identical status for the same day.
 */
export function classifyDayStatus(input: DayStatusInput): WeekDayStatus {
  const isToday = input.localDate === input.todayLocalDate;
  const isBeforeProgram = input.activatedAtLocalDate != null
    && compareLocalDates(input.localDate, input.activatedAtLocalDate) < 0;

  if (isBeforeProgram) {
    return 'BEFORE_PROGRAM';
  }
  if (input.completedDates.has(input.localDate)) {
    // Actual activity wins over the calendar label. An advanced Friday
    // opportunity is fulfilled for adherence on Friday but was performed
    // on Thursday, so Thursday must not be visually hidden as REST.
    return isToday ? 'TODAY_COMPLETED' : 'COMPLETED';
  }
  if ((input.scheduleMode ?? 'fixed') === 'fixed' && input.fulfilledScheduledDates?.has(input.localDate)) {
    // Keep the actual check on the performed day without presenting the
    // original training day as pending/missed or double-counting activity.
    return 'FULFILLED_EARLY';
  }
  if (input.scheduleMode === 'flexible') {
    // Flexible has no calendar debt: the week is an actual-activity view,
    // so an untrained weekday is neutral REST and can never become MISSED.
    return 'REST';
  }
  if (input.recoverySet.has(input.weekday)) {
    return 'ACTIVE_RECOVERY';
  }
  if (!input.trainingSet.has(input.weekday)) {
    return 'REST';
  }
  if (isToday) {
    return 'TODAY_PENDING';
  }
  if (compareLocalDates(input.localDate, input.todayLocalDate) < 0) {
    return 'MISSED';
  }
  return 'UPCOMING';
}

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
    const status = classifyDayStatus({
      localDate,
      weekday,
      todayLocalDate: input.todayLocalDate,
      scheduleMode: input.scheduleMode,
      trainingSet,
      recoverySet,
      activatedAtLocalDate: input.activatedAtLocalDate,
      completedDates: input.completedDates,
      fulfilledScheduledDates: input.fulfilledScheduledDates,
    });

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
