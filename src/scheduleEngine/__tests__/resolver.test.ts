import { describe, expect, it } from 'vitest';
import { detectMissedSessionGap, resolveWorkoutSchedule } from '../resolver';
import type { ResolveWorkoutScheduleInput, ScheduleConfig } from '../types';

const MWF: ScheduleConfig = { trainingDays: ['MON', 'WED', 'FRI'], timezone: 'America/Sao_Paulo', scheduleVersion: 1 };
const EVERY_DAY: ScheduleConfig = { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], timezone: 'UTC', scheduleVersion: 1 };
const SESSION_COUNT = 4; // A, B, C, D

function base(overrides: Partial<ResolveWorkoutScheduleInput> = {}): ResolveWorkoutScheduleInput {
  return {
    hasActiveProgram: true,
    sessionCount: SESSION_COUNT,
    config: MWF,
    state: null,
    activatedAtLocalDate: '2026-08-03', // a Monday
    todayLocalDate: '2026-08-03',
    ...overrides,
  };
}

describe('resolveWorkoutSchedule — availability gates', () => {
  it('PROGRAM_NOT_AVAILABLE when there is no active program', () => {
    expect(resolveWorkoutSchedule(base({ hasActiveProgram: false }))).toEqual({ status: 'PROGRAM_NOT_AVAILABLE' });
  });

  it('PROGRAM_NOT_AVAILABLE when the program has zero sessions', () => {
    expect(resolveWorkoutSchedule(base({ sessionCount: 0 }))).toEqual({ status: 'PROGRAM_NOT_AVAILABLE' });
  });

  it('SCHEDULE_SETUP_REQUIRED when there is no config (legacy user, DR-017)', () => {
    expect(resolveWorkoutSchedule(base({ config: null }))).toEqual({ status: 'SCHEDULE_SETUP_REQUIRED' });
  });

  it('SCHEDULE_SETUP_REQUIRED when trainingDays is empty', () => {
    expect(resolveWorkoutSchedule(base({ config: { ...MWF, trainingDays: [] } }))).toEqual({ status: 'SCHEDULE_SETUP_REQUIRED' });
  });
});

describe('resolveWorkoutSchedule — activation and rest days', () => {
  it('SESSION_READY(A) when the program activates on a trainingDay', () => {
    // Monday 2026-08-03 is a trainingDay in MWF.
    expect(resolveWorkoutSchedule(base())).toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });

  it('REST_DAY on a non-trainingDay with no pending session', () => {
    // Wednesday 2026-08-05 activation but asking about Tuesday: still before
    // the first trainingDay, no gap yet.
    expect(resolveWorkoutSchedule(base({ activatedAtLocalDate: '2026-08-04', todayLocalDate: '2026-08-04' })))
      .toEqual({ status: 'REST_DAY' }); // Tuesday, not in MWF
  });

  it('REST_DAY mid-week with no completions yet and no trainingDay crossed', () => {
    // Activated Monday, asking Tuesday: Monday's session is still pending
    // for Monday itself was already handled by activation logic; Tuesday
    // isn't a trainingDay, so still REST_DAY (Monday's SESSION_READY was the
    // opportunity, unconsumed — a real caller would have shown it already).
    const state = { nextSessionIndex: 0, cursorDate: '2026-08-03', pendingMissDecision: null };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-04' }))).toEqual({ status: 'REST_DAY' });
  });
});

describe('resolveWorkoutSchedule — normal flow (A/B/C/D)', () => {
  it('offers B on Wednesday after A was completed Monday (cursor advanced by the completion)', () => {
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-05' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 1 });
  });

  it('offers C on Friday after B was completed Wednesday', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-05', pendingMissDecision: null };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-07' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });

  it('cycles back to A after D (sequence, not calendar, drives identity)', () => {
    const state = { nextSessionIndex: 0, cursorDate: '2026-08-10', pendingMissDecision: null }; // D completed the following Monday
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-12' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 0 });
  });
});

describe('resolveWorkoutSchedule — non-consecutive schedules and rest days', () => {
  it('stays REST_DAY on a rest day even when an earlier trainingDay was skipped and not yet reconfirmed', () => {
    // MON/TUE/THU/FRI: A completed Monday, B due Tuesday but skipped. Wednesday
    // is not a trainingDay at all — the gap must not surface as SESSION_READY
    // just because exactly one trainingDay (Tuesday) has elapsed since the cursor.
    const config: ScheduleConfig = { trainingDays: ['MON', 'TUE', 'THU', 'FRI'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null }; // Monday
    expect(resolveWorkoutSchedule(base({ config, state, todayLocalDate: '2026-08-05' }))) // Wednesday
      .toEqual({ status: 'REST_DAY' });
  });
});

describe('resolveWorkoutSchedule — missed session detection', () => {
  it('detects a single miss: Tuesday/Thursday cadence, B missed, resolver asked on Thursday', () => {
    // Config TUE/THU. A completed Tue, B due Thu but not completed; asking
    // on the following Tue reveals Thu(missed) + Tue(today) = 2 occurrences.
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-04', pendingMissDecision: null }; // Tue
    const result = resolveWorkoutSchedule(base({ config, state, todayLocalDate: '2026-08-11', sessionCount: 4 }));
    expect(result).toEqual({
      status: 'MISSED_SESSION_DECISION_REQUIRED',
      missedSessionIndex: 1, // B
      calendarSessionIndex: 2, // C — one occurrence skipped
    });
  });

  it('does not re-derive once a pending decision is already persisted (idempotent read)', () => {
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-08-04',
      pendingMissDecision: {
        missedSessionIndex: 1,
        calendarSessionIndex: 2,
        missedScheduledDate: '2026-08-06',
        detectedOnDate: '2026-08-11',
      },
    };
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-11' })))
      .toEqual({ status: 'MISSED_SESSION_DECISION_REQUIRED', missedSessionIndex: 1, calendarSessionIndex: 2 });
  });

  it('collapses multiple missed days into a single decision, not one per day', () => {
    // Every-day cadence, cursor at day 0; today is 5 days later — 4 missed + today = 5 occurrences.
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-03', pendingMissDecision: null };
    const result = resolveWorkoutSchedule(base({ config: EVERY_DAY, state, todayLocalDate: '2026-08-08', sessionCount: 4 }));
    expect(result.status).toBe('MISSED_SESSION_DECISION_REQUIRED');
    if (result.status === 'MISSED_SESSION_DECISION_REQUIRED') {
      expect(result.missedSessionIndex).toBe(1);
      expect(result.calendarSessionIndex).toBe((1 + 4) % 4); // 1
    }
  });
});

describe('resolveWorkoutSchedule — week boundary does not reset the sequence', () => {
  it('Friday finishes B; the following Monday still offers C, not A', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-07', pendingMissDecision: null }; // B completed Friday
    expect(resolveWorkoutSchedule(base({ state, todayLocalDate: '2026-08-10' }))) // next Monday
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });
});

describe('resolveWorkoutSchedule — 7 days/week', () => {
  it('every day is a trainingDay and offers the next session with no rest days', () => {
    const state = { nextSessionIndex: 2, cursorDate: '2026-08-05', pendingMissDecision: null };
    expect(resolveWorkoutSchedule(base({ config: EVERY_DAY, state, todayLocalDate: '2026-08-06' })))
      .toEqual({ status: 'SESSION_READY', sessionIndex: 2 });
  });
});

describe('detectMissedSessionGap', () => {
  it('returns null when there is no gap', () => {
    expect(detectMissedSessionGap(base())).toBeNull();
  });

  it('returns null when a decision is already pending (do not overwrite)', () => {
    const state = {
      nextSessionIndex: 1,
      cursorDate: '2026-08-04',
      pendingMissDecision: {
        missedSessionIndex: 1,
        calendarSessionIndex: 2,
        missedScheduledDate: '2026-08-06',
        detectedOnDate: '2026-08-11',
      },
    };
    expect(detectMissedSessionGap(base({ state, todayLocalDate: '2026-08-11' }))).toBeNull();
  });

  it('returns the gap to persist, including the first missed date', () => {
    const config: ScheduleConfig = { trainingDays: ['TUE', 'THU'], timezone: 'UTC', scheduleVersion: 1 };
    const state = { nextSessionIndex: 1, cursorDate: '2026-08-04', pendingMissDecision: null };
    expect(detectMissedSessionGap(base({ config, state, todayLocalDate: '2026-08-11' }))).toEqual({
      missedSessionIndex: 1,
      calendarSessionIndex: 2,
      missedScheduledDate: '2026-08-06',
    });
  });
});
