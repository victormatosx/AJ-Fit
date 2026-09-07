import { WEEKDAY_ORDER } from '../state/AppState';
// Concrete submodules only, never the `../scheduleEngine` barrel — it also
// re-exports the `useWorkoutSchedule` React hook (RN/AuthContext), which a
// pure calendar-math module must never drag in transitively.
import { addDaysLocal, weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';

/** Monday (Monday-first `WEEKDAY_ORDER`) of the calendar week containing `date`. */
export function mondayOfWeek(date: LocalDate): LocalDate {
  const offset = WEEKDAY_ORDER.indexOf(weekdayOfLocalDate(date));
  return addDaysLocal(date, -offset);
}

/** The 7 local dates of the week starting at `mondayDate`, Monday through Sunday. */
export function weekDates(mondayDate: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, index) => addDaysLocal(mondayDate, index));
}
