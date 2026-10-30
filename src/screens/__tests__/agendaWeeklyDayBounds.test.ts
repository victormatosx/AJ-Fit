import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_WEEKLY_DAYS, maxWeeklyDaysForTrainingLevel } from '../../onboarding/weeklyDayAllowance';
import {
  isWeeklyScheduleComplete,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../../onboarding/weeklyScheduleSelection';
import type { CurrentTrainingLevel } from '../../workoutLifecycle/types';
import { agendaChangeRequiresAdaptation } from '../treinoAgendaPolicy';
import { AGENDA_MAX_DAYS, AGENDA_MIN_DAYS, agendaSummaryKind } from '../treinoAgendaPresentation';
import type { Weekday } from '../../state/AppState';

const WEEK: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const LEVELS: CurrentTrainingLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

function tapDays(days: readonly Weekday[], maxDays: number): WeeklyScheduleValue {
  let value: WeeklyScheduleValue = { days: null, scheduleMode: 'fixed', trainingDays: [] };
  for (const day of days) value = toggleFixedTrainingDay(value, day, maxDays);
  return value;
}

/** The sheet's own summary decision, from the same three inputs it uses. */
function summaryFor(value: WeeklyScheduleValue, maxDays: number, currentFrequency: number) {
  return agendaSummaryKind({
    flexible: value.scheduleMode === 'flexible',
    complete: isWeeklyScheduleComplete(value, maxDays),
    frequencyChanged: agendaChangeRequiresAdaptation(value, currentFrequency),
  });
}

describe('agenda — the sheet’s own bounds follow the policy', () => {
  it('reports 2 as the floor and 6 as the app-wide ceiling', () => {
    expect(AGENDA_MIN_DAYS).toBe(MIN_WEEKLY_DAYS);
    expect(AGENDA_MAX_DAYS).toBe(6);
  });
});

describe('agenda — fixed mode, every level', () => {
  it.each(LEVELS)('%s stops at its own ceiling', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    const value = tapDays(WEEK, max);
    expect(value.days).toBe(max);
    expect(value.trainingDays).toEqual(WEEK.slice(0, max));
  });

  it.each(LEVELS)('%s can save every count inside its own range', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    for (let days = MIN_WEEKLY_DAYS; days <= max; days += 1) {
      const value = tapDays(WEEK.slice(0, days), max);
      expect(isWeeklyScheduleComplete(value, max)).toBe(true);
      expect(summaryFor(value, max, days)).not.toBe('INVALID');
    }
  });

  it.each(LEVELS)('%s is blocked below the two-day floor', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    const oneDay = tapDays(['MON'], max);
    expect(summaryFor(oneDay, max, 3)).toBe('INVALID');
  });

  it.each(LEVELS)('%s may always change WHICH days without changing how many', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    const value = tapDays(['TUE', 'THU', 'SAT'].slice(0, Math.min(3, max)) as Weekday[], max);
    expect(agendaChangeRequiresAdaptation(value, value.days ?? 0)).toBe(false);
    expect(summaryFor(value, max, value.days ?? 0)).toBe('DAYS');
  });
});

describe('agenda — a stored over-ceiling schedule is blocked, never rewritten', () => {
  it.each(LEVELS)('%s sees a seven-day schedule as INVALID', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    const stored: WeeklyScheduleValue = { days: 7, scheduleMode: 'fixed', trainingDays: [...WEEK] };
    // The sheet presents exactly what is stored — nothing is mutated here —
    // but Salvar stays blocked until the user brings it inside the range.
    expect(stored.trainingDays).toHaveLength(7);
    expect(summaryFor(stored, max, 7)).toBe('INVALID');
    expect(isWeeklyScheduleComplete(stored, max)).toBe(false);
  });

  it('a beginner carrying 4-6 days is blocked until they come down to 3', () => {
    const max = maxWeeklyDaysForTrainingLevel('BEGINNER');
    for (const days of [4, 5, 6]) {
      const stored: WeeklyScheduleValue = {
        days, scheduleMode: 'fixed', trainingDays: WEEK.slice(0, days),
      };
      expect(summaryFor(stored, max, 3)).toBe('INVALID');
      // The same selection is perfectly valid once promoted.
      expect(isWeeklyScheduleComplete(stored, maxWeeklyDaysForTrainingLevel('INTERMEDIATE'))).toBe(true);
    }
  });
});

describe('agenda — flexible mode, every level', () => {
  it.each(LEVELS)('%s refuses an over-ceiling frequency', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    expect(selectFlexibleFrequency(7, max).days).toBeNull();
    expect(selectFlexibleFrequency(max + 1, max).days).toBeNull();
    expect(selectFlexibleFrequency(max, max).days).toBe(max);
  });

  it.each(LEVELS)('%s drops an over-ceiling frequency when switching to flexible', (level) => {
    const max = maxWeeklyDaysForTrainingLevel(level);
    expect(selectFlexibleSchedule(
      { days: 7, scheduleMode: 'fixed', trainingDays: [...WEEK] }, max,
    ).days).toBeNull();
  });
});

/**
 * The sheet has no render harness in this suite; these pin the WIRING, so a
 * future edit cannot quietly drop the bounds from one of the places that
 * must honour them.
 */
describe('agenda sheet — the bounds are threaded through every decision', () => {
  const source = readFileSync(resolve(__dirname, '../TreinoAgendaSheet.tsx'), 'utf8');

  it('takes the ceiling as a prop defaulting to the app-wide maximum', () => {
    expect(source).toContain('maxDays = AGENDA_MAX_DAYS');
  });

  it('gates completeness (and therefore Salvar) on it', () => {
    expect(source).toContain('isWeeklyScheduleComplete(value, maxDays)');
  });

  it('gates the day-circle toggle on it', () => {
    expect(source).toContain('toggleFixedTrainingDay(value, day.weekday, maxDays)');
  });

  it('gates the flexible-mode switch on it', () => {
    expect(source).toContain('selectFlexibleSchedule(value, maxDays)');
  });

  it('reuses the status line to report the real range and the ceiling', () => {
    expect(source).toContain("t('agenda.liveInvalidRange', { min: AGENDA_MIN_DAYS, max: maxDays })");
    expect(source).toContain("t('agenda.liveMaximumReached', { max: maxDays })");
  });

  it('is fed from the LIFECYCLE level by AppShell, never from the questionnaire', () => {
    const shell = readFileSync(resolve(__dirname, '../AppShell.tsx'), 'utf8');
    expect(shell).toContain('maxDays={maxWeeklyDaysForTrainingLevel(evolution.currentTrainingLevel)}');
    expect(shell).not.toContain('maxWeeklyDaysForLevel(quiz.level)');
  });
});
