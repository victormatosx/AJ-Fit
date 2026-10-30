import { normalizeWeekdays } from '../lib/questionnaireSchema';
import type { Quiz, Weekday } from '../state/AppState';
import { maxWeeklyDaysForLevel, STANDARD_MAX_WEEKLY_DAYS } from './weeklyDayAllowance';

export type WeeklyScheduleValue = Pick<Quiz, 'days' | 'scheduleMode' | 'trainingDays'>;

/**
 * Every weekly frequency the app offers ANY level. 7 is absent by policy
 * (`weeklyDayAllowance.ts`): no level may train seven days a week, so it is
 * removed from the one list the pickers render AND `isWeeklyScheduleComplete`
 * validates against — a legacy 7-day value is therefore incomplete
 * everywhere, blocking a save instead of being silently rewritten.
 */
export const AVAILABLE_FREQUENCIES = [2, 3, 4, 5, 6] as const;

/**
 * Every helper below takes `maxDays` as an OPTIONAL argument defaulting to
 * `STANDARD_MAX_WEEKLY_DAYS` — the ceiling that applies to every level that
 * is not a beginner. Callers that know the account's level (the questionnaire
 * and the agenda sheet) pass the level-specific ceiling; a caller that does
 * not still never exceeds the app-wide maximum.
 */

/** The frequencies the questionnaire may offer for a level (flexible mode). */
export function availableFrequenciesForLevel(level: Quiz['level']): readonly number[] {
  return frequenciesWithin(maxWeeklyDaysForLevel(level));
}

export function frequenciesWithin(maxDays: number): readonly number[] {
  return AVAILABLE_FREQUENCIES.filter((frequency) => frequency <= maxDays);
}

export function isWeeklyScheduleComplete(value: WeeklyScheduleValue, maxDays = STANDARD_MAX_WEEKLY_DAYS): boolean {
  if (value.days == null || !AVAILABLE_FREQUENCIES.some((frequency) => frequency === value.days)) return false;
  // The ceiling is a completion requirement, not just a selection guard: a
  // value that got past the pickers (restored draft, level changed after the
  // days step) must still block the step's CTA rather than advance.
  if (value.days > maxDays) return false;
  if (value.scheduleMode === 'flexible') return value.trainingDays == null;
  return value.scheduleMode === 'fixed'
    && value.trainingDays?.length === value.days
    && new Set(value.trainingDays).size === value.days;
}

export function toggleFixedTrainingDay(
  value: WeeklyScheduleValue,
  day: Weekday,
  maxDays = STANDARD_MAX_WEEKLY_DAYS,
): WeeklyScheduleValue {
  const current = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];
  const removing = current.includes(day);
  // At the ceiling, selecting one MORE day is a no-op; deselecting always
  // works, and any already-selected day can be swapped by deselecting it
  // first. The cap constrains HOW MANY days, never WHICH ones.
  if (!removing && current.length >= maxDays) {
    const trainingDays = normalizeWeekdays(current);
    return { days: trainingDays.length || null, scheduleMode: 'fixed', trainingDays };
  }
  const trainingDays = normalizeWeekdays(
    removing ? current.filter((item) => item !== day) : [...current, day],
  );
  return {
    days: trainingDays.length || null,
    scheduleMode: 'fixed',
    trainingDays,
  };
}

export function selectFlexibleSchedule(
  value: WeeklyScheduleValue,
  maxDays = STANDARD_MAX_WEEKLY_DAYS,
): WeeklyScheduleValue {
  const carried = value.days != null
    && AVAILABLE_FREQUENCIES.some((frequency) => frequency === value.days)
    && value.days <= maxDays
    ? value.days
    : null;
  return {
    days: carried,
    scheduleMode: 'flexible',
    trainingDays: null,
  };
}

export function selectFixedSchedule(): WeeklyScheduleValue {
  return { days: null, scheduleMode: 'fixed', trainingDays: [] };
}

export function selectFlexibleFrequency(days: number, maxDays = STANDARD_MAX_WEEKLY_DAYS): WeeklyScheduleValue {
  // Defence in depth — the picker only ever renders allowed frequencies, so
  // an over-ceiling value here would mean a caller bypassed that list.
  return { days: days > maxDays ? null : days, scheduleMode: 'flexible', trainingDays: null };
}
