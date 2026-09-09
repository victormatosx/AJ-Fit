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

describe('daily notification suite', () => {
  it('evaluates workout and progression observers under the same scheduler claim', async () => {
    const evaluateWorkout = vi.fn(async () => suppressedWorkout);
    const evaluateApproaching = vi.fn(async () => suppressedApproaching);
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout,
      evaluateApproaching,
    })).resolves.toMatchObject({
      status: 'SUPPRESSED',
      reason: 'WORKOUT:REST_DAY|APPROACHING:OUTSIDE_APPROACHING_WINDOW',
    });
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
    })).resolves.toMatchObject({ status: 'DISPATCHED', timezone: 'UTC' });
  });

  it('requests the scheduler retry if either independent observer fails', async () => {
    await expect(evaluateDailyNotificationSuite('uid-1', {
      evaluateWorkout: vi.fn(async () => suppressedWorkout),
      evaluateApproaching: vi.fn(async () => ({ status: 'FAILED' as const, timezone: 'UTC' })),
    })).resolves.toMatchObject({ status: 'FAILED', timezone: 'UTC' });
  });
});
