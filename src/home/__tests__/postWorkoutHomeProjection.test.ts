import { describe, expect, it } from 'vitest';

import { buildFrequencyWindow } from '../frequencyHeatmap';
import { buildWeekOverview } from '../weekOverview';
import { resolveWorkoutSchedule } from '../../scheduleEngine/resolver';

describe('durable workout completion -> Home projections', () => {
  it('the finalized ScheduleState resolves today as completed, never SESSION_READY', () => {
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: 2,
      config: { trainingDays: ['MON', 'THU'], timezone: 'UTC', scheduleVersion: 1 },
      state: {
        nextSessionIndex: 1,
        cursorDate: '2026-09-07',
        lastCompletedAt: '2026-09-07',
        pendingMissDecision: null,
      },
      activatedAtLocalDate: '2026-09-01',
      todayLocalDate: '2026-09-07',
    });

    expect(resolution.status).toBe('TODAY_COMPLETED');
  });

  it('the same authoritative completed execution date updates weekly progress and frequency', () => {
    const completedDates = new Set(['2026-09-07']);
    const week = buildWeekOverview({
      todayLocalDate: '2026-09-07',
      trainingDays: ['MON', 'THU'],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-01',
      completedDates,
    });
    const frequency = buildFrequencyWindow({
      todayLocalDate: '2026-09-07',
      offsetWindows: 0,
      completedDates,
    });

    expect(week.completedCount).toBe(1);
    expect(week.days.find((day) => day.isToday)?.status).toBe('TODAY_COMPLETED');
    expect(frequency.completedCount).toBe(1);
    expect(frequency.days.find((day) => day.isToday)?.completed).toBe(true);
  });

  it('a clean account moves from pending/empty to completed in both projections', () => {
    const before = buildWeekOverview({
      todayLocalDate: '2026-09-07',
      trainingDays: ['MON'],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-07',
      completedDates: new Set(),
    });
    const afterDates = new Set(['2026-09-07']);
    const after = buildWeekOverview({
      todayLocalDate: '2026-09-07',
      trainingDays: ['MON'],
      activeRecoveryDays: [],
      activatedAtLocalDate: '2026-09-07',
      completedDates: afterDates,
    });

    expect(before.days.find((day) => day.isToday)?.status).toBe('TODAY_PENDING');
    expect(after.days.find((day) => day.isToday)?.status).toBe('TODAY_COMPLETED');
    expect(buildFrequencyWindow({
      todayLocalDate: '2026-09-07', offsetWindows: 0, completedDates: afterDates,
    }).days.find((day) => day.isToday)?.completed).toBe(true);
  });
});
