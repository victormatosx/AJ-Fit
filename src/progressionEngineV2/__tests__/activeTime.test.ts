import { describe, expect, it } from 'vitest';
import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import type { Weekday } from '../../state/AppState';
import { computeActiveTime, computeActiveTimeTrace } from '../activeTime';

const MON = '2026-07-20'; // known Monday anchor

describe('computeActiveTime', () => {
  it('accrues one active day per elapsed calendar day with full adherence', () => {
    const trainingDays: Weekday[] = ['MON', 'WED', 'FRI'];
    const dates: LocalDate[] = [];
    let cursor = MON;
    for (let i = 0; i < 14; i += 1) {
      dates.push(cursor);
      cursor = addDaysLocal(cursor, 1);
    }
    const executionDates = new Set(dates.filter((_, i) => ['MON', 'WED', 'FRI'].includes(weekdayAt(i))));
    const today = addDaysLocal(MON, 13);
    const result = computeActiveTime({ startDateInclusive: MON, todayLocalDate: today, trainingDays, executionDates });
    expect(result.activeDays).toBe(14);
    expect(result.pausedAt).toBeNull();
  });

  it('rest days never count as inactivity: Friday workout, weekend rest, Monday workout keeps active time flowing', () => {
    const trainingDays: Weekday[] = ['MON', 'WED', 'FRI'];
    // Fri (start) -> Sat -> Sun -> Mon, all present, only Fri/Mon have executions
    const friday = addDaysLocal(MON, -3); // Fri before MON anchor week... adjust: use MON+4 = Fri
    const fri = addDaysLocal(MON, 4);
    const sat = addDaysLocal(fri, 1);
    const sun = addDaysLocal(fri, 2);
    const mon = addDaysLocal(fri, 3);
    const executionDates = new Set<LocalDate>([fri, mon]);
    const result = computeActiveTime({ startDateInclusive: fri, todayLocalDate: mon, trainingDays, executionDates });
    expect(result.activeDays).toBe(4); // fri,sat,sun,mon
    expect(result.pausedAt).toBeNull();
    void friday; void sat; void sun;
  });

  it('low frequency (2x/week) is never mistaken for inactivity across the other 5 days', () => {
    const trainingDays: Weekday[] = ['TUE', 'FRI'];
    let cursor = MON;
    const executionDates = new Set<LocalDate>();
    const allDates: LocalDate[] = [];
    for (let i = 0; i < 21; i += 1) {
      allDates.push(cursor);
      cursor = addDaysLocal(cursor, 1);
    }
    for (const date of allDates) {
      const wd = new Date(date).getUTCDay(); // not used for logic, just building executions below
      void wd;
    }
    // Fulfil every prescribed Tue/Fri occurrence so only rest days remain unexecuted.
    for (const date of allDates) {
      if (isWeekday(date, ['TUE', 'FRI'])) executionDates.add(date);
    }
    const today = allDates[allDates.length - 1];
    const result = computeActiveTime({ startDateInclusive: MON, todayLocalDate: today, trainingDays, executionDates });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(21);
  });

  it('freezes active time after the configured consecutive missed-opportunity threshold, then resumes on the next execution without resetting the accumulated total', () => {
    const trainingDays: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI']; // 5x/week, high frequency
    let cursor = MON;
    const executionDates = new Set<LocalDate>();
    const allDates: LocalDate[] = [];
    for (let i = 0; i < 60; i += 1) {
      allDates.push(cursor);
      cursor = addDaysLocal(cursor, 1);
    }
    // First 30 calendar days: perfect attendance on every prescribed day.
    const first30 = allDates.slice(0, 30);
    for (const date of first30) {
      if (isWeekday(date, trainingDays)) executionDates.add(date);
    }
    // Then a long gap: no executions for the next 20 days (far more than the
    // 3-missed-opportunity threshold), then resumes on day 51 and stays
    // consistent through every prescribed day after that.
    const resumeBlock = allDates.slice(50);
    for (const date of resumeBlock) {
      if (isWeekday(date, trainingDays)) executionDates.add(date);
    }
    const today = allDates[allDates.length - 1];

    const result = computeActiveTime({ startDateInclusive: MON, todayLocalDate: today, trainingDays, executionDates });
    // Active days accrue for the first 30 days, then freeze once the missed
    // streak crosses the threshold, then resume counting from day 51 onward.
    // 30 (first block) + (60 - 51 + 1) days counted after resume through "today".
    expect(result.activeDays).toBeGreaterThanOrEqual(30);
    expect(result.activeDays).toBeLessThan(60);
    expect(result.pausedAt).toBeNull(); // resumed by "today"
  });

  it('stays paused (pausedAt set) while inactivity is still ongoing at evaluation time', () => {
    const trainingDays: Weekday[] = ['MON', 'WED', 'FRI'];
    let cursor = MON;
    const executionDates = new Set<LocalDate>();
    const allDates: LocalDate[] = [];
    for (let i = 0; i < 30; i += 1) {
      allDates.push(cursor);
      cursor = addDaysLocal(cursor, 1);
    }
    const first14 = allDates.slice(0, 14);
    for (const date of first14) {
      if (isWeekday(date, trainingDays)) executionDates.add(date);
    }
    // No executions at all afterward — still paused at evaluation time.
    const today = allDates[allDates.length - 1];
    const result = computeActiveTime({ startDateInclusive: MON, todayLocalDate: today, trainingDays, executionDates });
    expect(result.pausedAt).not.toBeNull();
    expect(result.activeDays).toBeLessThan(30);
  });

  it('includes the return date in the effective active window and excludes every paused date', () => {
    const returnDate: LocalDate = '2026-07-27';
    const result = computeActiveTimeTrace({
      startDateInclusive: MON,
      todayLocalDate: returnDate,
      trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      executionDates: new Set([returnDate]),
    });
    expect(result.countedDates).toEqual(new Set([
      '2026-07-20', '2026-07-21', '2026-07-22', returnDate,
    ]));
    expect(result.activeTime).toEqual({ activeDays: 4, pausedAt: null });
  });

  it('ignores a next-day scheduled execution until that civil date enters the active-time window', () => {
    const today: LocalDate = '2026-09-17';
    const tomorrow: LocalDate = '2026-09-18';
    const input = {
      startDateInclusive: today,
      trainingDays: ['FRI'] as Weekday[],
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

  it('empty schedule (no trainingDays) never triggers a pause', () => {
    let cursor = MON;
    const allDates: LocalDate[] = [];
    for (let i = 0; i < 40; i += 1) {
      allDates.push(cursor);
      cursor = addDaysLocal(cursor, 1);
    }
    const today = allDates[allDates.length - 1];
    const result = computeActiveTime({ startDateInclusive: MON, todayLocalDate: today, trainingDays: [], executionDates: new Set() });
    expect(result.pausedAt).toBeNull();
    expect(result.activeDays).toBe(40);
  });

  it('flexible never pauses active time because a particular weekday elapsed', () => {
    const result = computeActiveTime({
      startDateInclusive: MON,
      todayLocalDate: addDaysLocal(MON, 39),
      scheduleMode: 'flexible',
      // Even if stale legacy weekdays are present, explicit mode controls
      // semantics and none of these dates becomes a missed workout.
      trainingDays: ['MON', 'WED', 'FRI'],
      executionDates: new Set(),
    });
    expect(result).toEqual({ activeDays: 40, pausedAt: null });
  });

  it.each([
    ['2026-03-05', '2026-03-13'], // America/New_York spring-forward is Mar 8.
    ['2026-10-29', '2026-11-06'], // America/New_York fall-back is Nov 1.
  ] as const)('counts civil dates across DST boundaries, never 23/25-hour durations (%s → %s)', (start, today) => {
    const result = computeActiveTime({
      startDateInclusive: start,
      todayLocalDate: today,
      trainingDays: [],
      executionDates: new Set(),
    });
    expect(result).toEqual({ activeDays: 9, pausedAt: null });
  });
});

function weekdayAt(offsetFromMonday: number): Weekday {
  const order: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return order[offsetFromMonday % 7];
}

function isWeekday(date: LocalDate, allowed: readonly Weekday[]): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const map: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return allowed.includes(map[jsDay]);
}
