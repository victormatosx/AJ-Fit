import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationDispatchRequest } from '../schema';
import {
  evaluateReEngagementNotification,
  type ReEngagementDependencies,
} from '../reengagementNotification';

const NOW = Timestamp.fromDate(new Date('2026-09-14T08:30:00.000Z'));

function accepted() {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId: 'dispatch-1',
    deviceCount: 1,
    acceptedCount: 1,
  };
}

function fixture(overrides: Partial<ReEngagementDependencies> = {}) {
  const requests: NotificationDispatchRequest[] = [];
  const dependencies: ReEngagementDependencies = {
    now: () => NOW,
    readContext: vi.fn(async () => ({
      allowed: true as const,
      notificationType: 'RE_ENGAGEMENT_EARLY' as const,
      episodeIdentity: 'instance-1:2026-09-07',
      missedOpportunityCount: 3,
      timezone: 'UTC',
      localDate: '2026-09-14',
    })),
    claimMilestone: vi.fn(async () => ({
      outcome: 'CLAIMED' as const, milestoneId: 'milestone-1', claimToken: 'milestone-claim',
    })),
    completeMilestone: vi.fn(async () => true),
    releaseMilestone: vi.fn(async () => true),
    claimProductWindow: vi.fn(async () => ({
      outcome: 'CLAIMED' as const, windowId: 'window-1', claimToken: 'window-claim',
    })),
    completeProductWindow: vi.fn(async () => true),
    dispatchCandidate: vi.fn(async (candidate) => {
      requests.push(candidate.build('pt-BR'));
      return accepted();
    }),
    ...overrides,
  };
  return { dependencies, requests };
}

describe('workout re-engagement notification evaluator', () => {
  it('dispatches EARLY through the normal preference-aware dispatcher path', async () => {
    const { dependencies, requests } = fixture();
    await expect(evaluateReEngagementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'RE_ENGAGEMENT_EARLY',
    });
    expect(requests[0]).toMatchObject({
      type: 'RE_ENGAGEMENT_EARLY', category: 'WORKOUTS_AND_REMINDERS', data: {},
    });
    expect(dependencies.completeMilestone).toHaveBeenCalledTimes(1);
    expect(dependencies.completeProductWindow).toHaveBeenCalledTimes(1);
  });

  it('dispatches LATE directly when the late threshold is already reached', async () => {
    const { dependencies, requests } = fixture({
      readContext: vi.fn(async () => ({
        allowed: true as const,
        notificationType: 'RE_ENGAGEMENT_LATE' as const,
        episodeIdentity: 'instance-1:2026-09-01',
        missedOpportunityCount: 6,
        timezone: 'UTC',
        localDate: '2026-09-14',
      })),
    });
    await evaluateReEngagementNotification('uid-1', dependencies);
    expect(requests[0]?.type).toBe('RE_ENGAGEMENT_LATE');
  });

  it('respects workoutsAndReminders preference suppression and never bypasses dispatch policy', async () => {
    const dispatchCandidate = vi.fn(async () => ({
      status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed',
    }));
    const { dependencies } = fixture({ dispatchCandidate });
    await expect(evaluateReEngagementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', outcome: 'SUPPRESSED_BY_PREFERENCE',
    });
    expect(dispatchCandidate).toHaveBeenCalledWith(expect.objectContaining({
      category: 'WORKOUTS_AND_REMINDERS',
    }));
  });

  it('does not dispatch again when the stage milestone already exists', async () => {
    const { dependencies } = fixture({
      claimMilestone: vi.fn(async () => ({ outcome: 'DUPLICATE' as const, milestoneId: 'same' })),
    });
    await expect(evaluateReEngagementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'MILESTONE_DUPLICATE', blocksLowerPriorityNotifications: true,
    });
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('releases the stage claim when another workouts/reminders candidate already owns the day', async () => {
    const { dependencies } = fixture({
      claimProductWindow: vi.fn(async () => ({ outcome: 'RATE_LIMITED' as const, windowId: 'window' })),
    });
    await expect(evaluateReEngagementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'PRODUCT_RATE_LIMIT', blocksLowerPriorityNotifications: true,
    });
    expect(dependencies.releaseMilestone).toHaveBeenCalledWith({
      outcome: 'CLAIMED', milestoneId: 'milestone-1', claimToken: 'milestone-claim',
    });
  });

  it('does nothing after a return resolves the episode before LATE', async () => {
    const { dependencies } = fixture({
      readContext: vi.fn(async () => ({
        allowed: false as const,
        reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES',
        timezone: 'UTC',
        localDate: '2026-09-14',
      })),
    });
    await expect(evaluateReEngagementNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'INSUFFICIENT_MISSED_OPPORTUNITIES',
    });
    expect(dependencies.claimMilestone).not.toHaveBeenCalled();
  });

  it('fences concurrent scheduler evaluations before a duplicate dispatch', async () => {
    let claimed = false;
    const dispatchCandidate = vi.fn(async () => accepted());
    const claimMilestone = vi.fn(async () => {
      if (claimed) return { outcome: 'DUPLICATE' as const, milestoneId: 'milestone-1' };
      claimed = true;
      return {
        outcome: 'CLAIMED' as const, milestoneId: 'milestone-1', claimToken: 'claim-1',
      };
    });
    const first = fixture({ claimMilestone, dispatchCandidate });
    const second = fixture({ claimMilestone, dispatchCandidate });
    const results = await Promise.all([
      evaluateReEngagementNotification('uid-1', first.dependencies),
      evaluateReEngagementNotification('uid-1', second.dependencies),
    ]);
    expect(dispatchCandidate).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(['DISPATCHED', 'SUPPRESSED']);
  });

  it('releases a failed claim so the scheduler retry can try the same episode again', async () => {
    const dispatchCandidate = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(accepted());
    const first = fixture({ dispatchCandidate });
    await expect(evaluateReEngagementNotification('uid-1', first.dependencies))
      .resolves.toMatchObject({ status: 'FAILED' });
    expect(first.dependencies.releaseMilestone).toHaveBeenCalledTimes(1);

    const retry = fixture({ dispatchCandidate });
    await expect(evaluateReEngagementNotification('uid-1', retry.dependencies))
      .resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(dispatchCandidate).toHaveBeenCalledTimes(2);
  });
});
