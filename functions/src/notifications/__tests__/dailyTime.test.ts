import { describe, expect, it } from 'vitest';

import {
  DAILY_WINDOW_END_MINUTE,
  DAILY_WINDOW_START_MINUTE,
  dailyLocalClock,
  instantForLocalTime,
  nextDailyEvaluationInstant,
  nextDailyWindowAfter,
} from '../dailyTime';

describe('daily notification timezone clock', () => {
  it.each([
    { timezone: 'America/Sao_Paulo', instant: '2026-09-07T11:00:00.000Z', date: '2026-09-07', minute: 480 },
    { timezone: 'UTC', instant: '2026-09-07T08:00:00.000Z', date: '2026-09-07', minute: 480 },
    { timezone: 'Australia/Brisbane', instant: '2026-09-06T22:00:00.000Z', date: '2026-09-07', minute: 480 },
  ])('resolves $timezone without fixed-offset arithmetic', ({ timezone, instant, date, minute }) => {
    expect(dailyLocalClock(new Date(instant), timezone)).toMatchObject({
      timezone,
      localDate: date,
      minuteOfDay: minute,
      withinWindow: true,
    });
  });

  it.each([
    { time: '07:59', minute: DAILY_WINDOW_START_MINUTE - 1, within: false },
    { time: '08:00', minute: DAILY_WINDOW_START_MINUTE, within: true },
    { time: '09:59', minute: DAILY_WINDOW_END_MINUTE - 1, within: true },
    { time: '10:00', minute: DAILY_WINDOW_END_MINUTE, within: false },
    { time: '23:59', minute: 23 * 60 + 59, within: false },
    { time: '00:00', minute: 0, within: false },
  ])('applies the half-open local window at $time', ({ time, minute, within }) => {
    const clock = dailyLocalClock(new Date(`2026-09-07T${time}:00.000Z`), 'UTC');
    expect(clock?.minuteOfDay).toBe(minute);
    expect(clock?.withinWindow).toBe(within);
  });

  it.each([
    ['2026-09-30', '2026-10-01'],
    ['2026-12-31', '2027-01-01'],
  ])('advances local dates across calendar boundary %s', (from, to) => {
    expect(nextDailyWindowAfter(from, 'UTC')?.toISOString()).toBe(`${to}T08:00:00.000Z`);
  });

  it('enters an active window immediately and otherwise targets its next start', () => {
    expect(nextDailyEvaluationInstant(
      new Date('2026-09-07T08:30:00.000Z'), 'UTC',
    )?.toISOString()).toBe('2026-09-07T08:30:00.000Z');
    expect(nextDailyEvaluationInstant(
      new Date('2026-09-07T07:59:00.000Z'), 'UTC',
    )?.toISOString()).toBe('2026-09-07T08:00:00.000Z');
    expect(nextDailyEvaluationInstant(
      new Date('2026-09-07T10:00:00.000Z'), 'UTC',
    )?.toISOString()).toBe('2026-09-08T08:00:00.000Z');
  });

  it('uses real DST data for America/New_York spring-forward', () => {
    expect(instantForLocalTime('2026-03-07', 480, 'America/New_York')?.toISOString())
      .toBe('2026-03-07T13:00:00.000Z');
    expect(instantForLocalTime('2026-03-08', 480, 'America/New_York')?.toISOString())
      .toBe('2026-03-08T12:00:00.000Z');
  });

  it('uses real DST data for America/New_York fall-back', () => {
    expect(instantForLocalTime('2026-10-31', 480, 'America/New_York')?.toISOString())
      .toBe('2026-10-31T12:00:00.000Z');
    expect(instantForLocalTime('2026-11-01', 480, 'America/New_York')?.toISOString())
      .toBe('2026-11-01T13:00:00.000Z');
  });

  it('fails closed for missing, invalid and fixed-offset timezones', () => {
    expect(dailyLocalClock(new Date(), undefined)).toBeNull();
    expect(dailyLocalClock(new Date(), 'Mars/Olympus_Mons')).toBeNull();
    expect(dailyLocalClock(new Date(), '-03:00')).toBeNull();
  });
});
