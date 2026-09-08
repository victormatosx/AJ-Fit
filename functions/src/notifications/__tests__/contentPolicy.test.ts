import { describe, expect, it } from 'vitest';

import {
  assertValidDispatchRequest,
  BILLING_ISSUE_COPIES,
  buildBillingIssueNotification,
  buildEvolutionUnlockedNotification,
  buildPremiumEndedNotification,
  buildProgramUpdatedNotification,
  buildWorkoutDayNotification,
  buildRecoveryDayNotification,
  buildMissedWorkoutNotification,
  buildQaTestNotification,
  EVOLUTION_UNLOCKED_COPIES,
  NOTIFICATION_LOCALES,
  NotificationContentPolicyError,
  PREMIUM_ENDED_COPIES,
  PROGRAM_UPDATED_COPIES,
  WORKOUT_DAY_COPIES,
  RECOVERY_DAY_COPIES,
  MISSED_WORKOUT_COPIES,
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
    'RE_ENGAGEMENT_EARLY',
    'RE_ENGAGEMENT_LATE',
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

  it('exposes only QA and the Phase-2/Phase-3 product builders', async () => {
    const module = await import('../contentPolicy');
    expect(Object.keys(module).filter((key) => key.startsWith('build')).sort()).toEqual([
      'buildBillingIssueNotification',
      'buildEvolutionUnlockedNotification',
      'buildPremiumEndedNotification',
      'buildProgramUpdatedNotification',
      'buildQaTestNotification',
      'buildWorkoutDayNotification',
      'buildRecoveryDayNotification',
      'buildMissedWorkoutNotification',
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
      buildWorkoutDayNotification({ uid: 'user-123', localDate: '2026-09-07', locale }),
      buildRecoveryDayNotification({ uid: 'user-123', localDate: '2026-09-07', locale }),
      buildMissedWorkoutNotification({
        uid: 'user-123', plannedSessionIdentity: 'instance:2026-09-05:1', locale,
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
    expect(buildWorkoutDayNotification({
      uid: 'user-123', localDate: '2026-09-07', locale,
    })).toMatchObject(WORKOUT_DAY_COPIES[locale]);
    expect(buildRecoveryDayNotification({
      uid: 'user-123', localDate: '2026-09-07', locale,
    })).toMatchObject(RECOVERY_DAY_COPIES[locale]);
    expect(buildMissedWorkoutNotification({
      uid: 'user-123', plannedSessionIdentity: 'instance:2026-09-05:1', locale,
    })).toMatchObject(MISSED_WORKOUT_COPIES[locale]);
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

  it('binds daily idempotency to type/date and missed idempotency to the planned session', () => {
    const workout = buildWorkoutDayNotification({
      uid: 'user-123', localDate: '2026-09-07', locale: 'pt-BR',
    });
    const workoutReplay = buildWorkoutDayNotification({
      uid: 'user-123', localDate: '2026-09-07', locale: 'en',
    });
    const recovery = buildRecoveryDayNotification({
      uid: 'user-123', localDate: '2026-09-07', locale: 'pt-BR',
    });
    const missed = buildMissedWorkoutNotification({
      uid: 'user-123', plannedSessionIdentity: 'wpi-1:2026-09-05:0', locale: 'pt-BR',
    });
    const anotherMiss = buildMissedWorkoutNotification({
      uid: 'user-123', plannedSessionIdentity: 'wpi-1:2026-09-05:1', locale: 'pt-BR',
    });

    expect(workoutReplay.idempotencyKey).toBe(workout.idempotencyKey);
    expect(recovery.idempotencyKey).not.toBe(workout.idempotencyKey);
    expect(anotherMiss.idempotencyKey).not.toBe(missed.idempotencyKey);
    expect(missed.sourceIdentity).not.toContain('wpi-1');
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
