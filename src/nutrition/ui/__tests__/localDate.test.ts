import { describe, expect, it } from 'vitest';
import {
  endOfLocalWeek, isFutureLocalDate, localWeekDates, shiftLocalDate, startOfLocalWeek,
  toLocalDateString, todayLocalDate,
} from '../localDate';

describe('toLocalDateString / todayLocalDate', () => {
  it('formats using LOCAL calendar fields, never UTC', () => {
    // 23:30 local time on Jan 5th must stay Jan 5th locally, even though
    // this same instant can already be Jan 6th in UTC — the whole point of
    // using local getters instead of toISOString() (round brief part 1).
    const localLateNight = new Date(2026, 0, 5, 23, 30, 0);
    expect(toLocalDateString(localLateNight)).toBe('2026-01-05');
  });

  it('pads single-digit month/day', () => {
    expect(toLocalDateString(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('todayLocalDate defaults to now and accepts an explicit date', () => {
    const fixed = new Date(2026, 5, 15);
    expect(todayLocalDate(fixed)).toBe('2026-06-15');
  });
});

describe('shiftLocalDate', () => {
  it('moves forward and backward across month/year boundaries', () => {
    expect(shiftLocalDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftLocalDate('2026-02-28', 1)).toBe('2026-03-01'); // 2026 is not a leap year
    expect(shiftLocalDate('2026-06-15', 0)).toBe('2026-06-15');
  });
});

describe('isFutureLocalDate', () => {
  it('blocks a date strictly after today, allows today and the past', () => {
    const now = new Date(2026, 5, 15);
    expect(isFutureLocalDate('2026-06-16', now)).toBe(true);
    expect(isFutureLocalDate('2026-06-15', now)).toBe(false);
    expect(isFutureLocalDate('2026-06-14', now)).toBe(false);
  });
});

describe('Monday-first local weeks', () => {
  it('keeps Monday and Sunday in the same week', () => {
    expect(startOfLocalWeek('2026-10-05')).toBe('2026-10-05');
    expect(startOfLocalWeek('2026-10-11')).toBe('2026-10-05');
    expect(endOfLocalWeek('2026-10-05')).toBe('2026-10-11');
  });

  it('crosses month and year boundaries without UTC conversion', () => {
    expect(localWeekDates('2025-12-29')).toEqual([
      '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
    ]);
    expect(startOfLocalWeek(new Date(2026, 2, 1, 23, 59))).toBe('2026-02-23');
  });
});
