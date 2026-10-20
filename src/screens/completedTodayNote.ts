import { addDaysLocal, compareLocalDates } from '../scheduleEngine/calendar';

/** How far ahead a bare weekday name still identifies a day unambiguously. */
const WEEKDAY_IS_ENOUGH_DAYS = 6;

/**
 * The "{when}" of the "você já treinou hoje" note (Treino/Home), when today's
 * session is already done.
 *
 * Pure presentation of the Schedule Engine's OWN answer: it formats the
 * `nextWorkoutDate` the resolution already carries and never walks the
 * calendar to find one. No date (flexible mode / a status without one) means
 * there is nothing honest to name, so the caller shows the short note instead.
 *
 * ## Why it reads as a date and not as a code
 *
 * This lands inside a sentence — "O próximo treino é ___." — so the label has
 * to finish that sentence the way a person would. The previous form glued an
 * abbreviated weekday to a zero-padded day number ("qua 21"), which reads as
 * a table cell, not as speech, and made the whole sentence stilted.
 *
 * The ladder below is ordinary date-speak:
 *
 *  - today / tomorrow get their own words, because nobody names the weekday
 *    of a day that close;
 *  - within the coming week the weekday alone already identifies the day
 *    ("quarta-feira") — adding the number is noise;
 *  - beyond that the weekday repeats, so the day and month come with it
 *    ("quarta-feira, 28 de outubro").
 *
 * Weekday and month names come from `Intl`, so every locale gets its own
 * spelling and ordering without this module carrying a table of its own. The
 * noon anchor keeps the parsed instant away from both DST edges of the day.
 */
export function completedTodayNextLabel(input: {
  nextWorkoutDate: string | null;
  todayLocalDate: string;
  /** Localized "Hoje" (`treino:agenda.today`). */
  todayLabel: string;
  /** Localized "Amanhã" (`treino:agenda.tomorrow`). */
  tomorrowLabel: string;
  locale: string;
}): string | null {
  const { nextWorkoutDate, todayLocalDate, todayLabel, tomorrowLabel, locale } = input;
  if (!nextWorkoutDate) return null;
  if (nextWorkoutDate === todayLocalDate) return todayLabel.toLocaleLowerCase(locale);
  if (nextWorkoutDate === addDaysLocal(todayLocalDate, 1)) return tomorrowLabel.toLocaleLowerCase(locale);

  const date = new Date(`${nextWorkoutDate}T12:00:00`);
  // A date in the PAST would mean the engine handed us a stale pointer; name
  // it in full rather than calling it "quarta-feira", which would read as the
  // one still ahead.
  const withinTheWeek = compareLocalDates(nextWorkoutDate, todayLocalDate) > 0
    && compareLocalDates(nextWorkoutDate, addDaysLocal(todayLocalDate, WEEKDAY_IS_ENOUGH_DAYS)) <= 0;
  const formatted = new Intl.DateTimeFormat(locale, withinTheWeek
    ? { weekday: 'long' }
    : { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return formatted.toLocaleLowerCase(locale);
}
