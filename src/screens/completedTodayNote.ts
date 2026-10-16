import { weekdayOfLocalDate } from '../scheduleEngine/calendar';
import type { Weekday } from '../state/AppState';

/**
 * The "{when}" of the "você já treinou hoje" note (Treino/Home), when today's
 * session is already done.
 *
 * Pure presentation of the Schedule Engine's OWN answer: it formats the
 * `nextWorkoutDate` the resolution already carries and never walks the
 * calendar to find one. No date (flexible mode / a status without one) means
 * there is nothing honest to name, so the caller shows the short note instead.
 */
export function completedTodayNextLabel(input: {
  nextWorkoutDate: string | null;
  todayLocalDate: string;
  /** Localized "Hoje" (`treino:agenda.today`). */
  todayLabel: string;
  /** Localized short weekday (`treino:agenda.weekday.*`). */
  weekdayLabel: (weekday: Weekday) => string;
  locale: string;
}): string | null {
  const { nextWorkoutDate, todayLocalDate, todayLabel, weekdayLabel, locale } = input;
  if (!nextWorkoutDate) return null;
  if (nextWorkoutDate === todayLocalDate) return todayLabel.toLocaleLowerCase(locale);
  const weekday = weekdayLabel(weekdayOfLocalDate(nextWorkoutDate));
  return `${weekday} ${nextWorkoutDate.slice(8, 10)}`.toLocaleLowerCase(locale);
}
