import { describe, expect, it, vi } from 'vitest';

import type { NotificationDispatchRequest } from '../schema';
import { dispatchWorkoutLifecycleNotification } from '../workoutLifecycleNotifications';

function accepted(dispatchId = 'dispatch-1') {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId,
    deviceCount: 1,
    acceptedCount: 1,
  };
}

describe('workout lifecycle product notifications', () => {
  it('maps EVOLUTION_EARNED to exactly one EVOLUTION_UNLOCKED candidate', async () => {
    let request: NotificationDispatchRequest | undefined;
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      request = candidate.build('pt-BR');
      return accepted();
    });

    await expect(dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'wle-earned-1', eventType: 'EVOLUTION_EARNED',
    }, { dispatchCandidate })).resolves.toMatchObject({ status: 'PENDING_RECEIPTS' });

    expect(dispatchCandidate).toHaveBeenCalledOnce();
    expect(request).toMatchObject({
      type: 'EVOLUTION_UNLOCKED',
      category: 'EVOLUTION_AND_ACHIEVEMENTS',
      data: {},
    });
  });

  it('keeps replay deterministic so the central dispatcher deduplicates it', async () => {
    const requests: NotificationDispatchRequest[] = [];
    const seen = new Set<string>();
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      const request = candidate.build('en');
      requests.push(request);
      if (seen.has(request.idempotencyKey)) {
        return { status: 'DUPLICATE' as const, dispatchId: 'same-dispatch' };
      }
      seen.add(request.idempotencyKey);
      return accepted('same-dispatch');
    });
    const input = { uid: 'uid-1', eventId: 'wle-earned-replay', eventType: 'EVOLUTION_EARNED' };

    const first = await dispatchWorkoutLifecycleNotification(input, { dispatchCandidate });
    const replay = await dispatchWorkoutLifecycleNotification(input, { dispatchCandidate });

    expect(first.status).toBe('PENDING_RECEIPTS');
    expect(replay.status).toBe('DUPLICATE');
    expect(requests[0]?.idempotencyKey).toBe(requests[1]?.idempotencyKey);
  });

  it('handles motivational renewal offer separately without claiming a new workout is ready', async () => {
    let request: NotificationDispatchRequest | undefined;
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      request = candidate.build('pt-BR');
      return accepted();
    });

    await dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'wle-renewal-1', eventType: 'MOTIVATIONAL_RENEWAL_OFFERED',
    }, { dispatchCandidate });

    expect(request).toMatchObject({ type: 'EVOLUTION_UNLOCKED' });
    expect(request?.title).toContain('renovação');
    expect(request?.body).not.toContain('pronto');
  });

  it.each([
    'EVOLUTION_ACTIVATED',
    'LEVEL_PROMOTED',
    'MOTIVATIONAL_RENEWAL_ACTIVATED',
  ])('never notifies again for %s', async (eventType) => {
    const dispatchCandidate = vi.fn();
    await expect(dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: `wle-${eventType}`, eventType,
    }, { dispatchCandidate })).resolves.toEqual({
      status: 'IGNORED', reason: 'EVENT_TYPE_NOT_ELIGIBLE',
    });
    expect(dispatchCandidate).not.toHaveBeenCalled();
  });

  it('maps only PROGRAM_ADAPTED to PROGRAM_UPDATED', async () => {
    let request: NotificationDispatchRequest | undefined;
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      request = candidate.build('es');
      return accepted();
    });

    await dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'wle-adapted-1', eventType: 'PROGRAM_ADAPTED',
    }, { dispatchCandidate });

    expect(request).toMatchObject({
      type: 'PROGRAM_UPDATED',
      category: 'EVOLUTION_AND_ACHIEVEMENTS',
      data: {},
    });
  });

  it.each([
    { outcome: { status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed' } },
    { outcome: { status: 'NO_ELIGIBLE_DEVICE' as const, dispatchId: 'no-device' } },
  ])('preserves a normal non-send outcome without failing lifecycle: $outcome.status', async ({ outcome }) => {
    const dispatchCandidate = vi.fn(async () => outcome);
    await expect(dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'wle-earned-2', eventType: 'EVOLUTION_EARNED',
    }, { dispatchCandidate })).resolves.toEqual(outcome);
  });

  it('absorbs dispatcher failure after the immutable lifecycle event exists', async () => {
    const dispatchCandidate = vi.fn(async () => { throw new Error('dispatcher unavailable'); });
    await expect(dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'wle-earned-3', eventType: 'EVOLUTION_EARNED',
    }, { dispatchCandidate })).resolves.toEqual({ status: 'FAILED' });
  });

  it('does not collide semantically distinct unlock and adaptation facts', async () => {
    const requests: NotificationDispatchRequest[] = [];
    const dispatchCandidate = vi.fn(async (candidate: Parameters<
      typeof import('../userNotificationDispatch').dispatchUserNotificationCandidate
    >[0]) => {
      requests.push(candidate.build('pt-BR'));
      return accepted(`dispatch-${requests.length}`);
    });

    await dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'same-flow-identity', eventType: 'EVOLUTION_EARNED',
    }, { dispatchCandidate });
    await dispatchWorkoutLifecycleNotification({
      uid: 'uid-1', eventId: 'same-flow-identity', eventType: 'PROGRAM_ADAPTED',
    }, { dispatchCandidate });

    expect(requests.map((request) => request.type)).toEqual([
      'EVOLUTION_UNLOCKED', 'PROGRAM_UPDATED',
    ]);
    expect(requests[0]?.idempotencyKey).not.toBe(requests[1]?.idempotencyKey);
  });
});
