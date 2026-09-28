import { describe, expect, it, vi } from 'vitest';

import { evaluateDailyNotificationSuite } from '../dailyNotificationSuite';

const suppressedWorkout = {
  status: 'SUPPRESSED' as const,
  reason: 'REST_DAY',
  timezone: 'UTC',
  localDate: '2026-09-08',
};
const suppressedApproaching = {
  status: 'SUPPRESSED' as const,
  reason: 'OUTSIDE_APPROACHING_WINDOW',
  timezone: 'UTC',
  localDate: '2026-09-08',
};
const suppressedReengagement = {
  status: 'SUPPRESSED' as const,
  reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES',
  timezone: 'UTC',
  localDate: '2026-09-08',
  blocksLowerPriorityNotifications: false,
};
const suppressedProgress = {
  status: 'SUPPRESSED' as const,
  reason: 'NO_PROGRESS_CANDIDATE',
  timezone: 'UTC',
  localDate: '2026-09-08',
};
const suppressedWeeklyAchievement = {
  status: 'SUPPRESSED' as const,
  reason: 'NO_WEEKLY_ACHIEVEMENT',
  timezone: 'UTC',
  localDate: '2026-09-08',
};

describe('daily notification suite', () => {
  it('evaluates workout and progression observers under the same scheduler claim', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    const evaluateApproaching = vi.fn(async () => suppressedApproaching);
    const evaluateReEngagement = vi.fn(async () => suppressedReengagement);
    const evaluateProgress = vi.fn(async () => suppressedProgress);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
      evaluateReEngagement,
      evaluateProgress,
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({
      status: 'SUPPRESSED',
      reason: 'REENGAGEMENT:INSUFFICIENT_MISSED_OPPORTUNITIES|WEEKLY_ACHIEVEMENT:NO_WEEKLY_ACHIEVEMENT|WORKOUT:REST_DAY|APPROACHING:OUTSIDE_APPROACHING_WINDOW|PROGRESS:NO_PROGRESS_CANDIDATE',
    });
    expect(evaluateReEngagement).toHaveBeenCalledWith('uid-1');
    expect(evaluateWorkout).toHaveBeenCalledWith('uid-1');
    expect(evaluateApproaching).toHaveBeenCalledWith('uid-1');
    expect(evaluateProgress).toHaveBeenCalledWith('uid-1');
  });

  it('emits a structured terminal condition when composed reasons confirm a missing user', async () => {
    const missing = {
      status: 'SUPPRESSED' as const,
      reason: 'USER_NOT_FOUND',
      timezone: 'UTC',
      localDate: '2026-09-08',
    };
    await expect(evaluateDailyNotificationSuite('uid-missing', {
      evaluateWorkout: vi.fn(async () => missing),
      evaluateApproaching: vi.fn(async () => missing),
      evaluateReEngagement: vi.fn(async () => ({
        ...missing,
        blocksLowerPriorityNotifications: false,
      })),
      evaluateProgress: vi.fn(async () => missing),
      evaluateWeeklyAchievement: vi.fn(async () => missing),
    })).resolves.toMatchObject({
      status: 'SUPPRESSED',
      reason: 'REENGAGEMENT:USER_NOT_FOUND|WEEKLY_ACHIEVEMENT:USER_NOT_FOUND|WORKOUT:USER_NOT_FOUND|APPROACHING:USER_NOT_FOUND|PROGRESS:USER_NOT_FOUND',
      terminalCondition: 'USER_NOT_FOUND',
    });
  });

  it('does not emit a terminal condition when one evaluator fails', async () => {
    const result = await evaluateDailyNotificationSuite('uid-indeterminate', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => ({ status: 'FAILED' as const, timezone: 'UTC' })),
      evaluateReEngagement: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'USER_NOT_FOUND',
        timezone: 'UTC',
        localDate: '2026-09-08',
        blocksLowerPriorityNotifications: false,
      })),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    });

    expect(result).toMatchObject({ status: 'FAILED' });
    expect(result).not.toHaveProperty('terminalCondition');
  });

  it('surfaces a progression candidate without changing workout semantics', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching: vi.fn(async () => ({
        status: 'DISPATCHED' as const,
        notificationType: 'EVOLUTION_APPROACHING' as const,
        timezone: 'UTC',
        localDate: '2026-09-08',
        outcome: 'PENDING_RECEIPTS' as const,
      })),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({ status: 'DISPATCHED', timezone: 'UTC' });
    // Same-tier candidates are never derived once the tier already has a winner.
    expect(evaluateWorkout).not.toHaveBeenCalled();
  });

  it('never evaluates a workout candidate in parallel with an approaching candidate', async () => {
    const order: string[] = [];
    const evaluateApproaching = vi.fn(async () => {
      order.push('approaching:start');
      await Promise.resolve();
      order.push('approaching:end');
      return suppressedApproaching;
    });
    const evaluateWorkout = vi.fn(async () => {
      order.push('workout:start');
      return suppressedWorkout;
    });
    await evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    });
    expect(order).toEqual(['approaching:start', 'approaching:end', 'workout:start']);
  });

  it('lets an enabled workout candidate win the day when approaching is preference-suppressed', async () => {
    const evaluateWorkout = vi.fn(async () => ({
      status: 'DISPATCHED' as const,
      notificationType: 'WORKOUT_DAY' as const,
      timezone: 'UTC',
      localDate: '2026-09-08',
      outcome: 'PENDING_RECEIPTS' as const,
    }));
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching: vi.fn(async () => ({
        ...suppressedApproaching,
        reason: 'DISABLED_BY_USER',
      })),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(evaluateWorkout).toHaveBeenCalledWith('uid-1');
  });

  it('requests the scheduler retry if either independent observer fails', async () => {
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => ({ status: 'FAILED' as const, timezone: 'UTC' })),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({ status: 'FAILED', timezone: 'UTC' });

    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => ({ status: 'FAILED' as const, timezone: 'UTC' })),
      evaluateApproaching: vi.fn(async () => suppressedApproaching),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({ status: 'FAILED', timezone: 'UTC' });
  });

  it.each(['RE_ENGAGEMENT_EARLY', 'RE_ENGAGEMENT_LATE'] as const)(
    'gives %s priority over workout, missed, recovery and approaching candidates',
    async (notificationType) => {
      const evaluateWorkout = vi.fn(async () => suppressedWorkout);
      const evaluateApproaching = vi.fn(async () => suppressedApproaching);
      await expect(evaluateDailyNotificationSuite('uid-1', {
        evaluateWorkout,
        evaluateApproaching,
        evaluateReEngagement: vi.fn(async () => ({
          status: 'DISPATCHED' as const,
          notificationType,
          timezone: 'UTC',
          localDate: '2026-09-08',
          outcome: 'PENDING_RECEIPTS' as const,
          blocksLowerPriorityNotifications: true as const,
        })),
        evaluateProgress: vi.fn(async () => suppressedProgress),
        evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
      })).resolves.toMatchObject({ status: 'DISPATCHED' });
      expect(evaluateWorkout).not.toHaveBeenCalled();
      expect(evaluateApproaching).not.toHaveBeenCalled();
    },
  );

  it('keeps lower-priority daily notifications suppressed after a stage was already sent', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    const evaluateApproaching = vi.fn(async () => suppressedApproaching);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
      evaluateReEngagement: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'MILESTONE_DUPLICATE',
        timezone: 'UTC',
        localDate: '2026-09-08',
        blocksLowerPriorityNotifications: true,
      })),
      evaluateProgress: vi.fn(async () => suppressedProgress),
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'REENGAGEMENT:MILESTONE_DUPLICATE',
    });
    expect(evaluateWorkout).not.toHaveBeenCalled();
    expect(evaluateApproaching).not.toHaveBeenCalled();
  });

  it('evaluates progress only after workout, re-engagement and evolution are suppressed', async () => {
    const evaluateProgress = vi.fn(async () => ({
      status: 'DISPATCHED' as const,
      notificationType: 'COMPARE_PROGRESS' as const,
      timezone: 'UTC',
      localDate: '2026-09-08',
      outcome: 'PENDING_RECEIPTS' as const,
    }));
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => suppressedApproaching),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress,
      evaluateWeeklyAchievement: vi.fn(async () => suppressedWeeklyAchievement),
    })).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(evaluateProgress).toHaveBeenCalledWith('uid-1');
  });

  it('gives a weekly achievement priority over workout, approaching and progress candidates', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    const evaluateApproaching = vi.fn(async () => suppressedApproaching);
    const evaluateProgress = vi.fn(async () => suppressedProgress);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
      evaluateProgress,
      evaluateWeeklyAchievement: vi.fn(async () => ({
        status: 'DISPATCHED' as const,
        notificationType: 'WEEK_STREAK' as const,
        timezone: 'UTC',
        localDate: '2026-09-08',
        outcome: 'PENDING_RECEIPTS' as const,
      })),
    })).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(evaluateWorkout).not.toHaveBeenCalled();
    expect(evaluateApproaching).not.toHaveBeenCalled();
    expect(evaluateProgress).not.toHaveBeenCalled();
  });
});
