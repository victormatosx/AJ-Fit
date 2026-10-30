import { describe, expect, it } from 'vitest';
import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import type { Weekday } from '../../state/AppState';
import { PROGRESSION_V2_CONFIG } from '../config';
import { computeActiveTime, computeActiveTimeTrace, inactivityThresholdDays } from '../activeTime';

const MON = '2026-07-20'; // known Monday anchor

/**
 * Active Time, after inactivity stopped being inferred from RECOMMENDED
 * weekdays.
 *
 * The old rule counted "a prescribed weekday went by unused" as a missed
 * opportunity, so SEG/QUA/SEX recommended + TER/QUI/SÁB trained paused a user
 * who never stopped training. Inactivity is now what the name says: a run of
 * consecutive days with NO training at all, long enough to mean absence at
 * that user's own cadence (`inactivityThresholdDays`).
 */

/** `3 missed opportunities` at the user's own cadence, as days. */
const threshold = (frequency: number) => inactivityThresholdDays(frequency)!;

function datesFrom(start: LocalDate, count: number): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    dates.push(cursor);
    cursor = addDaysLocal(cursor, 1);
  }
  return dates;
}

function isWeekday(date: LocalDate, allowed: readonly Weekday[]): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const map: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return allowed.includes(map[jsDay]);
}

describe('inactivityThresholdDays', () => {
  it('scales the unchanged 3-missed-opportunity threshold by the user own cadence', () => {
    expect(PROGRESSION_V2_CONFIG.inactivityMissedOpportunityThreshold).toBe(3);
    expect(inactivityThresholdDays(1)).toBe(21);   // 3 x 7
    expect(inactivityThresholdDays(2)).toBe(12);   // 3 x ceil(7/2)
    expect(inactivityThresholdDays(3)).toBe(9);    // 3 x ceil(7/3)
    expect(inactivityThresholdDays(4)).toBe(6);
    expect(inactivityThresholdDays(5)).toBe(6);
    expect(inactivityThresholdDays(6)).toBe(6);
    expect(inactivityThresholdDays(7)).toBe(3);
  });

  it('refuses to invent a signal from an unusable frequency', () => {
    for (const value of [null, undefined, 0, -2, 8, 2.5, Number.NaN]) {
      expect(inactivityThresholdDays(value as number), `frequency=${String(value)}`).toBeNull();
    }
  });
});

describe('recommended weekdays are not obligations', () => {
  /** The exact scenario in the brief. */
  it('agenda SEG/QUA/SEX with training on TER/QUI/SÁB never pauses', () => {
    // Four full weeks, trained every Tue/Thu/Sat, never on a recommended day.
    const dates = datesFrom(MON, 28);
    const executionDates = new Set(dates.filter((date) => isWeekday(date, ['TUE', 'THU', 'SAT'])));
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(3),
      executionDates,
    });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(28);
  });

  it('training BELOW the weekly goal is low adherence, never abandonment', () => {
    // 3x/week goal, trained once a week for five weeks: the longest gap is
    // 6 days, under the 9-day inactivity threshold.
    const dates = datesFrom(MON, 35);
    const executionDates = new Set(dates.filter((date) => isWeekday(date, ['WED'])));
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(3),
      executionDates,
    });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(35);
  });
});

describe('computeActiveTime', () => {
  it('accrues one active day per elapsed calendar day with full adherence', () => {
    const dates = datesFrom(MON, 14);
    const executionDates = new Set(dates.filter((date) => isWeekday(date, ['MON', 'WED', 'FRI'])));
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[13],
      inactivityDayThreshold: threshold(3),
      executionDates,
    });
    expect(result.activeDays).toBe(14);
    expect(result.pausedAt).toBeNull();
  });

  it('rest days never count as inactivity: Friday workout, weekend rest, Monday workout keeps active time flowing', () => {
    const fri = addDaysLocal(MON, 4);
    const mon = addDaysLocal(fri, 3);
    const result = computeActiveTime({
      startDateInclusive: fri,
      todayLocalDate: mon,
      inactivityDayThreshold: threshold(3),
      executionDates: new Set<LocalDate>([fri, mon]),
    });
    expect(result.activeDays).toBe(4); // fri,sat,sun,mon
    expect(result.pausedAt).toBeNull();
  });

  it('low frequency (2x/week) is never mistaken for inactivity across the other 5 days', () => {
    const dates = datesFrom(MON, 21);
    const executionDates = new Set(dates.filter((date) => isWeekday(date, ['TUE', 'FRI'])));
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(2),
      executionDates,
    });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(21);
  });

  it('freezes active time after the threshold, then resumes without resetting the accumulated total', () => {
    const dates = datesFrom(MON, 60);
    const executionDates = new Set<LocalDate>();
    // First 30 calendar days: trained 5x/week.
    for (const date of dates.slice(0, 30)) {
      if (isWeekday(date, ['MON', 'TUE', 'WED', 'THU', 'FRI'])) executionDates.add(date);
    }
    // Then a 20-day silence, far past the 6-day threshold for 5x/week, then
    // a consistent return.
    for (const date of dates.slice(50)) {
      if (isWeekday(date, ['MON', 'TUE', 'WED', 'THU', 'FRI'])) executionDates.add(date);
    }
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(5),
      executionDates,
    });
    expect(result.activeDays).toBeGreaterThanOrEqual(30);
    expect(result.activeDays).toBeLessThan(60);
    expect(result.pausedAt).toBeNull(); // resumed by "today"
  });

  it('stays paused (pausedAt set) while inactivity is still ongoing at evaluation time', () => {
    const dates = datesFrom(MON, 30);
    const executionDates = new Set<LocalDate>();
    for (const date of dates.slice(0, 14)) {
      if (isWeekday(date, ['MON', 'WED', 'FRI'])) executionDates.add(date);
    }
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(3),
      executionDates,
    });
    expect(result.pausedAt).not.toBeNull();
    expect(result.activeDays).toBeLessThan(30);
  });

  it('includes the return date in the effective active window and excludes every paused date', () => {
    // 7x/week: three silent days are already prolonged inactivity.
    const result = computeActiveTimeTrace({
      startDateInclusive: MON,
      todayLocalDate: '2026-07-27',
      inactivityDayThreshold: threshold(7),
      executionDates: new Set(['2026-07-27']),
    });
    // 20,21,22 counted (22 completes the 3-day streak and still counts);
    // 23-26 are paused; 27 is the return and resumes the window.
    expect(result.countedDates).toEqual(new Set([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-27',
    ]));
    expect(result.activeTime).toEqual({ activeDays: 4, pausedAt: null });
  });

  it('never counts today or a future date as a consumed absence', () => {
    const today: LocalDate = '2026-09-17';
    const tomorrow: LocalDate = '2026-09-18';
    const input = {
      startDateInclusive: today,
      inactivityDayThreshold: threshold(7),
      executionDates: new Set<LocalDate>([tomorrow]),
    };
    expect(computeActiveTimeTrace({ ...input, todayLocalDate: today })).toEqual({
      activeTime: { activeDays: 1, pausedAt: null },
      countedDates: new Set([today]),
    });
    expect(computeActiveTimeTrace({ ...input, todayLocalDate: tomorrow })).toEqual({
      activeTime: { activeDays: 2, pausedAt: null },
      countedDates: new Set([today, tomorrow]),
    });
  });

  it('an unknown frequency never triggers a pause — no signal, no false inactivity', () => {
    const dates = datesFrom(MON, 40);
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: inactivityThresholdDays(undefined),
      executionDates: new Set(),
    });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(40);
  });

  it('applies one inactivity policy to every account — there is no flexible exemption', () => {
    // A flexible account used to accrue active days forever while absent,
    // because nothing but a named weekday could pause it. Prolonged absence
    // now freezes every account identically.
    const dates = datesFrom(MON, 40);
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: dates[dates.length - 1],
      inactivityDayThreshold: threshold(3),
      executionDates: new Set(),
    });
    expect(result.pausedAt).toBe(addDaysLocal(MON, 8)); // the 9th silent day
    expect(result.activeDays).toBe(9);
  });

  it.each([
    ['2026-03-05', '2026-03-13'], // America/New_York spring-forward is Mar 8.
    ['2026-10-29', '2026-11-06'], // America/New_York fall-back is Nov 1.
  ] as const)('counts civil dates across DST boundaries, never 23/25-hour durations (%s → %s)', (start, today) => {
    const result = computeActiveTime({
      startDateInclusive: start,
      todayLocalDate: today,
      inactivityDayThreshold: null,
      executionDates: new Set(),
    });
    expect(result).toEqual({ activeDays: 9, pausedAt: null });
  });
});
