import { describe, expect, it } from 'vitest';

import { computeWeeklyFrequency, isValidWeeklyGoal, weeklyGoalForWeek } from '../weeklyFrequency';

// 2026-10-19 is a Monday; the week runs Mon 19 → Sun 25.
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const THU = '2026-10-22';
const FRI = '2026-10-23';
const SAT = '2026-10-24';
const SUN = '2026-10-25';

const at = (today: string, dates: string[], goal: number | null | undefined = 5, weekOffset?: number) =>
  computeWeeklyFrequency({
    todayLocalDate: today,
    goal,
    performedLocalDates: new Set(dates),
    ...(weekOffset === undefined ? {} : { weekOffset }),
  });

describe('computeWeeklyFrequency — the exact table from the spec (goal 5)', () => {
  const cases: [string[], number][] = [
    [[], 0],
    [[MON], 20],
    [[MON, TUE], 40],
    [[MON, TUE, WED], 60],
    [[MON, TUE, WED, THU], 80],
    [[MON, TUE, WED, THU, FRI], 100],
  ];
  for (const [dates, percent] of cases) {
    it(`${dates.length} dias treinados = ${percent}%`, () => {
      expect(at(SUN, dates).percent).toBe(percent);
      expect(at(SUN, dates).trainedDays).toBe(dates.length);
    });
  }
});

describe('over-achievement is capped on screen but never lost', () => {
  it('caps six days at 100% and reports the extra day', () => {
    const result = at(SUN, [MON, TUE, WED, THU, FRI, SAT]);
    expect(result.percent).toBe(100);
    expect(result.trainedDays).toBe(6);
    expect(result.extraDays).toBe(1);
    expect(result.goalMet).toBe(true);
  });

  it('reports no extra days when the goal is exactly met', () => {
    expect(at(SUN, [MON, TUE, WED, THU, FRI]).extraDays).toBe(0);
  });

  it('handles a full week against a goal of 1', () => {
    const result = at(SUN, [MON, TUE, WED, THU, FRI, SAT, SUN], 1);
    expect(result.percent).toBe(100);
    expect(result.extraDays).toBe(6);
  });
});

describe('the unit is the DAY, not the session', () => {
  it('counts a day once no matter how many sessions it holds', () => {
    // The input is already a set of performed dates, so two sessions on
    // Monday reach this function as one entry — pinned here on purpose.
    expect(at(SUN, [MON]).trainedDays).toBe(1);
  });

  it('ignores which session (A/B/C) was performed — it is not an input at all', () => {
    expect(at(SUN, [MON, WED]).percent).toBe(40);
  });
});

describe('recommended weekdays are irrelevant', () => {
  it('credits a weekend day exactly like a weekday', () => {
    expect(at(SUN, [SAT, SUN]).percent).toBe(40);
  });

  it('never penalises training on days other than the recommended ones', () => {
    // No weekday set is accepted by this function; there is nothing to miss.
    expect(at(SUN, [TUE, THU, SAT]).percent).toBe(60);
  });
});

describe('week boundaries', () => {
  it('ignores days from the previous and next week', () => {
    const result = at(SUN, ['2026-10-18', MON, TUE, '2026-10-26']);
    expect(result.trainedDays).toBe(2);
    expect(result.trainedLocalDates).toEqual([MON, TUE]);
  });

  it('starts the week on Monday regardless of which day is today', () => {
    for (const today of [MON, WED, SUN]) {
      expect(at(today, []).weekStartLocalDate).toBe(MON);
    }
  });

  it('describes a past week with weekOffset', () => {
    const result = at(WED, ['2026-10-13', '2026-10-15'], 5, -1);
    expect(result.weekStartLocalDate).toBe('2026-10-12');
    expect(result.trainedDays).toBe(2);
    expect(result.percent).toBe(40);
  });

  it('crosses a month boundary', () => {
    // 2026-11-02 is a Monday; the previous week is Oct 26 → Nov 1.
    const result = computeWeeklyFrequency({
      todayLocalDate: '2026-11-04', goal: 3,
      performedLocalDates: new Set(['2026-10-28', '2026-11-01']), weekOffset: -1,
    });
    expect(result.weekStartLocalDate).toBe('2026-10-26');
    expect(result.trainedDays).toBe(2);
  });

  it('crosses a year boundary', () => {
    // 2026-12-28 is a Monday; the week runs into 2027-01-03.
    const result = computeWeeklyFrequency({
      todayLocalDate: '2027-01-03', goal: 2,
      performedLocalDates: new Set(['2026-12-30', '2027-01-02']),
    });
    expect(result.weekStartLocalDate).toBe('2026-12-28');
    expect(result.trainedDays).toBe(2);
    expect(result.percent).toBe(100);
  });
});

describe('mid-week reads only count elapsed days', () => {
  it('does not count a future day inside the current week', () => {
    const result = at(WED, [MON, TUE, FRI]);
    expect(result.trainedDays).toBe(2);
    expect(result.trainedLocalDates).toEqual([MON, TUE]);
  });

  it('counts today itself', () => {
    expect(at(WED, [MON, WED]).trainedDays).toBe(2);
  });
});

describe('invalid or absent goals degrade safely', () => {
  it('reports null percent instead of dividing by zero', () => {
    for (const goal of [null, undefined, 0, -3, 8, 2.5, Number.NaN]) {
      // Built directly so an `undefined` goal is really absent rather than
      // absorbed by the helper's default.
      const result = computeWeeklyFrequency({
        todayLocalDate: SUN, goal: goal as number, performedLocalDates: new Set([MON, TUE]),
      });
      expect(result.percent).toBeNull();
      expect(result.goal).toBeNull();
      expect(result.goalMet).toBe(false);
      expect(result.extraDays).toBe(0);
      // The real days trained are still reported — only the ratio is unknown.
      expect(result.trainedDays).toBe(2);
    }
  });

  it('validates goals independently', () => {
    expect(isValidWeeklyGoal(1)).toBe(true);
    expect(isValidWeeklyGoal(7)).toBe(true);
    for (const value of [0, 8, 1.5, '5', null, undefined]) expect(isValidWeeklyGoal(value)).toBe(false);
  });
});

describe('food logging never moves the frequency', () => {
  it('has no nutrition input at all', () => {
    // Structural guarantee: the only activity input is `performedLocalDates`.
    expect(Object.keys(at(SUN, [MON]))).not.toContain('nutrition');
    expect(at(SUN, []).percent).toBe(0);
  });
});

describe('weeklyGoalForWeek — historical goals from sealed program instances', () => {
  const window = (goal: number, from: string, to: string | null) =>
    ({ goal, activatedAtLocalDate: from, supersededAtLocalDate: to });

  it('uses the only instance covering the week', () => {
    expect(weeklyGoalForWeek(MON, [window(3, '2026-09-01', null)])).toBe(3);
  });

  it('prefers the instance that covered most of the week', () => {
    // Old 3x goal covers Mon–Tue; new 5x goal covers Wed–Sun.
    const windows = [window(3, '2026-09-01', TUE), window(5, WED, null)];
    expect(weeklyGoalForWeek(MON, windows)).toBe(5);
  });

  it('breaks a tie by the most recent activation', () => {
    // 3x covers Mon–Thu (4 days), 5x covers Fri–Sun (3) — no tie there, so
    // build a real 50/50: Mon–Wed + Thu(=3) vs Thu–Sun minus one.
    const windows = [window(3, '2026-09-01', WED), window(5, THU, SAT)];
    // 3x: Mon,Tue,Wed = 3 days. 5x: Thu,Fri,Sat = 3 days. Newer wins.
    expect(weeklyGoalForWeek(MON, windows)).toBe(5);
  });

  it('ignores instances that do not touch the week at all', () => {
    const windows = [window(3, '2026-01-01', '2026-02-01'), window(4, '2026-10-01', null)];
    expect(weeklyGoalForWeek(MON, windows)).toBe(4);
  });

  it('ignores instances carrying an invalid goal', () => {
    expect(weeklyGoalForWeek(MON, [window(0, '2026-09-01', null)])).toBeNull();
    expect(weeklyGoalForWeek(MON, [window(99, '2026-09-01', null), window(4, '2026-09-01', null)])).toBe(4);
  });

  it('returns null when nothing covered the week — never a fabricated goal', () => {
    expect(weeklyGoalForWeek(MON, [])).toBeNull();
    expect(weeklyGoalForWeek(MON, [window(5, '2027-01-01', null)])).toBeNull();
  });

  it('does not let a later goal change rewrite an older week', () => {
    // The 5x instance only activates after the week in question.
    const windows = [window(3, '2026-09-01', SUN), window(5, '2026-10-26', null)];
    expect(weeklyGoalForWeek(MON, windows)).toBe(3);
  });
});
