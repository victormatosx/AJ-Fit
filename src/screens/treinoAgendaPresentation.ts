import { mondayOfWeek, weekDates } from '../home/calendarWeek';
import { weekdayOfLocalDate, type LocalDate } from '../scheduleEngine/calendar';
import { AVAILABLE_FREQUENCIES, type WeeklyScheduleValue } from '../onboarding/weeklyScheduleSelection';
import type { TreinoWeekStripDayViewModel } from '../home/treinoWeekStrip';
import type { ScheduleResolution } from '../scheduleEngine/types';
import type { ScheduleMode, Weekday } from '../state/AppState';

/**
 * Pure presentation for the "Agenda" sheet (`TreinoAgendaSheet`). Every
 * function here only restates state the app already owns — the Schedule
 * Engine's own week (`buildTreinoWeekStrip`), the onboarding selection
 * helpers' own validity (`isWeeklyScheduleComplete`) and the agenda policy's
 * own frequency comparison (`agendaChangeRequiresAdaptation`). Nothing here
 * decides what gets saved, validates a selection or projects a calendar.
 */

/** The day limits the selection helpers already enforce — never a second rule. */
export const AGENDA_MIN_DAYS = AVAILABLE_FREQUENCIES[0];
export const AGENDA_MAX_DAYS = AVAILABLE_FREQUENCIES[AVAILABLE_FREQUENCIES.length - 1];

/** A/B/C… for a `plan.sessions` index — the same identity every Treino surface shows. */
export function sessionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** "A · B · C · D" — the rotation the flexible mode advances on each completion. */
export function sessionSequenceLabel(sessionCount: number): string {
  return Array.from({ length: sessionCount }, (_, index) => sessionLetter(index)).join(' · ');
}

export interface AgendaSheetDay {
  localDate: LocalDate;
  weekday: Weekday;
  /** Two-digit day-of-month, as rendered inside the circle. */
  dayNumber: string;
  isToday: boolean;
  /**
   * Division letter this day already carries in the Treino week strip, or
   * null when there is no honest preview to show (see `lettersVisible`).
   */
  letter: string | null;
}

/**
 * The 7 circles of the sheet's grid. `stripDays` is the very same
 * `buildTreinoWeekStrip` view model the faixa da semana renders (built from
 * the SAVED schedule), so the numbers under the user's finger never move
 * between tapping the strip and the sheet opening.
 *
 * `lettersVisible` is false whenever the current selection no longer matches
 * the saved schedule: from that moment on, which letter each day would carry
 * is the result of the Schedule Engine's own projection over a schedule that
 * does not exist yet, and the app has no such preview — so the slot stays
 * empty (the row keeps its height) instead of showing a stale letter.
 *
 * The fallback branch exists only for the case where the week overview has
 * not loaded yet: the dates still have to be real, so they come from the
 * same Monday-first calendar helpers Home uses, with no letters at all.
 */
export function agendaSheetWeek(input: {
  stripDays: readonly TreinoWeekStripDayViewModel[];
  todayLocalDate: LocalDate;
  lettersVisible: boolean;
}): AgendaSheetDay[] {
  const { stripDays, todayLocalDate, lettersVisible } = input;

  if (stripDays.length > 0) {
    return stripDays.map((day) => ({
      localDate: day.localDate,
      weekday: day.weekday,
      dayNumber: day.dayNumber,
      isToday: day.isToday,
      letter: lettersVisible && day.sessionIndex != null ? sessionLetter(day.sessionIndex) : null,
    }));
  }

  return weekDates(mondayOfWeek(todayLocalDate)).map((localDate) => ({
    localDate,
    weekday: weekdayOfLocalDate(localDate),
    dayNumber: localDate.slice(8, 10),
    isToday: localDate === todayLocalDate,
    letter: null,
  }));
}

/**
 * Whether the sheet is still showing exactly what is saved. The primary
 * button stays blocked while this is false (design §3.5: "desabilitado
 * quando não há mudança"), which only ever suppresses a save that would
 * write the schedule it just read — never a real change.
 */
export function agendaSelectionChanged(
  value: WeeklyScheduleValue,
  initial: {
    scheduleMode: ScheduleMode;
    trainingDays: readonly Weekday[];
    /** The program's current prescribed frequency — what the flexible mode is saved with. */
    frequency: number;
  },
): boolean {
  const mode: ScheduleMode = value.scheduleMode ?? 'fixed';
  if (mode !== initial.scheduleMode) return true;
  if (mode === 'flexible') return (value.days ?? initial.frequency) !== initial.frequency;
  const selected = value.trainingDays ?? [];
  if (selected.length !== initial.trainingDays.length) return true;
  const initialDays = new Set(initial.trainingDays);
  return selected.some((day) => !initialDays.has(day));
}

/**
 * What the resumo names as "próximo treino" — the Schedule Engine's OWN
 * answer for today, never a re-derived one:
 *
 *  - `TODAY` while today's session is still pending, the exact rule
 *    `buildTreinoWeekStrip` already uses to put the rotation's cursor on
 *    today's circle (`SESSION_READY`/`MISSED_SESSION_DECISION_REQUIRED`);
 *  - `DATE` for the statuses that carry the engine's own `nextWorkoutDate`;
 *  - null when there is nothing honest to name (no program, schedule not set
 *    up yet), so the sentence falls back to the plain day count.
 */
export function agendaNextWorkoutTarget(
  resolution: ScheduleResolution | null,
): { kind: 'TODAY' } | { kind: 'DATE'; localDate: LocalDate } | null {
  if (!resolution) return null;
  if (resolution.status === 'SESSION_READY' || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {
    return { kind: 'TODAY' };
  }
  if ('nextWorkoutDate' in resolution && resolution.nextWorkoutDate) {
    return { kind: 'DATE', localDate: resolution.nextWorkoutDate };
  }
  return null;
}

export type AgendaSummaryKind = 'FLEXIBLE' | 'INVALID' | 'FREQUENCY_CHANGE' | 'DAYS';

/**
 * Which sentence (and colour) the resumo shows. A restatement of booleans the
 * sheet already computed from the shared helpers, in the design's own order:
 * the flexible mode describes itself, an incomplete selection names the
 * limits, a frequency change announces the rebuild, and anything else is a
 * plain day count.
 */
export function agendaSummaryKind(input: {
  flexible: boolean;
  complete: boolean;
  frequencyChanged: boolean;
}): AgendaSummaryKind {
  if (!input.complete) return 'INVALID';
  if (input.flexible) return 'FLEXIBLE';
  if (input.frequencyChanged) return 'FREQUENCY_CHANGE';
  return 'DAYS';
}
