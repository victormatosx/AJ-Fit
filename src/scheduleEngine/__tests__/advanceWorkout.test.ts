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
