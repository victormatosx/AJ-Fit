import { describe, expect, it } from 'vitest';
import { buildWeekOverview } from '../weekOverview';

describe('buildWeekOverview', () => {
  const trainingDays = ['MON', 'WED', 'FRI'] as const;

  it('marks completed training days, today, and rest days correctly', () => {
    // 2026-09-07 is a Monday.
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-09', // Wednesday
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-08-01',
      completedDates: new Set(['2026-09-07']), // Monday done
    });

    const byWeekday = Object.fromEntries(overview.days.map((d) => [d.weekday, d]));
    expect(byWeekday.MON.status).toBe('COMPLETED');
    expect(byWeekday.TUE.status).toBe('REST');
    expect(byWeekday.WED.status).toBe('TODAY_PENDING');
    expect(byWeekday.WED.isToday).toBe(true);
    expect(byWeekday.THU.status).toBe('REST');
    expect(byWeekday.FRI.status).toBe('UPCOMING');
    expect(overview.scheduledCount).toBe(3);
    expect(overview.completedCount).toBe(1);
  });

  it('marks a training day already completed today as TODAY_COMPLETED, not COMPLETED', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-07',
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-08-01',
      completedDates: new Set(['2026-09-07']),
    });
    const monday = overview.days.find((d) => d.weekday === 'MON')!;
    expect(monday.status).toBe('TODAY_COMPLETED');
    expect(overview.completedCount).toBe(1);
  });

  it('marks a past training day with no completion as MISSED, never REST', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-09', // Wednesday
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-08-01',
      completedDates: new Set(), // Monday never completed
    });
    const monday = overview.days.find((d) => d.weekday === 'MON')!;
    expect(monday.status).toBe('MISSED');
  });

  it('marks active-recovery days distinctly from plain rest days', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-09',
      trainingDays,
      activeRecoveryDays: ['TUE'],
      activatedAtLocalDate: '2026-08-01',
      completedDates: new Set(),
    });
    const tuesday = overview.days.find((d) => d.weekday === 'TUE')!;
    expect(tuesday.status).toBe('ACTIVE_RECOVERY');
  });

  it('shows an advanced workout on the real Thursday instead of hiding it as REST', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-17',
      trainingDays: ['MON', 'TUE', 'WED', 'FRI'],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-01',
      completedDates: new Set(['2026-09-17']),
      fulfilledScheduledDates: new Set(['2026-09-18']),
    });
    const thursday = overview.days.find((day) => day.weekday === 'THU')!;
    const friday = overview.days.find((day) => day.weekday === 'FRI')!;
    expect(thursday.status).toBe('TODAY_COMPLETED');
    expect(friday.status).toBe('FULFILLED_EARLY');
    expect(overview.completedCount).toBe(1);
  });

  it('does not turn the fulfilled Friday back into pending on Friday', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-18',
      trainingDays: ['MON', 'TUE', 'WED', 'FRI'],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-01',
      completedDates: new Set(['2026-09-17']),
      fulfilledScheduledDates: new Set(['2026-09-18']),
    });
    expect(overview.days.find((day) => day.weekday === 'THU')?.status).toBe('COMPLETED');
    expect(overview.days.find((day) => day.weekday === 'FRI')?.status).toBe('FULFILLED_EARLY');
  });

  it('marks days before program activation as BEFORE_PROGRAM even if they are training days', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-09',
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-08', // Tuesday — program starts mid-week
      completedDates: new Set(),
    });
    const monday = overview.days.find((d) => d.weekday === 'MON')!;
    expect(monday.status).toBe('BEFORE_PROGRAM');
  });

  it('never claims BEFORE_PROGRAM when activation date is unknown', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-09',
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: null,
      completedDates: new Set(),
    });
    const monday = overview.days.find((d) => d.weekday === 'MON')!;
    expect(monday.status).toBe('MISSED');
  });

  it('week always contains exactly 7 days, Monday through Sunday, regardless of which weekday today is', () => {
    const overview = buildWeekOverview({
      todayLocalDate: '2026-09-13', // Sunday
      trainingDays,
      activeRecoveryDays: [],
      activatedAtLocalDate: null,
      completedDates: new Set(),
    });
    expect(overview.days.map((d) => d.weekday)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(overview.days[0].localDate).toBe('2026-09-07');
    expect(overview.days[6].localDate).toBe('2026-09-13');
  });

  it('flexible reflects only real completions and never marks an untrained weekday as MISSED', () => {
    const overview = buildWeekOverview({
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      todayLocalDate: '2026-09-12',
      trainingDays: [],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-08-01',
      completedDates: new Set(['2026-09-08', '2026-09-11']),
    });
    expect(overview.days.filter((day) => day.status === 'COMPLETED')).toHaveLength(2);
    expect(overview.days.some((day) => day.status === 'MISSED')).toBe(false);
    expect(overview.scheduledCount).toBe(3);
    expect(overview.completedCount).toBe(2);
  });
});
