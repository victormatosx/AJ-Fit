import { normalizeWeekdays } from '../lib/questionnaireSchema';
import type { Quiz, Weekday } from '../state/AppState';

export type WeeklyScheduleValue = Pick<Quiz, 'days' | 'scheduleMode' | 'trainingDays'>;

export const AVAILABLE_FREQUENCIES = [2, 3, 4, 5, 6, 7] as const;

export function isWeeklyScheduleComplete(value: WeeklyScheduleValue): boolean {
  if (value.days == null || !AVAILABLE_FREQUENCIES.some((frequency) => frequency === value.days)) return false;
  if (value.scheduleMode === 'flexible') return value.trainingDays == null;
  return value.scheduleMode === 'fixed'
    && value.trainingDays?.length === value.days
    && new Set(value.trainingDays).size === value.days;
}

export function toggleFixedTrainingDay(value: WeeklyScheduleValue, day: Weekday): WeeklyScheduleValue {
  const current = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];
  const trainingDays = normalizeWeekdays(
    current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
  );
  return {
    days: trainingDays.length || null,
    scheduleMode: 'fixed',
    trainingDays,
  };
}

export function selectFlexibleSchedule(value: WeeklyScheduleValue): WeeklyScheduleValue {
  return {
    days: value.days != null && AVAILABLE_FREQUENCIES.some((frequency) => frequency === value.days) ? value.days : null,
    scheduleMode: 'flexible',
    trainingDays: null,
  };
}

export function selectFixedSchedule(): WeeklyScheduleValue {
  return { days: null, scheduleMode: 'fixed', trainingDays: [] };
}

export function selectFlexibleFrequency(days: number): WeeklyScheduleValue {
  return { days, scheduleMode: 'flexible', trainingDays: null };
}
