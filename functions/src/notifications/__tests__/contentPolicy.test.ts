import { describe, expect, it } from 'vitest';

import {
  assertValidDispatchRequest,
  BILLING_ISSUE_COPIES,
  buildBillingIssueNotification,
  buildEvolutionUnlockedNotification,
  buildPremiumEndedNotification,
  buildProgramUpdatedNotification,
  buildQaTestNotification,
  EVOLUTION_UNLOCKED_COPIES,
  NOTIFICATION_LOCALES,
  NotificationContentPolicyError,
  PREMIUM_ENDED_COPIES,
  PROGRAM_UPDATED_COPIES,
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
    'RE_ENGAGEMENT_EARLY',
    'RE_ENGAGEMENT_LATE',
    'RECOVERY_DAY',
    'EVOLUTION_APPROACHING',
    'WEEK_COMPLETED',
    'WEEK_STREAK',
    'GOAL_PROXIMITY',
    'PHOTO_REMINDER',
    'ASSESSMENT_REMINDER',
    'COMPARE_PROGRESS',
  ])('rejects out-of-phase product type %s', (type) => {
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

  it('exposes only QA and the four Phase-2 product builders', async () => {
    const module = await import('../contentPolicy');
    expect(Object.keys(module).filter((key) => key.startsWith('build')).sort()).toEqual([
      'buildBillingIssueNotification',
      'buildEvolutionUnlockedNotification',
      'buildPremiumEndedNotification',
      'buildProgramUpdatedNotification',
      'buildQaTestNotification',
    ].sort());
  });

  it.each(NOTIFICATION_LOCALES)('accepts every Phase-2 builder in %s', (locale) => {
    const requests = [
      buildEvolutionUnlockedNotification({
        uid: 'user-123', lifecycleEventId: 'event-earned', locale, variant: 'EVOLUTION',
      }),
      buildEvolutionUnlockedNotification({
        uid: 'user-123', lifecycleEventId: 'event-renewal', locale, variant: 'MOTIVATIONAL_RENEWAL',
      }),
      buildProgramUpdatedNotification({
        uid: 'user-123', lifecycleEventId: 'event-adapted', locale,
      }),
      buildBillingIssueNotification({
        uid: 'user-123', revenueCatEventId: 'event-billing', locale,
      }),
      buildPremiumEndedNotification({
        uid: 'user-123', revenueCatEventId: 'event-expired', locale,
      }),
    ];
    for (const item of requests) expect(() => assertValidDispatchRequest(item)).not.toThrow();
  });

  it.each(NOTIFICATION_LOCALES)('uses the reviewed PT-BR/EN/ES copy in %s', (locale) => {
    expect(buildEvolutionUnlockedNotification({
      uid: 'user-123', lifecycleEventId: 'earned', locale, variant: 'EVOLUTION',
    })).toMatchObject(EVOLUTION_UNLOCKED_COPIES.EVOLUTION[locale]);
    expect(buildEvolutionUnlockedNotification({
      uid: 'user-123', lifecycleEventId: 'renewal', locale, variant: 'MOTIVATIONAL_RENEWAL',
    })).toMatchObject(EVOLUTION_UNLOCKED_COPIES.MOTIVATIONAL_RENEWAL[locale]);
    expect(buildProgramUpdatedNotification({
      uid: 'user-123', lifecycleEventId: 'adapted', locale,
    })).toMatchObject(PROGRAM_UPDATED_COPIES[locale]);
    expect(buildBillingIssueNotification({
      uid: 'user-123', revenueCatEventId: 'billing', locale,
    })).toMatchObject(BILLING_ISSUE_COPIES[locale]);
    expect(buildPremiumEndedNotification({
      uid: 'user-123', revenueCatEventId: 'expired', locale,
    })).toMatchObject(PREMIUM_ENDED_COPIES[locale]);
  });

  it('binds idempotency to uid, notification type and hashed source event identity', () => {
    const earned = buildEvolutionUnlockedNotification({
      uid: 'user-123', lifecycleEventId: 'event/with/provider-safe-hashing', locale: 'pt-BR', variant: 'EVOLUTION',
    });
    const replay = buildEvolutionUnlockedNotification({
      uid: 'user-123', lifecycleEventId: 'event/with/provider-safe-hashing', locale: 'pt-BR', variant: 'EVOLUTION',
    });
    const adapted = buildProgramUpdatedNotification({
      uid: 'user-123', lifecycleEventId: 'event/with/provider-safe-hashing', locale: 'pt-BR',
    });
    const anotherUser = buildEvolutionUnlockedNotification({
      uid: 'user-456', lifecycleEventId: 'event/with/provider-safe-hashing', locale: 'pt-BR', variant: 'EVOLUTION',
    });

    expect(replay.idempotencyKey).toBe(earned.idempotencyKey);
    expect(adapted.idempotencyKey).not.toBe(earned.idempotencyKey);
    expect(anotherUser.idempotencyKey).not.toBe(earned.idempotencyKey);
    expect(earned.sourceIdentity).not.toContain('event/with/provider-safe-hashing');
  });

  it('rejects a valid title paired with another allowed body', () => {
    const request = buildProgramUpdatedNotification({
      uid: 'user-123', lifecycleEventId: 'adapted', locale: 'pt-BR',
    });
    expect(() => assertValidDispatchRequest({
      ...request,
      body: PROGRAM_UPDATED_COPIES.en.body,
    })).toThrow(/copy_not_allowed/);
  });
});
