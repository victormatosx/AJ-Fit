import { describe, expect, it } from 'vitest';

import { advancedWorkoutTarget } from '../advanceWorkout';

const fridayRestDay = {
  status: 'REST_DAY' as const,
  nextWorkoutDate: '2026-09-18',
  nextSessionIndex: 3,
};

describe('advancedWorkoutTarget', () => {
  it('allows only tomorrow\'s next fixed opportunity from REST_DAY', () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed',
      resolution: fridayRestDay,
      todayLocalDate: '2026-09-17',
      sessionCount: 4,
      hasIncompatibleExecution: false,
    })).toEqual({
      sessionIndex: 3,
      scheduledLocalDate: '2026-09-18',
      performedLocalDate: '2026-09-17',
    });
  });

  it.each([
    ['flexible', { scheduleMode: 'flexible', resolution: fridayRestDay }],
    ['ACTIVE_RECOVERY_DAY', { scheduleMode: 'fixed', resolution: { ...fridayRestDay, status: 'ACTIVE_RECOVERY_DAY' } }],
    ['SESSION_READY', { scheduleMode: 'fixed', resolution: { status: 'SESSION_READY', sessionIndex: 3 } }],
    ['MISSED_SESSION_DECISION_REQUIRED', {
      scheduleMode: 'fixed',
      resolution: {
        status: 'MISSED_SESSION_DECISION_REQUIRED',
        missedSessionIndex: 2,
        calendarSessionIndex: 3,
        missedScheduledDate: '2026-09-16',
      },
    }],
    ['two days away', {
      scheduleMode: 'fixed',
      resolution: { ...fridayRestDay, nextWorkoutDate: '2026-09-19' },
    }],
  ] as const)('rejects %s', (_name, override) => {
    expect(advancedWorkoutTarget({
      scheduleMode: override.scheduleMode,
      resolution: override.resolution,
      todayLocalDate: '2026-09-17',
      sessionCount: 4,
      hasIncompatibleExecution: false,
    })).toBeNull();
  });

  it('rejects invalid sequence indices and any incompatible execution', () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed', resolution: { ...fridayRestDay, nextSessionIndex: 4 },
      todayLocalDate: '2026-09-17', sessionCount: 4, hasIncompatibleExecution: false,
    })).toBeNull();
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed', resolution: fridayRestDay,
      todayLocalDate: '2026-09-17', sessionCount: 4, hasIncompatibleExecution: true,
    })).toBeNull();
  });

  it('rejects a second advance after the cursor has already moved beyond tomorrow', () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed',
      resolution: { ...fridayRestDay, nextWorkoutDate: '2026-09-21', nextSessionIndex: 0 },
      todayLocalDate: '2026-09-17',
      sessionCount: 4,
      hasIncompatibleExecution: false,
    })).toBeNull();
  });
});

/**
 * Advancing is a one-day exception, and chaining is prevented by the day's own
 * state rather than by a dedicated guard: the day an advanced session was
 * performed resolves as TODAY_COMPLETED, and the opportunity's own day now
 * resolves as SESSION_READY (the next session) — and this function only ever
 * offers on a REST_DAY. Neither can produce a second advance.
 */
describe('advancedWorkoutTarget — cannot chain off an advanced session', () => {
  it('never offers on the day the advanced session was performed', () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed',
      resolution: { status: 'TODAY_COMPLETED', nextWorkoutDate: '2026-09-21', nextSessionIndex: 1 },
      todayLocalDate: '2026-09-20',
      sessionCount: 3,
      hasIncompatibleExecution: false,
    })).toBeNull();
  });

  it("never offers on the consumed opportunity's own day, now a ready session", () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed',
      resolution: { status: 'SESSION_READY', sessionIndex: 1 },
      todayLocalDate: '2026-09-21',
      sessionCount: 3,
      hasIncompatibleExecution: false,
    })).toBeNull();
  });

  it('still offers it on a genuine rest day whose next session is tomorrow', () => {
    expect(advancedWorkoutTarget({
      scheduleMode: 'fixed',
      resolution: { status: 'REST_DAY', nextWorkoutDate: '2026-09-22', nextSessionIndex: 1 },
      todayLocalDate: '2026-09-21',
      sessionCount: 3,
      hasIncompatibleExecution: false,
    })).toEqual({
      sessionIndex: 1,
      scheduledLocalDate: '2026-09-22',
      performedLocalDate: '2026-09-21',
    });
  });
});
