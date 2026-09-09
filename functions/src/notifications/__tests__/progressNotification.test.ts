import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationDispatchRequest } from '../schema';
import {
  evaluateProgressNotification,
  type ProgressNotificationDependencies,
} from '../progressNotification';

const NOW = Timestamp.fromDate(new Date('2026-09-09T08:30:00Z'));

function accepted() {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId: 'dispatch-1',
    deviceCount: 1,
    acceptedCount: 1,
  };
}

function fixture(overrides: Partial<ProgressNotificationDependencies> = {}) {
  const requests: NotificationDispatchRequest[] = [];
  const dependencies: ProgressNotificationDependencies = {
    now: () => NOW,
    readContext: vi.fn(async () => ({
      allowed: true as const,
      candidates: [
        { notificationType: 'COMPARE_PROGRESS' as const, progressIdentity: 'photoComparison:2026-07-01:2026-09-01' },
        { notificationType: 'PHOTO_REMINDER' as const, progressIdentity: 'photoCycle:2026-01-01:2026-01-31' },
      ],
      timezone: 'UTC',
      localDate: '2026-09-09',
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

describe('progress notification evaluator', () => {
  it('dispatches the highest-value candidate through the canonical PROGRESS policy', async () => {
    const { dependencies, requests } = fixture();
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'COMPARE_PROGRESS',
    });
    expect(requests[0]).toMatchObject({ type: 'COMPARE_PROGRESS', category: 'PROGRESS', data: {} });
    expect(dependencies.completeMilestone).toHaveBeenCalledTimes(1);
    expect(dependencies.completeProductWindow).toHaveBeenCalledTimes(1);
  });

  it('skips an already-sent comparison and can send the next new milestone', async () => {
    const claimMilestone = vi.fn()
      .mockResolvedValueOnce({ outcome: 'DUPLICATE', milestoneId: 'old' })
      .mockResolvedValueOnce({ outcome: 'CLAIMED', milestoneId: 'new', claimToken: 'claim' });
    const { dependencies, requests } = fixture({ claimMilestone });
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'PHOTO_REMINDER',
    });
    expect(requests[0]?.type).toBe('PHOTO_REMINDER');
  });

  it('keeps preference handling inside the normal dispatcher path', async () => {
    const { dependencies } = fixture({
      dispatchCandidate: vi.fn(async () => ({
        status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed',
      })),
    });
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', outcome: 'SUPPRESSED_BY_PREFERENCE',
    });
    expect(dependencies.dispatchCandidate).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PROGRESS',
    }));
  });

  it('does not duplicate a milestone on scheduler replay', async () => {
    const { dependencies } = fixture({
      claimMilestone: vi.fn(async () => ({ outcome: 'DUPLICATE' as const, milestoneId: 'same' })),
    });
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'MILESTONE_DUPLICATE',
    });
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('releases the milestone if another product notification owns the local day', async () => {
    const { dependencies } = fixture({
      claimProductWindow: vi.fn(async () => ({ outcome: 'RATE_LIMITED' as const, windowId: 'day' })),
    });
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'PRODUCT_RATE_LIMIT',
    });
    expect(dependencies.releaseMilestone).toHaveBeenCalledTimes(1);
    expect(dependencies.dispatchCandidate).not.toHaveBeenCalled();
  });

  it('fences two concurrent schedulers before dispatch', async () => {
    let claimed = false;
    const dispatchCandidate = vi.fn(async () => accepted());
    const claimMilestone = vi.fn(async () => {
      if (claimed) return { outcome: 'DUPLICATE' as const, milestoneId: 'same' };
      claimed = true;
      return { outcome: 'CLAIMED' as const, milestoneId: 'same', claimToken: 'claim' };
    });
    const first = fixture({ claimMilestone, dispatchCandidate });
    const second = fixture({ claimMilestone, dispatchCandidate });
    const results = await Promise.all([
      evaluateProgressNotification('uid-1', first.dependencies),
      evaluateProgressNotification('uid-1', second.dependencies),
    ]);
    expect(dispatchCandidate).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(['DISPATCHED', 'SUPPRESSED']);
  });

  it('releases a failed claim so retry can attempt the same fact', async () => {
    const { dependencies } = fixture({
      dispatchCandidate: vi.fn(async () => { throw new Error('temporary'); }),
    });
    await expect(evaluateProgressNotification('uid-1', dependencies)).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(dependencies.releaseMilestone).toHaveBeenCalledTimes(1);
  });
});
