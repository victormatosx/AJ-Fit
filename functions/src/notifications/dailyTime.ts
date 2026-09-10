import { addDaysLocal, type LocalDate } from '../workoutLifecycle/scheduleEngine/calendar';
import {
  canonicalIanaTimezone,
  localDateTimeInTimezone,
} from '../workoutLifecycle/scheduleEngine/localDate';

export const DAILY_WINDOW_START_MINUTE = 8 * 60;
export const DAILY_WINDOW_END_MINUTE = 10 * 60;

export interface DailyLocalClock {
  timezone: string;
  localDate: LocalDate;
  minuteOfDay: number;
  withinWindow: boolean;
}

export function dailyLocalClock(instant: Date, timezoneInput: unknown): DailyLocalClock | null {
  const timezone = canonicalIanaTimezone(timezoneInput);
  if (!timezone) return null;
  const parts = localDateTimeInTimezone(instant, timezone);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return {
    timezone,
    localDate: parts.localDate,
    minuteOfDay,
    withinWindow:
      minuteOfDay >= DAILY_WINDOW_START_MINUTE && minuteOfDay < DAILY_WINDOW_END_MINUTE,
  };
}

function requestedWallClockMs(localDate: LocalDate, minuteOfDay: number): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}

/**
 * Resolves a local wall-clock time to an instant using Intl's timezone
 * database. The iteration handles DST offsets without manual offset tables.
 * The product window is 08:00, so it never targets an ambiguous/nonexistent
 * transition hour; verification still fails closed if a runtime cannot map it.
 */
export function instantForLocalTime(
  localDate: LocalDate,
  minuteOfDay: number,
  timezoneInput: unknown,
): Date | null {
  const timezone = canonicalIanaTimezone(timezoneInput);
  if (!timezone || !Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 24 * 60) {
    return null;
  }
  const requested = requestedWallClockMs(localDate, minuteOfDay);
  let candidate = requested;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localDateTimeInTimezone(new Date(candidate), timezone);
    const observed = requestedWallClockMs(parts.localDate, parts.hour * 60 + parts.minute);
    const correction = requested - observed;
    candidate += correction;
    if (correction === 0) break;
  }
  const verified = localDateTimeInTimezone(new Date(candidate), timezone);
  return verified.localDate === localDate
    && verified.hour * 60 + verified.minute === minuteOfDay
    ? new Date(candidate)
    : null;
}

/** Initial/due projection: enter now if already inside today's window. */
export function nextDailyEvaluationInstant(now: Date, timezoneInput: unknown): Date | null {
  const clock = dailyLocalClock(now, timezoneInput);
  if (!clock) return null;
  if (clock.withinWindow) return now;
  const targetDate = clock.minuteOfDay < DAILY_WINDOW_START_MINUTE
    ? clock.localDate
    : addDaysLocal(clock.localDate, 1);
  return instantForLocalTime(targetDate, DAILY_WINDOW_START_MINUTE, clock.timezone);
}

/** Successful evaluation always advances to the next local calendar day. */
export function nextDailyWindowAfter(localDate: LocalDate, timezoneInput: unknown): Date | null {
  return instantForLocalTime(
    addDaysLocal(localDate, 1),
    DAILY_WINDOW_START_MINUTE,
    timezoneInput,
  );
}
