import { describe, expect, it } from 'vitest';

import {
  assertValidDispatchRequest,
  BILLING_ISSUE_COPIES,
  buildBillingIssueNotification,
  buildEvolutionApproachingNotification,
  buildEvolutionUnlockedNotification,
  buildPremiumEndedNotification,
  buildProgramUpdatedNotification,
  buildWorkoutDayNotification,
  buildRecoveryDayNotification,
  buildMissedWorkoutNotification,
  buildQaTestNotification,
  buildQaPreviewNotification,
  buildReEngagementEarlyNotification,
  buildReEngagementLateNotification,
  EVOLUTION_UNLOCKED_COPIES,
  EVOLUTION_APPROACHING_COPIES,
  NOTIFICATION_LOCALES,
  NotificationContentPolicyError,
  PREMIUM_ENDED_COPIES,
  PROGRAM_UPDATED_COPIES,
  WORKOUT_DAY_COPIES,
  RECOVERY_DAY_COPIES,
  MISSED_WORKOUT_COPIES,
  RE_ENGAGEMENT_EARLY_COPIES,
  RE_ENGAGEMENT_LATE_COPIES,
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

  it('exposes only QA and implemented product builders', async () => {
    const module = await import('../contentPolicy');
    expect(Object.keys(module).filter((key) => key.startsWith('build')).sort()).toEqual([
      'buildBillingIssueNotification',
      'buildEvolutionApproachingNotification',
      'buildEvolutionUnlockedNotification',
      'buildPremiumEndedNotification',
      'buildProgramUpdatedNotification',
      'buildQaTestNotification',
      'buildQaPreviewNotification',
      'buildReEngagementEarlyNotification',
      'buildReEngagementLateNotification',
      'buildWorkoutDayNotification',
      'buildRecoveryDayNotification',
      'buildMissedWorkoutNotification',
    ].sort());
  });

  it.each(NOTIFICATION_LOCALES)('QA preview delegates all localized copy to canonical builders in %s', (locale) => {
    const qaRequestId = '10000000-0000-4000-8000-000000000001';
    const previews = Object.fromEntries([
      'WORKOUT_DAY',
      'RECOVERY_DAY',
      'MISSED_WORKOUT',
      'EVOLUTION_UNLOCKED',
      'PROGRAM_UPDATED',
      'EVOLUTION_APPROACHING',
      'BILLING_ISSUE',
      'PREMIUM_ENDED',
      'RE_ENGAGEMENT_EARLY',
      'RE_ENGAGEMENT_LATE',
    ].map((type) => [type, buildQaPreviewNotification({
      uid: 'user-123', type: type as never, qaRequestId, locale,
    })]));

    expect(previews.WORKOUT_DAY).toMatchObject(WORKOUT_DAY_COPIES[locale]);
    expect(previews.RECOVERY_DAY).toMatchObject(RECOVERY_DAY_COPIES[locale]);
    expect(previews.MISSED_WORKOUT).toMatchObject(MISSED_WORKOUT_COPIES[locale]);
    expect(previews.EVOLUTION_UNLOCKED).toMatchObject(EVOLUTION_UNLOCKED_COPIES.EVOLUTION[locale]);
    expect(previews.PROGRAM_UPDATED).toMatchObject(PROGRAM_UPDATED_COPIES[locale]);
    expect(previews.EVOLUTION_APPROACHING).toMatchObject(EVOLUTION_APPROACHING_COPIES[locale]);
    expect(previews.BILLING_ISSUE).toMatchObject(BILLING_ISSUE_COPIES[locale]);
    expect(previews.PREMIUM_ENDED).toMatchObject(PREMIUM_ENDED_COPIES[locale]);
    expect(previews.RE_ENGAGEMENT_EARLY).toMatchObject(RE_ENGAGEMENT_EARLY_COPIES[locale]);
    expect(previews.RE_ENGAGEMENT_LATE).toMatchObject(RE_ENGAGEMENT_LATE_COPIES[locale]);
    for (const preview of Object.values(previews)) {
      expect(preview.data).toEqual({});
      expect(preview.intent).toBeUndefined();
      expect(preview.idempotencyKey).toContain('qa-preview:user-123:');
      expect(() => assertValidDispatchRequest(preview)).not.toThrow();
    }
  });

  it('uses a new QA identity per click and a stable identity for a retry of that click', () => {
    const base = {
      uid: 'user-123', type: 'PROGRAM_UPDATED' as const, locale: 'pt-BR' as const,
    };
    const first = buildQaPreviewNotification({
      ...base, qaRequestId: '10000000-0000-4000-8000-000000000001',
    });
    const retry = buildQaPreviewNotification({
      ...base, qaRequestId: '10000000-0000-4000-8000-000000000001',
    });
    const nextClick = buildQaPreviewNotification({
      ...base, qaRequestId: '10000000-0000-4000-8000-000000000002',
    });
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.notificationId).toBe(first.notificationId);
    expect(nextClick.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(nextClick.notificationId).not.toBe(first.notificationId);
  });

  it.each(NOTIFICATION_LOCALES)('accepts every Phase-2 builder in %s', (locale) => {
    const requests = [
      buildEvolutionUnlockedNotification({
        uid: 'user-123', lifecycleEventId: 'event-earned', locale, variant: 'EVOLUTION',
      }),
      buildEvolutionApproachingNotification({
        uid: 'user-123', progressionWindowId: 'instance-1', locale,
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
      buildReEngagementEarlyNotification({
        uid: 'user-123', episodeIdentity: 'instance:2026-09-05', locale,
      }),
      buildReEngagementLateNotification({
        uid: 'user-123', episodeIdentity: 'instance:2026-09-05', locale,
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
    expect(buildEvolutionApproachingNotification({
      uid: 'user-123', progressionWindowId: 'instance-1', locale,
    })).toMatchObject(EVOLUTION_APPROACHING_COPIES[locale]);
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
    expect(buildReEngagementEarlyNotification({
      uid: 'user-123', episodeIdentity: 'instance:2026-09-05', locale,
    })).toMatchObject(RE_ENGAGEMENT_EARLY_COPIES[locale]);
    expect(buildReEngagementLateNotification({
      uid: 'user-123', episodeIdentity: 'instance:2026-09-05', locale,
    })).toMatchObject(RE_ENGAGEMENT_LATE_COPIES[locale]);
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

  it('binds EVOLUTION_APPROACHING to uid, type and a hashed progression cycle', () => {
    const first = buildEvolutionApproachingNotification({
      uid: 'user-123', progressionWindowId: 'instance.private-id', locale: 'pt-BR',
    });
    const replayInEnglish = buildEvolutionApproachingNotification({
      uid: 'user-123', progressionWindowId: 'instance.private-id', locale: 'en',
    });
    const nextCycle = buildEvolutionApproachingNotification({
      uid: 'user-123', progressionWindowId: 'instance-2', locale: 'pt-BR',
    });
    expect(replayInEnglish.idempotencyKey).toBe(first.idempotencyKey);
    expect(nextCycle.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(first.sourceIdentity).not.toContain('instance.private-id');
    expect(first.data).toEqual({});
    expect(first.intent).toBeUndefined();
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
