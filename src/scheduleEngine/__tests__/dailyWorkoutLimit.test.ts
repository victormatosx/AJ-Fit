import { describe, expect, it } from 'vitest';

import {
  DAILY_LIMIT_CONSUMING_STATUSES,
  consumesDailyLimit,
  resolveDailyLimit,
} from '../dailyWorkoutLimit';

const TODAY = '2026-10-19';
const EXEC = 'exec_a';

const at = (overrides: Partial<Parameters<typeof resolveDailyLimit>[0]> = {}) =>
  resolveDailyLimit({
    performedLocalDate: TODAY, executionId: EXEC, marker: null, lastPerformedLocalDate: null, ...overrides,
  });

describe('which statuses consume the day', () => {
  it('counts the two credited statuses', () => {
    expect([...DAILY_LIMIT_CONSUMING_STATUSES]).toEqual(['COMPLETED', 'PARTIALLY_COMPLETED']);
    expect(consumesDailyLimit('COMPLETED')).toBe(true);
    expect(consumesDailyLimit('PARTIALLY_COMPLETED')).toBe(true);
  });

  it('never counts an abandoned or in-progress attempt', () => {
    for (const status of ['ABANDONED', 'IN_PROGRESS', '', null, undefined, 0]) {
      expect(consumesDailyLimit(status)).toBe(false);
    }
  });
});

describe('the day is open when nothing claimed it', () => {
  it('allows the first workout of the day', () => {
    expect(at()).toEqual({ status: 'AVAILABLE' });
  });

  it('allows a workout when the previous one was on another day', () => {
    expect(at({ lastPerformedLocalDate: '2026-10-18' })).toEqual({ status: 'AVAILABLE' });
  });

  it('allows a workout when the rotation has never been walked', () => {
    expect(at({ lastPerformedLocalDate: undefined })).toEqual({ status: 'AVAILABLE' });
  });
});

describe('a second workout on the same day is refused', () => {
  it('refuses when the marker belongs to a different execution', () => {
    expect(at({ marker: { executionId: 'exec_b' } }))
      .toEqual({ status: 'LIMIT_REACHED', reason: 'MARKER_PRESENT' });
  });

  it('refuses even when the marker carries no recognizable execution id', () => {
    for (const marker of [{}, { executionId: null }, { executionId: 42 }]) {
      expect(at({ marker })).toEqual({ status: 'LIMIT_REACHED', reason: 'MARKER_PRESENT' });
    }
  });

  it('refuses via the transition guard when an older completion left no marker', () => {
    expect(at({ marker: null, lastPerformedLocalDate: TODAY }))
      .toEqual({ status: 'LIMIT_REACHED', reason: 'LAST_PERFORMED_TODAY' });
  });
});

describe('the program-independent guard', () => {
  it('closes the day when another execution was credited on it', () => {
    expect(at({ creditedExecutionIdsToday: ['exec_other'] }))
      .toEqual({ status: 'LIMIT_REACHED', reason: 'CREDITED_EXECUTION_TODAY' });
  });

  it('never lets the execution being finalized block itself', () => {
    expect(at({ creditedExecutionIdsToday: [EXEC] })).toEqual({ status: 'AVAILABLE' });
  });

  it('closes the day when the list mixes this execution with another', () => {
    expect(at({ creditedExecutionIdsToday: [EXEC, 'exec_other'] }))
      .toEqual({ status: 'LIMIT_REACHED', reason: 'CREDITED_EXECUTION_TODAY' });
  });

  it('is inert when empty or absent', () => {
    expect(at({ creditedExecutionIdsToday: [] })).toEqual({ status: 'AVAILABLE' });
    expect(at({ creditedExecutionIdsToday: undefined })).toEqual({ status: 'AVAILABLE' });
  });

  it('is outranked by the marker, so a replay is still recognized', () => {
    expect(at({ marker: { executionId: EXEC }, creditedExecutionIdsToday: ['exec_other'] }))
      .toEqual({ status: 'ALREADY_CLAIMED_BY_THIS_EXECUTION' });
  });

  it('takes precedence over the instance-scoped backstop', () => {
    expect(at({ creditedExecutionIdsToday: ['exec_other'], lastPerformedLocalDate: TODAY }))
      .toEqual({ status: 'LIMIT_REACHED', reason: 'CREDITED_EXECUTION_TODAY' });
  });
});

describe('a replay of the same execution is never a second workout', () => {
  it('recognizes its own marker', () => {
    expect(at({ marker: { executionId: EXEC } }))
      .toEqual({ status: 'ALREADY_CLAIMED_BY_THIS_EXECUTION' });
  });

  it('prefers the marker over the transition guard, so a replay is not misread', () => {
    // Both signals point at today; the marker proves WHICH execution it was.
    expect(at({ marker: { executionId: EXEC }, lastPerformedLocalDate: TODAY }))
      .toEqual({ status: 'ALREADY_CLAIMED_BY_THIS_EXECUTION' });
  });
});

describe('the day boundary is the execution’s own performed date', () => {
  it('keys off performedLocalDate, not any other clock', () => {
    // A marker read for a different day is simply absent for this one.
    expect(at({ performedLocalDate: '2026-10-20', marker: null, lastPerformedLocalDate: TODAY }))
      .toEqual({ status: 'AVAILABLE' });
  });

  it('opens the next day after a completion', () => {
    expect(at({ performedLocalDate: '2026-10-20', lastPerformedLocalDate: TODAY }))
      .toEqual({ status: 'AVAILABLE' });
  });
});
