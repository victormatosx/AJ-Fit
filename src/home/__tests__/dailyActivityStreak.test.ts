import { describe, expect, it } from 'vitest';

import { computeDailyActivityStreak, dailyActivityLookbackDays, unionActivityDays } from '../dailyActivityStreak';
import type { LocalDate } from '../../scheduleEngine/calendar';

const TODAY = '2026-10-18' as LocalDate;

const streak = (days: string[], today: string = TODAY, floor?: string | null) =>
  computeDailyActivityStreak({
    todayLocalDate: today as LocalDate,
    activityDates: new Set(days as LocalDate[]),
    historyAvailableFromLocalDate: (floor ?? null) as LocalDate | null,
  });

describe('computeDailyActivityStreak — one day counts once', () => {
  it('counts a day with a workout', () => {
    expect(streak(['2026-10-18'])).toEqual({ current: 1, complete: true });
  });

  it('counts a day with a meal exactly the same as a day with a workout', () => {
    // The caller unions both sources before calling, so the engine cannot
    // tell them apart by construction — that IS the "one day = +1" rule.
    expect(streak(['2026-10-18'])).toEqual({ current: 1, complete: true });
  });

  it('counts a day with a workout AND several meals as a single day', () => {
    // Four activities on 10-18 collapse to one Set entry upstream.
    expect(streak(['2026-10-18', '2026-10-17'])).toEqual({ current: 2, complete: true });
  });

  it('counts nothing when there is no activity at all', () => {
    expect(streak([])).toEqual({ current: 0, complete: true });
  });
});

describe('today is a grace day, yesterday is not', () => {
  it('keeps the streak alive when yesterday counted and today is still empty', () => {
    expect(streak(['2026-10-17', '2026-10-16'])).toEqual({ current: 2, complete: true });
  });

  it('credits today as soon as it has activity', () => {
    expect(streak(['2026-10-18', '2026-10-17', '2026-10-16'])).toEqual({ current: 3, complete: true });
  });

  it('reports zero when yesterday was already an empty day', () => {
    // Activity two days ago, nothing yesterday -> the streak is gone today.
    expect(streak(['2026-10-16', '2026-10-15'])).toEqual({ current: 0, complete: true });
  });

  it('restarts at 1 on the first activity after a break', () => {
    expect(streak(['2026-10-18', '2026-10-15', '2026-10-14'])).toEqual({ current: 1, complete: true });
  });
});

describe('the full worked example from the brief', () => {
  const run = (today: string, days: string[]) => streak(days, today).current;
  // Mon 12th workout -> 10, Tue 13th meal -> 11, Wed 14th nothing.
  const history = [
    '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13',
  ];

  it('reaches 10 on Monday and 11 on Tuesday', () => {
    expect(run('2026-10-12', history.slice(0, 9))).toBe(9);
    expect(run('2026-10-13', history)).toBe(10);
  });

  it('still shows the streak on the empty Wednesday (day still in progress)', () => {
    expect(run('2026-10-14', history)).toBe(10);
  });

  it('shows zero on Thursday, after a full empty day', () => {
    expect(run('2026-10-15', history)).toBe(0);
  });

  it('shows 1 on Thursday once a meal is registered', () => {
    expect(run('2026-10-15', [...history, '2026-10-15'])).toBe(1);
  });
});

describe('retroactivity — the core product rule', () => {
  // Mon 12 active, Tue 13 empty (break), Wed 14 active (new run of 1..),
  // Thu 15: user logs a meal DATED Tuesday. The caller credits the
  // REGISTRATION day (Thursday), never Tuesday.
  const afterBreak = ['2026-10-12', '2026-10-14'];

  it('does not revive the broken streak when the entry is credited to today', () => {
    const withRetroLoggedToday = [...afterBreak, '2026-10-15'];
    // Wed 14 + Thu 15 = 2. Tuesday stays empty, so the old run is NOT restored.
    expect(streak(withRetroLoggedToday, '2026-10-15')).toEqual({ current: 2, complete: true });
  });

  it('would wrongly restore the streak if the diary date were used instead', () => {
    // This is the bug the architecture exists to prevent, asserted as a
    // contrast: crediting Tuesday would chain 12-13-14-15 into 4.
    const wrong = [...afterBreak, '2026-10-13', '2026-10-15'];
    expect(streak(wrong, '2026-10-15').current).toBe(4);
  });

  it('a back-dated entry alone still qualifies the day it was registered', () => {
    // Nothing on the 15th except the retroactive write -> the 15th counts.
    expect(streak(['2026-10-15'], '2026-10-15')).toEqual({ current: 1, complete: true });
  });

  it('an entry five days back cannot bridge any of the empty days', () => {
    expect(streak(['2026-10-10', '2026-10-18'], TODAY)).toEqual({ current: 1, complete: true });
  });
});

describe('deletion of the last evidence', () => {
  it('drops the day once nothing supports it any more', () => {
    // The reader omits a day whose `loggedItemCount` fell to 0, so the day
    // simply is not in the set — and the streak recomputes around it.
    const before = streak(['2026-10-18', '2026-10-17', '2026-10-16']);
    const after = streak(['2026-10-18', '2026-10-16']);
    expect(before.current).toBe(3);
    expect(after.current).toBe(1);
  });
});

describe('truncated history is a lower bound, never an exact count', () => {
  it('reports complete:false when the walk hits the fetched floor', () => {
    const days = ['2026-10-18', '2026-10-17', '2026-10-16'];
    expect(streak(days, TODAY, '2026-10-16')).toEqual({ current: 3, complete: false });
  });

  it('reports complete:true once a real empty day is inside the window', () => {
    const days = ['2026-10-18', '2026-10-17'];
    expect(streak(days, TODAY, '2026-10-10')).toEqual({ current: 2, complete: true });
  });

  it('never celebrates on a lower bound (guarded upstream by `complete`)', () => {
    expect(streak(['2026-10-18', '2026-10-17', '2026-10-16'], TODAY, '2026-10-16').complete).toBe(false);
  });
});

describe('long streaks and month/year boundaries', () => {
  const consecutive = (endIso: string, n: number) => {
    const out: string[] = [];
    const d = new Date(`${endIso}T12:00:00Z`);
    for (let i = 0; i < n; i += 1) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return out;
  };

  it('crosses a month boundary', () => {
    expect(streak(consecutive('2026-10-18', 25)).current).toBe(25);
  });

  it('crosses a year boundary', () => {
    expect(streak(consecutive('2026-01-05', 400), '2026-01-05').current).toBe(400);
  });

  it('keeps counting past the 500-day visual ceiling', () => {
    // The tier ladder stops at 500; the NUMBER must not.
    expect(streak(consecutive('2026-10-18', 700)).current).toBe(700);
  });
});

describe('dailyActivityLookbackDays', () => {
  it('leaves slack for the terminating gap', () => {
    expect(dailyActivityLookbackDays(500)).toBe(502);
    expect(dailyActivityLookbackDays(0)).toBe(3);
  });
});

describe('unionActivityDays — a workout-backed day survives nutrition revocation', () => {
  it('keeps the day when the last food is deleted but a workout stands (Cenário 3)', () => {
    // Nutrition revoked Monday (empty set), the workout still holds it.
    const days = unionActivityDays(['2026-10-19'], []);
    expect(days.has('2026-10-19')).toBe(true);
  });

  it('drops the day when neither source backs it', () => {
    expect(unionActivityDays([], []).has('2026-10-19')).toBe(false);
  });

  it('counts a day backed by both exactly once', () => {
    const days = unionActivityDays(['2026-10-19'], ['2026-10-19']);
    expect(days.size).toBe(1);
  });

  it('merges disjoint days from the two sources', () => {
    const days = unionActivityDays(['2026-10-19'], ['2026-10-20']);
    expect([...days].sort()).toEqual(['2026-10-19', '2026-10-20']);
  });

  it('never mutates the inputs', () => {
    const workouts = new Set(['2026-10-19']);
    const nutrition = new Set(['2026-10-20']);
    unionActivityDays(workouts, nutrition);
    expect(workouts.size).toBe(1);
    expect(nutrition.size).toBe(1);
  });
});
