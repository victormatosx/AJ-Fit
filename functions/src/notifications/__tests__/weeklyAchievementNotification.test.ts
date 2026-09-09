import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  evaluateWeeklyAchievementNotification,
  type WeeklyAchievementDependencies,
} from '../weeklyAchievementNotification';

const NOW = Timestamp.fromDate(new Date('2026-09-11T12:00:00Z'));

function fixture(overrides: Partial<WeeklyAchievementDependencies> = {}): WeeklyAchievementDependencies {
  return {
    now: () => NOW,
    readContext: vi.fn(async () => ({
      allowed: true as const,
      timezone: 'America/Sao_Paulo',
      localDate: '2026-09-11',
      candidate: {
        notificationType: 'WEEK_COMPLETED' as const,
        achievementIdentity: 'week:2026-09-07:prescription-hash',
        week: {
          weekStart: '2026-09-07', weekEnd: '2026-09-13', opportunityCount: 3,
          fulfilledCount: 3, perfect: true, prescriptionIdentity: 'prescription-hash',
        },
      },
    })),
    claimMilestone: vi.fn(async () => ({ outcome: 'CLAIMED' as const, milestoneId: 'milestone-1', claimToken: 'claim-1' })),
    completeMilestone: vi.fn(async () => true),
    releaseMilestone: vi.fn(async () => true),
    claimProductWindow: vi.fn(async () => ({ outcome: 'CLAIMED' as const, windowId: 'window-1', claimToken: 'window-claim' })),
    completeProductWindow: vi.fn(async () => true),
    releaseProductWindow: vi.fn(async () => true),
    dispatchCandidate: vi.fn(async (candidate) => {
      const request = candidate.build('pt-BR');
      return { status: 'PENDING_RECEIPTS' as const, dispatchId: request.notificationId, deviceCount: 1, acceptedCount: 1 };
    }),
    resolvePolicy: vi.fn(async () => ({
      allowed: true as const, reason: 'ALLOWED' as const, locale: 'pt-BR' as const,
    })),
    ...overrides,
  };
}

describe('weekly achievement notification orchestration', () => {
  it('dispatches WEEK_COMPLETED through the canonical candidate and shared product window', async () => {
    const dependencies = fixture();
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'WEEK_COMPLETED', outcome: 'PENDING_RECEIPTS',
    });
    expect(dependencies.dispatchCandidate).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1', category: 'EVOLUTION_AND_ACHIEVEMENTS',
    }));
    expect(dependencies.completeMilestone).toHaveBeenCalledTimes(1);
    expect(dependencies.completeProductWindow).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a replay whose semantic milestone is already claimed/completed', async () => {
    const dispatchCandidate = vi.fn();
    const dependencies = fixture({
      claimMilestone: vi.fn(async () => ({ outcome: 'DUPLICATE' as const, milestoneId: 'same' })),
      dispatchCandidate: dispatchCandidate as never,
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'MILESTONE_DUPLICATE',
    });
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('releases its milestone when another product notification owns the local-day slot', async () => {
    const dependencies = fixture({
      claimProductWindow: vi.fn(async () => ({ outcome: 'RATE_LIMITED' as const, windowId: 'window-1' })),
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'PRODUCT_RATE_LIMIT',
    });
    expect(dependencies.releaseMilestone).toHaveBeenCalledWith(expect.objectContaining({
      milestoneId: 'milestone-1', claimToken: 'claim-1',
    }));
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('uses the backend-proven streak count in the canonical localized builder', async () => {
    const requests: unknown[] = [];
    const dependencies = fixture({
      readContext: vi.fn(async () => ({
        allowed: true as const,
        timezone: 'America/Sao_Paulo',
        localDate: '2026-09-11',
        candidate: {
          notificationType: 'WEEK_STREAK' as const,
          achievementIdentity: 'streak:2026-08-17:2026-09-07:4',
          weeks: 4 as const,
          sequenceStartWeek: '2026-08-17',
          week: {
            weekStart: '2026-09-07', weekEnd: '2026-09-13', opportunityCount: 3,
            fulfilledCount: 3, perfect: true, prescriptionIdentity: 'hash',
          },
        },
      })),
      dispatchCandidate: vi.fn(async (candidate) => {
        requests.push(candidate.build('pt-BR'));
        return { status: 'CONFIRMED' as const, dispatchId: 'dispatch-1', deviceCount: 1, acceptedCount: 1 };
      }),
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'WEEK_STREAK',
    });
    expect(requests[0]).toMatchObject({
      type: 'WEEK_STREAK', title: '4 semanas seguidas 🔥', data: {},
    });
  });

  it('fails closed and never dispatches when pre-evaluation cannot prove the fact', async () => {
    const dependencies = fixture({
      readContext: vi.fn(async () => ({ allowed: false as const, reason: 'HISTORY_UNAVAILABLE' })),
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'HISTORY_UNAVAILABLE',
    });
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('does not consume a milestone or product window when achievement preferences are off', async () => {
    const dependencies = fixture({
      resolvePolicy: vi.fn(async () => ({
        allowed: false as const, reason: 'DISABLED_BY_USER' as const, locale: 'pt-BR' as const,
      })),
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'DISABLED_BY_USER',
    });
    expect(dependencies.claimMilestone).not.toHaveBeenCalled();
    expect(dependencies.claimProductWindow).not.toHaveBeenCalled();
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('releases the daily slot if dispatcher preflight suppresses a now-stale fact', async () => {
    const dependencies = fixture({
      dispatchCandidate: vi.fn(async () => ({
        status: 'SUPPRESSED_BY_POLICY' as const, dispatchId: 'dispatch-stale',
      })),
    });
    await expect(evaluateWeeklyAchievementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'SUPPRESSED_BY_POLICY',
    });
    expect(dependencies.releaseProductWindow).toHaveBeenCalledWith({
      windowId: 'window-1', claimToken: 'window-claim',
    });
    expect(dependencies.completeProductWindow).not.toHaveBeenCalled();
  });
});
