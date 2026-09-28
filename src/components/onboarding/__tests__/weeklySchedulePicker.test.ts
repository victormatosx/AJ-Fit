import { describe, expect, it } from 'vitest';
import {
  isWeeklyScheduleComplete,
  selectFixedSchedule,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../../../onboarding/weeklyScheduleSelection';

describe('weekly schedule selection', () => {
  it('derives days from fixed weekday selection and keeps canonical order', () => {
    let value: WeeklyScheduleValue = { days: null, scheduleMode: null, trainingDays: null };
    value = toggleFixedTrainingDay(value, 'FRI');
    value = toggleFixedTrainingDay(value, 'MON');
    expect(value).toEqual({
      days: 2,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'FRI'],
    });
    expect(isWeeklyScheduleComplete(value)).toBe(true);
  });

  it('supports deselection and requires at least two fixed days', () => {
    const twoDays = {
      days: 2,
      scheduleMode: 'fixed' as const,
      trainingDays: ['MON', 'FRI'],
    } satisfies WeeklyScheduleValue;
    const oneDay = toggleFixedTrainingDay(twoDays, 'FRI');
    expect(oneDay).toEqual({ days: 1, scheduleMode: 'fixed', trainingDays: ['MON'] });
    expect(isWeeklyScheduleComplete(oneDay)).toBe(false);
  });

  it('clears fixed weekdays in flexible mode while preserving a valid frequency', () => {
    expect(selectFlexibleSchedule({
      days: 3,
      scheduleMode: 'fixed',
      trainingDays: ['MON', 'WED', 'FRI'],
    })).toEqual({ days: 3, scheduleMode: 'flexible', trainingDays: null });
  });

  it('requires and stores an explicit 2-7 frequency for flexible training', () => {
    const incomplete = selectFlexibleSchedule({ days: null, scheduleMode: null, trainingDays: null });
    expect(isWeeklyScheduleComplete(incomplete)).toBe(false);
    const complete = selectFlexibleFrequency(4);
    expect(complete).toEqual({ days: 4, scheduleMode: 'flexible', trainingDays: null });
    expect(isWeeklyScheduleComplete(complete)).toBe(true);
  });

  it('returns to fixed-day selection with no invented weekdays or frequency', () => {
    expect(selectFixedSchedule()).toEqual({ days: null, scheduleMode: 'fixed', trainingDays: [] });
  });
});
