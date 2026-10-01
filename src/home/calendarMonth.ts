import { weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import type { Weekday } from '../state/AppState';

export interface CalendarMonthBounds {
  year: number;
  /** 1-12. */
  month: number;
  daysInMonth: number;
  startLocalDate: LocalDate;
  endLocalDate: LocalDate;
  startWeekday: Weekday;
}

/**
 * Calendar-month bounds (1st through the last day) containing `localDate` —
 * never re-derives a timezone or "today"; `localDate` is assumed already
 * resolved by the caller, same contract as `calendarWeek.ts`'s
 * `mondayOfWeek`. `startWeekday` is included so a consumer (e.g. the widget
 * snapshot) never has to compute a weekday from a date itself.
 */
export function monthBounds(localDate: LocalDate): CalendarMonthBounds {
  const [yearPart, monthPart] = localDate.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  // Day 0 of the following month (0-based) is the last day of `month`.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startLocalDate = `${yearPart}-${monthPart}-01`;
  const endLocalDate = `${yearPart}-${monthPart}-${String(daysInMonth).padStart(2, '0')}`;

  return {
    year,
    month,
    daysInMonth,
    startLocalDate,
    endLocalDate,
    startWeekday: weekdayOfLocalDate(startLocalDate),
  };
}
