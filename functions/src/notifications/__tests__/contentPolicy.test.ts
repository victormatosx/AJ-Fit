import { describe, expect, it } from 'vitest';

import {
  assertValidDispatchRequest,
  buildQaTestNotification,
  NotificationContentPolicyError,
} from '../contentPolicy';
import type { NotificationDispatchRequest } from '../schema';

function request(): NotificationDispatchRequest {
  return buildQaTestNotification({
    uid: 'user-123',
    notificationId: 'qa-test-1',
    sourceIdentity: 'qa-probe:user-123:1',
    idempotencyKey: 'qa-test:user-123:1',
  });
}

describe('notification content policy', () => {
  it('accepts the fixed QA builder', () => {
    expect(() => assertValidDispatchRequest(request())).not.toThrow();
  });

  it.each([
    'WORKOUT_DAY',
    'MISSED_WORKOUT',
    'EVOLUTION_UNLOCKED',
    'BILLING_ISSUE',
    'PREMIUM_ENDED',
  ])('rejects product type %s during foundation phase', (type) => {
    expect(() => assertValidDispatchRequest({ ...request(), type } as NotificationDispatchRequest))
      .toThrow(NotificationContentPolicyError);
  });

  it('rejects a category that is not bound to the type', () => {
    expect(() => assertValidDispatchRequest({
      ...request(),
      category: 'PROGRESS',
    })).toThrow(/category_mismatch/);
  });

  it.each([
    { data: { weight: 80 } },
    { data: { email: 'a@example.com' } },
    { data: { value: Number.NaN } },
    { data: { value: Number.POSITIVE_INFINITY } },
    { data: { nested: { secret: true } } },
  ])('rejects non-allowlisted or unsafe data %#', (override) => {
    expect(() => assertValidDispatchRequest({
      ...request(),
      ...override,
    } as unknown as NotificationDispatchRequest)).toThrow(NotificationContentPolicyError);
  });

  it.each([
    { title: 'Arbitrary title' },
    { body: 'Arbitrary body' },
    { data: { harmless: true } },
  ])('rejects arbitrary QA content even when the technical type is valid %#', (override) => {
    expect(() => assertValidDispatchRequest({
      ...request(),
      ...override,
    })).toThrow(NotificationContentPolicyError);
  });

  it('does not expose product builders', async () => {
    const module = await import('../contentPolicy');
    expect(Object.keys(module).filter((key) => key.startsWith('build'))).toEqual([
      'buildQaTestNotification',
    ]);
  });
});
