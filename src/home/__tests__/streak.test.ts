import { describe, expect, it } from 'vitest';
import { computeStreak } from '../streak';

describe('computeStreak — fixed schedule', () => {
  const trainingDays = ['MON', 'WED', 'FRI'] as const;

  it('counts consecutive fulfilled obligations, most recent first', () => {
    // Mon 2026-09-07, Wed 2026-09-09, Fri 2026-09-11 all completed; today is Fri.
    const streak = computeStreak({
      todayLocalDate: '2026-09-11',
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-09', '2026-09-11']),
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 3, complete: true });
  });

  it('REST does not break the streak', () => {
    // Tue/Thu/Sat/Sun are REST for this trainingDays set — walking through them must not reset the count.
    const streak = computeStreak({
      todayLocalDate: '2026-09-09', // Wednesday
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-09']), // Mon + Wed
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 2, complete: true });
  });

  it('ACTIVE_RECOVERY does not break the streak', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-09', // Wednesday
      trainingDays,
      activeRecoveryDays: ['TUE'],
      completedDates: new Set(['2026-09-07', '2026-09-09']),
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 2, complete: true });
  });

  it('MISSED breaks the streak — only the unbroken tail counts', () => {
    // Mon done, Wed MISSED (no completion, already past), Fri done — today is Fri.
    const streak = computeStreak({
      todayLocalDate: '2026-09-11',
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-11']), // Wed missing
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 1, complete: true });
  });

  it('UPCOMING (future prescribed days) never counted and never seen, since the walk starts at today', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07', // Monday, just completed
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07']),
    });
    expect(streak.current).toBe(1);
  });

  it('TODAY_PENDING does not break an existing streak — today not being over yet is not a miss', () => {
    // Monday completed, today is Wednesday and not yet trained (day not over).
    const streak = computeStreak({
      todayLocalDate: '2026-09-09',
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07']),
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 1, complete: true });
  });

  it('multiple executions on the same day never double-count (completedDates is already deduplicated per day)', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07',
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07']), // one Set entry regardless of how many executions happened
    });
    expect(streak.current).toBe(1);
  });

  it('a freshly activated program with no history yet yields 0, not a crash or a negative count', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07',
      trainingDays,
      activeRecoveryDays: [],
      completedDates: new Set(),
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 0, complete: true });
  });

  it('program switch never resets or reinterprets a legitimate ongoing streak', () => {
    // Obligations fulfilled under a prior program (different programId, same
    // global scheduleConfig — see module doc comment) must still count.
    const streak = computeStreak({
      todayLocalDate: '2026-09-11', // Friday, under the NEW program
      trainingDays, // same trainingDays as before the switch
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-09-07', // Monday, old program
        '2026-09-09', // Wednesday, old program
        '2026-09-11', // Friday, new program (activatedAtLocalDate would be e.g. 2026-09-10)
      ]),
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 3, complete: true });
  });

  describe('FULFILLED_EARLY', () => {
    // trainingDays restricted to WED/FRI so every date below is unambiguous:
    // it is either one of the two weekly obligations or plain REST.
    const wedFriOnly = ['WED', 'FRI'] as const;

    it("is a single obligation, not two — early completion is obligation N, the original day doesn't add N+1", () => {
      // Wed 2026-09-09 completed normally (#1). Fri 2026-09-11's session is
      // performed Thu 2026-09-10 instead (COMPLETED on Thu, FULFILLED_EARLY on Fri).
      const streak = computeStreak({
        todayLocalDate: '2026-09-11', // Friday
        trainingDays: wedFriOnly,
        activeRecoveryDays: [],
        completedDates: new Set(['2026-09-09', '2026-09-10']), // Wed + the early Fri session on Thu
        fulfilledScheduledDates: new Set(['2026-09-11']), // Fri — the day it was originally due
      });
      // Wed (#1) + Thu's early completion (#2) = 2. Fri is FULFILLED_EARLY: no #3, no break.
      expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 2, complete: true });
    });

    it("matches the user's worked example: Wed is #5, Thu's early Fri-session is #6, Fri stays #6", () => {
      const streak = computeStreak({
        todayLocalDate: '2026-09-11', // Friday
        trainingDays: wedFriOnly,
        activeRecoveryDays: [],
        completedDates: new Set([
          '2026-08-26', '2026-08-28', // week of Aug 24: Wed + Fri (#1, #2)
          '2026-09-02', '2026-09-04', // week of Aug 31: Wed + Fri (#3, #4)
          '2026-09-09', // Wed of the current week = #5
          '2026-09-10', // Thu — the early Fri session = #6
        ]),
        fulfilledScheduledDates: new Set(['2026-09-11']), // Fri stays FULFILLED_EARLY, not a 7th
      });
      expect(streak.current).toBe(6);
    });
  });
});

describe('computeStreak — flexible schedule', () => {
  it('counts consecutive fully-elapsed weeks that met the weekly goal', () => {
    // Weeks of 2026-08-24 and 2026-08-31 both hit the goal of 3; today is 2026-09-10 (mid third week, not yet met).
    const streak = computeStreak({
      todayLocalDate: '2026-09-10',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-08-24', '2026-08-26', '2026-08-28', // week of Aug 24: 3/3
        '2026-08-31', '2026-09-02', '2026-09-04', // week of Aug 31: 3/3
        '2026-09-08', // week of Sep 7 (current, in progress): 1/3 so far
      ]),
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 2, complete: true });
  });

  it('credits the current in-progress week immediately once the goal is met, without waiting for the week to end', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-09', // Wednesday, week not over
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-08']), // 2/2 already, by Tuesday
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 1, complete: true });
  });

  it('never breaks early on the current week just because the goal is not met yet', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-08', // Tuesday, week just started (week of Sep 7)
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-08-31', '2026-09-02', '2026-09-04', // immediately prior week (Aug 31): met, 3/3
      ]),
    });
    // Current week (0 so far) doesn't count yet, but doesn't retroactively break the prior met week either.
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 1, complete: true });
  });

  it('a fully-elapsed week that missed the goal breaks the streak', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07', // Monday of a new week (week of Sep 7)
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-08-24', '2026-08-26', '2026-08-28', // week of Aug 24: met (3/3), but unreachable —
        '2026-08-31', // the immediately prior week (Aug 31) only has 1/3 and breaks first
      ]),
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 0, complete: true });
  });

  it('a goal of zero or undefined never produces a streak', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-14',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 0,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-08', '2026-09-09']),
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 0, complete: true });
  });

  it('program switch never resets an ongoing flexible streak either', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-10', // under the new program
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-08-24', '2026-08-26', // week of Aug 24, old program: 2/2
        '2026-08-31', '2026-09-02', // week of Aug 31, old program: 2/2
        '2026-09-07', '2026-09-08', // week of Sep 7, new program (current, in progress): 2/2 already
      ]),
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 3, complete: true });
  });

  it('a user with no history yet yields 0', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set(),
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 0, complete: true });
  });
});

describe('computeStreak — unit discrimination', () => {
  it('fixed and flexible are never comparable without checking `unit` first', () => {
    const fixed = computeStreak({
      todayLocalDate: '2026-09-07',
      trainingDays: ['MON'],
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07']),
    });
    const flexible = computeStreak({
      todayLocalDate: '2026-09-09',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-07', '2026-09-08']),
    });
    expect(fixed.unit).toBe('obligations');
    expect(flexible.unit).toBe('weeks');
    expect(fixed.unit).not.toBe(flexible.unit);
  });
});

describe('computeStreak — historyAvailableFromLocalDate (truncation awareness, Phase 2.5)', () => {
  it('fixed: a genuine break found BEFORE the floor is exact (complete: true), floor never reached', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-11', // Friday
      trainingDays: ['MON', 'WED', 'FRI'],
      activeRecoveryDays: [],
      completedDates: new Set(['2026-09-11']), // Wed (09-09) missing — breaks immediately
      historyAvailableFromLocalDate: '2026-01-01', // generous floor, never reached
    });
    expect(streak).toEqual({ scheduleMode: 'fixed', unit: 'obligations', current: 1, complete: true });
  });

  it('fixed: an unbroken run that reaches the floor without a real MISSED is reported as a LOWER BOUND, never as exact', () => {
    // trainingDays MON/WED/FRI, every single one completed for a run that
    // starts well before the fetched floor — the walk must never assume
    // the day right before the floor was a miss just because it has no
    // entry; it cannot know, because the caller never fetched that far.
    const completedDates = new Set<string>();
    let cursor = '2026-09-11'; // Friday
    for (let i = 0; i < 20; i += 1) {
      completedDates.add(cursor);
      // step back to the previous MON/WED/FRI occurrence (every ~2-3 days)
      const prev: Record<string, string> = {
        '2026-09-11': '2026-09-09', '2026-09-09': '2026-09-07', '2026-09-07': '2026-09-04',
        '2026-09-04': '2026-09-02', '2026-09-02': '2026-08-31', '2026-08-31': '2026-08-28',
        '2026-08-28': '2026-08-26', '2026-08-26': '2026-08-24',
      };
      cursor = prev[cursor] ?? '2026-08-01';
    }
    const streak = computeStreak({
      todayLocalDate: '2026-09-11',
      trainingDays: ['MON', 'WED', 'FRI'],
      activeRecoveryDays: [],
      completedDates,
      historyAvailableFromLocalDate: '2026-09-01', // deliberately narrower than the real run
    });
    expect(streak.complete).toBe(false);
    expect(streak.current).toBeGreaterThan(0); // a real, if partial, count — never silently 0 or a crash
  });

  it('flexible: an unbroken run of met weeks that reaches the floor is a lower bound, not exact', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-10',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-08-31', '2026-09-02', // week of Aug 31: 2/2, met
        '2026-09-07', '2026-09-08', // week of Sep 7 (current): 2/2, met
      ]),
      historyAvailableFromLocalDate: '2026-08-31', // the floor lands exactly at the earliest met week's Monday
    });
    expect(streak.complete).toBe(false); // the week BEFORE Aug 31 could not be checked
    expect(streak.current).toBe(2);
  });

  it('flexible: a real unmet week found before the floor is exact', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-10',
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 2,
      trainingDays: [],
      activeRecoveryDays: [],
      completedDates: new Set([
        '2026-09-07', '2026-09-08', // current week: 2/2, met
        '2026-08-31', // prior week: only 1/2, real miss
      ]),
      historyAvailableFromLocalDate: '2026-01-01',
    });
    expect(streak).toEqual({ scheduleMode: 'flexible', unit: 'weeks', current: 1, complete: true });
  });

  it('omitting historyAvailableFromLocalDate preserves the old exact-dataset contract (complete always true on a found break)', () => {
    const streak = computeStreak({
      todayLocalDate: '2026-09-07',
      trainingDays: ['MON'],
      activeRecoveryDays: [],
      completedDates: new Set(), // nothing — breaks on the very first MISSED before today
    });
    expect(streak.complete).toBe(true);
  });
});
