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

describe('daily notification suite', () => {
  it('evaluates workout and progression observers under the same scheduler claim', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    const evaluateApproaching = vi.fn(async () => suppressedApproaching);
    const evaluateReEngagement = vi.fn(async () => suppressedReengagement);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
      evaluateReEngagement,
    })).resolves.toMatchObject({
      status: 'SUPPRESSED',
      reason: 'REENGAGEMENT:INSUFFICIENT_MISSED_OPPORTUNITIES|WORKOUT:REST_DAY|APPROACHING:OUTSIDE_APPROACHING_WINDOW',
    });
    expect(evaluateReEngagement).toHaveBeenCalledWith('uid-1');
    expect(evaluateWorkout).toHaveBeenCalledWith('uid-1');
    expect(evaluateApproaching).toHaveBeenCalledWith('uid-1');
  });

  it('surfaces a progression candidate without changing workout semantics', async () => {
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => ({
        status: 'DISPATCHED' as const,
        notificationType: 'EVOLUTION_APPROACHING' as const,
        timezone: 'UTC',
        localDate: '2026-09-08',
        outcome: 'PENDING_RECEIPTS' as const,
      })),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
    })).resolves.toMatchObject({ status: 'DISPATCHED', timezone: 'UTC' });
  });

  it('requests the scheduler retry if either independent observer fails', async () => {
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => ({ status: 'FAILED' as const, timezone: 'UTC' })),
      evaluateReEngagement: vi.fn(async () => suppressedReengagement),
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
    })).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'REENGAGEMENT:MILESTONE_DUPLICATE',
    });
    expect(evaluateWorkout).not.toHaveBeenCalled();
    expect(evaluateApproaching).not.toHaveBeenCalled();
  });
});
