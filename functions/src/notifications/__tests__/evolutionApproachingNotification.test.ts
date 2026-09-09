import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  claimAchievementMilestone,
  completeAchievementMilestone,
  releaseAchievementMilestoneClaim,
} from '../achievementMilestones';
import { evaluateEvolutionApproaching } from '../evolutionApproachingNotification';
import type { NotificationDispatchRequest } from '../schema';

const NOW = Timestamp.fromDate(new Date('2026-09-08T11:30:00.000Z'));
const READY = {
  allowed: true as const,
  progressionWindowId: 'instance-1',
  sourceIdentity: 'progressionWindow:expected-hash',
  timezone: 'America/Sao_Paulo',
  localDate: '2026-09-08',
};

function fixture() {
  const harness = createFakeFirestore();
  const dispatchCandidate = vi.fn(async (candidate) => {
    const request = candidate.build('en');
    expect(request.title).toBe('Your next evolution is getting closer 🚀');
    return { status: 'NO_ELIGIBLE_DEVICE' as const, dispatchId: 'dispatch-1' };
  });
  const complete = vi.fn((input, now) => completeAchievementMilestone(
    harness.db as never, input, now,
  ));
  const releaseMilestone = vi.fn((input) => releaseAchievementMilestoneClaim(
    harness.db as never, input,
  ));
  const claimProductWindow = vi.fn(async () => ({
    outcome: 'CLAIMED' as const, windowId: 'window-1', claimToken: 'window-claim',
  }));
  const completeProductWindow = vi.fn(async () => true);
  const releaseProductWindow = vi.fn(async () => true);
  return {
    harness,
    dispatchCandidate,
    complete,
    dependencies: {
      now: () => NOW,
      readContext: vi.fn(async () => READY),
      claim: (request: NotificationDispatchRequest, now: Timestamp) =>
        claimAchievementMilestone(harness.db as never, request, now),
      complete,
      releaseMilestone,
      claimProductWindow,
      completeProductWindow,
      releaseProductWindow,
      resolvePolicy: vi.fn(async () => ({ allowed: true, reason: 'ALLOWED' })),
      dispatchCandidate,
    },
  };
}

describe('EVOLUTION_APPROACHING observer', () => {
  it('creates exactly one localized candidate per progression window and deduplicates replay', async () => {
    const { dependencies, dispatchCandidate, complete } = fixture();
    const first = await evaluateEvolutionApproaching('uid-1', dependencies);
    const replay = await evaluateEvolutionApproaching('uid-1', dependencies);

    expect(first).toMatchObject({
      status: 'DISPATCHED', notificationType: 'EVOLUTION_APPROACHING',
      outcome: 'NO_ELIGIBLE_DEVICE', timezone: READY.timezone, localDate: READY.localDate,
    });
    expect(replay).toMatchObject({ status: 'SUPPRESSED', reason: 'MILESTONE_DUPLICATE' });
    expect(dispatchCandidate).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    'OUTSIDE_APPROACHING_WINDOW',
    'PENDING_EVOLUTION',
    'EVOLUTION_ALREADY_EARNED_OR_OFFERED',
    'QA_POLICY',
    'TIMEZONE_UNAVAILABLE',
  ])('suppresses %s without claiming or dispatching', async (reason) => {
    const { dependencies, dispatchCandidate } = fixture();
    const claim = vi.fn();
    const result = await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      readContext: vi.fn(async () => ({ allowed: false as const, reason })),
      claim,
    });
    expect(result).toMatchObject({ status: 'SUPPRESSED', reason });
    expect(claim).not.toHaveBeenCalled();
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('never claims a milestone or the daily slot when the category is disabled', async () => {
    const { dependencies, dispatchCandidate } = fixture();
    const claim = vi.fn();
    const result = await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      claim,
      resolvePolicy: vi.fn(async () => ({ allowed: false, reason: 'DISABLED_BY_USER' })),
    });
    expect(result).toMatchObject({ status: 'SUPPRESSED', reason: 'DISABLED_BY_USER' });
    expect(claim).not.toHaveBeenCalled();
    expect(dependencies.claimProductWindow).not.toHaveBeenCalled();
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('persists a preference suppression as the cycle outcome and frees the day', async () => {
    const { dependencies, complete } = fixture();
    const result = await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      dispatchCandidate: vi.fn(async () => ({
        status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'dispatch-pref',
      })),
    });
    expect(result).toMatchObject({ status: 'SUPPRESSED', reason: 'SUPPRESSED_BY_PREFERENCE' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'SUPPRESSED_BY_PREFERENCE',
    }), NOW);
    expect(dependencies.releaseProductWindow).toHaveBeenCalledWith({
      windowId: 'window-1', claimToken: 'window-claim',
    });
    expect(dependencies.completeProductWindow).not.toHaveBeenCalled();
  });

  it('releases the milestone when another product notification already owns the day', async () => {
    const { dependencies, dispatchCandidate } = fixture();
    const result = await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      claimProductWindow: vi.fn(async () => ({
        outcome: 'RATE_LIMITED' as const, windowId: 'window-1',
      })),
    });
    expect(result).toMatchObject({ status: 'SUPPRESSED', reason: 'PRODUCT_RATE_LIMIT' });
    expect(dispatchCandidate).not.toHaveBeenCalled();
    expect(dependencies.releaseMilestone).toHaveBeenCalledTimes(1);

    // The released milestone must stay claimable on a later day.
    const retry = await evaluateEvolutionApproaching('uid-1', dependencies);
    expect(retry).toMatchObject({ status: 'DISPATCHED' });
  });

  it('does not mark the milestone completed when dispatcher fails', async () => {
    const { dependencies, complete } = fixture();
    const result = await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      dispatchCandidate: vi.fn(async () => { throw new Error('provider unavailable'); }),
    });
    expect(result.status).toBe('FAILED');
    expect(complete).not.toHaveBeenCalled();
  });

  it('allows a new progression window after the prior window completed', async () => {
    const { dependencies, dispatchCandidate } = fixture();
    await evaluateEvolutionApproaching('uid-1', dependencies);
    await evaluateEvolutionApproaching('uid-1', {
      ...dependencies,
      readContext: vi.fn(async () => ({ ...READY, progressionWindowId: 'instance-2' })),
    });
    expect(dispatchCandidate).toHaveBeenCalledTimes(2);
  });
});
