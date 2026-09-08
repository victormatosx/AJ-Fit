import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBillingIssueNotification,
  buildEvolutionUnlockedNotification,
  buildMissedWorkoutNotification,
  buildProgramUpdatedNotification,
  buildRecoveryDayNotification,
  buildWorkoutDayNotification,
} from '../contentPolicy';
import { dispatchUserNotificationCandidate } from '../userNotificationDispatch';

const mocks = vi.hoisted(() => ({
  dispatchNotification: vi.fn(),
  claimDispatch: vi.fn(),
  markDispatchOutcome: vi.fn(),
}));

vi.mock('../dispatcher', async (importOriginal) => ({
  ...await importOriginal<typeof import('../dispatcher')>(),
  dispatchNotification: mocks.dispatchNotification,
}));
vi.mock('../idempotency', async (importOriginal) => ({
  ...await importOriginal<typeof import('../idempotency')>(),
  claimDispatch: mocks.claimDispatch,
  markDispatchOutcome: mocks.markDispatchOutcome,
}));

function firestoreFixture(user: Record<string, unknown>, deletionLocked = false) {
  return {
    collection(name: string) {
      return {
        doc() {
          return {
            async get() {
              return name === 'users'
                ? { exists: true, data: () => user }
                : { exists: deletionLocked, data: () => undefined };
            },
          };
        },
      };
    },
  };
}

function dependencies(user: Record<string, unknown>) {
  return {
    db: firestoreFixture(user),
    expoClient: {},
    now: () => Timestamp.fromMillis(2_000_000_000_000),
  } as never;
}

function candidate(category: 'EVOLUTION_AND_ACHIEVEMENTS' | 'OPERATIONAL') {
  return {
    uid: 'uid-1',
    category,
    build: (locale: 'pt-BR' | 'en' | 'es') => buildEvolutionUnlockedNotification({
      uid: 'uid-1', lifecycleEventId: 'event-1', locale, variant: 'EVOLUTION',
    }),
  };
}

describe('event-driven notification policy orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchNotification.mockResolvedValue({
      status: 'PENDING_RECEIPTS', dispatchId: 'dispatch-1', deviceCount: 1, acceptedCount: 1,
    });
    mocks.claimDispatch.mockResolvedValue({
      outcome: 'CLAIMED', dispatchId: 'dispatch-1', attemptCount: 1, claimToken: 'claim-1',
    });
    mocks.markDispatchOutcome.mockResolvedValue(true);
  });

  it('dispatches an enabled product category with the stored locale', async () => {
    const outcome = await dispatchUserNotificationCandidate(
      candidate('EVOLUTION_AND_ACHIEVEMENTS'),
      dependencies({ preferences: { language: 'en' } }),
    );

    expect(outcome.status).toBe('PENDING_RECEIPTS');
    expect(mocks.dispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVOLUTION_UNLOCKED',
        category: 'EVOLUTION_AND_ACHIEVEMENTS',
        title: 'You leveled up! 🚀',
      }),
      expect.any(Object),
    );
  });

  it('persists suppression when the product preference is disabled', async () => {
    const outcome = await dispatchUserNotificationCandidate(
      candidate('EVOLUTION_AND_ACHIEVEMENTS'),
      dependencies({
        preferences: {
          language: 'pt-BR',
          notificationPreferences: { evolutionAndAchievements: false },
        },
      }),
    );

    expect(outcome).toEqual({ status: 'SUPPRESSED_BY_PREFERENCE', dispatchId: 'dispatch-1' });
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
    expect(mocks.markDispatchOutcome).toHaveBeenCalledWith(
      expect.anything(),
      'dispatch-1',
      'claim-1',
      { status: 'SUPPRESSED_BY_PREFERENCE', terminalReason: 'DISABLED_BY_USER' },
      expect.any(Timestamp),
    );
  });

  it('does not let the three product toggles disable OPERATIONAL policy', async () => {
    const outcome = await dispatchUserNotificationCandidate(
      {
        uid: 'uid-1',
        category: 'OPERATIONAL',
        build: (locale) => buildBillingIssueNotification({
          uid: 'uid-1', revenueCatEventId: 'billing-1', locale,
        }),
      },
      dependencies({
        preferences: {
          notificationPreferences: {
            workoutsAndReminders: false,
            evolutionAndAchievements: false,
            progress: false,
          },
        },
      }),
    );

    expect(outcome.status).toBe('PENDING_RECEIPTS');
    expect(mocks.dispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BILLING_ISSUE', category: 'OPERATIONAL' }),
      expect.any(Object),
    );
  });

  it('honors preference ON and OFF independently for PROGRAM_UPDATED', async () => {
    const programCandidate = {
      uid: 'uid-1',
      category: 'EVOLUTION_AND_ACHIEVEMENTS' as const,
      build: (locale: 'pt-BR' | 'en' | 'es') => buildProgramUpdatedNotification({
        uid: 'uid-1', lifecycleEventId: 'adapted-1', locale,
      }),
    };

    await expect(dispatchUserNotificationCandidate(
      programCandidate,
      dependencies({ preferences: { notificationPreferences: { evolutionAndAchievements: true } } }),
    )).resolves.toMatchObject({ status: 'PENDING_RECEIPTS' });
    expect(mocks.dispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PROGRAM_UPDATED' }),
      expect.any(Object),
    );

    mocks.dispatchNotification.mockClear();
    await expect(dispatchUserNotificationCandidate(
      programCandidate,
      dependencies({ preferences: { notificationPreferences: { evolutionAndAchievements: false } } }),
    )).resolves.toEqual({ status: 'SUPPRESSED_BY_PREFERENCE', dispatchId: 'dispatch-1' });
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['WORKOUT_DAY', (locale: 'pt-BR' | 'en' | 'es') => buildWorkoutDayNotification({
      uid: 'uid-1', localDate: '2026-09-07', locale,
    })],
    ['RECOVERY_DAY', (locale: 'pt-BR' | 'en' | 'es') => buildRecoveryDayNotification({
      uid: 'uid-1', localDate: '2026-09-07', locale,
    })],
    ['MISSED_WORKOUT', (locale: 'pt-BR' | 'en' | 'es') => buildMissedWorkoutNotification({
      uid: 'uid-1', plannedSessionIdentity: 'wpi-1:2026-09-05:0', locale,
    })],
  ] as const)('honors workoutsAndReminders ON/OFF for %s', async (_type, build) => {
    const workoutCandidate = {
      uid: 'uid-1',
      category: 'WORKOUTS_AND_REMINDERS' as const,
      build,
    };

    await expect(dispatchUserNotificationCandidate(
      workoutCandidate,
      dependencies({ preferences: { notificationPreferences: { workoutsAndReminders: true } } }),
    )).resolves.toMatchObject({ status: 'PENDING_RECEIPTS' });

    mocks.dispatchNotification.mockClear();
    await expect(dispatchUserNotificationCandidate(
      workoutCandidate,
      dependencies({ preferences: { notificationPreferences: { workoutsAndReminders: false } } }),
    )).resolves.toEqual({ status: 'SUPPRESSED_BY_PREFERENCE', dispatchId: 'dispatch-1' });
    expect(mocks.dispatchNotification).not.toHaveBeenCalled();
  });
});
