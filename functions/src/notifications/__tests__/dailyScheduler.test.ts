import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import { runDailyWorkoutNotificationScheduler } from '../dailyScheduler';

const NOW = Timestamp.fromDate(new Date('2026-09-07T08:00:00.000Z'));

function fixture(overrides: Record<string, unknown> = {}) {
  const harness = createFakeFirestore();
  let uuid = 0;
  const dependencies = {
    db: harness.db,
    now: () => NOW,
    evaluate: vi.fn(async () => ({
      status: 'SUPPRESSED' as const,
      reason: 'REST_DAY',
      timezone: 'UTC',
      localDate: '2026-09-07',
    })),
    randomUUID: () => `claim-${++uuid}`,
    ...overrides,
  };
  return { harness, dependencies };
}

function dueRegistration(harness: ReturnType<typeof createFakeFirestore>, uid: string, expireAt: Timestamp) {
  harness.seed(`notificationDailyUsers/${uid}`, {
    timezone: 'UTC',
    nextEvaluationAt: NOW,
    expireAt,
    schemaVersion: 1,
  });
}

describe('daily workout notification scheduler', () => {
  it('claims a due registration once and advances it to the next local window', async () => {
    const { harness, dependencies } = fixture();
    harness.seed('users/uid-1');
    dueRegistration(harness, 'uid-1', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await expect(runDailyWorkoutNotificationScheduler(dependencies as never)).resolves.toMatchObject({
      candidates: 1,
      claimed: 1,
      processed: 1,
      eligible: 0,
      suppressed: 1,
      failed: 0,
      capacityExhausted: false,
    });
    expect(dependencies.evaluate).toHaveBeenCalledOnce();
    expect((harness.data('notificationDailyUsers/uid-1')?.nextEvaluationAt as Timestamp).toDate().toISOString())
      .toBe('2026-09-08T08:00:00.000Z');
    expect(harness.data('notificationDailyUsers/uid-1')?.evaluationClaimToken).toBeNull();
  });

  it('deletes a missing user registration from a structured terminal condition', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'USER_NOT_FOUND',
        terminalCondition: 'USER_NOT_FOUND' as const,
      })),
    });
    dueRegistration(harness, 'uid-missing', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await expect(runDailyWorkoutNotificationScheduler(dependencies as never)).resolves.toMatchObject({
      candidates: 1, claimed: 1, processed: 1, suppressed: 1,
    });
    expect(harness.exists('notificationDailyUsers/uid-missing')).toBe(false);
  });

  it('deletes a missing user registration without parsing its composed diagnostic reason', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'REENGAGEMENT:USER_NOT_FOUND|WORKOUT:USER_NOT_FOUND',
        terminalCondition: 'USER_NOT_FOUND' as const,
      })),
    });
    dueRegistration(harness, 'uid-composed', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await runDailyWorkoutNotificationScheduler(dependencies as never);

    expect(harness.exists('notificationDailyUsers/uid-composed')).toBe(false);
  });

  it('keeps a valid user registration even if an evaluator emits a stale terminal condition', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'REENGAGEMENT:USER_NOT_FOUND',
        terminalCondition: 'USER_NOT_FOUND' as const,
        timezone: 'UTC',
        localDate: '2026-09-07',
      })),
    });
    harness.seed('users/uid-valid');
    dueRegistration(harness, 'uid-valid', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));
    expect(harness.exists('users/uid-valid')).toBe(true);

    await runDailyWorkoutNotificationScheduler(dependencies as never);

    expect(harness.exists('users/uid-valid')).toBe(true);
    expect(harness.exists('notificationDailyUsers/uid-valid')).toBe(true);
    expect(harness.data('notificationDailyUsers/uid-valid')?.evaluationClaimToken).toBeNull();
  });

  it('does not infer cleanup from a diagnostic reason without the structured condition', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'REENGAGEMENT:USER_NOT_FOUND|WORKOUT:USER_NOT_FOUND',
        timezone: 'UTC',
        localDate: '2026-09-07',
      })),
    });
    dueRegistration(harness, 'uid-diagnostic-only', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await runDailyWorkoutNotificationScheduler(dependencies as never);

    expect(harness.exists('notificationDailyUsers/uid-diagnostic-only')).toBe(true);
  });

  it('deletes a registration whose foreground-sync retention has expired', async () => {
    const { harness, dependencies } = fixture();
    dueRegistration(harness, 'uid-expired', Timestamp.fromMillis(NOW.toMillis() - 1));

    await expect(runDailyWorkoutNotificationScheduler(dependencies as never)).resolves.toMatchObject({
      candidates: 1, claimed: 0, expired: 1, processed: 0,
    });
    expect(harness.exists('notificationDailyUsers/uid-expired')).toBe(false);
    expect(dependencies.evaluate).not.toHaveBeenCalled();
  });

  it('releases a failed evaluation to a bounded retry deadline', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => { throw new Error('temporary outage'); }),
    });
    dueRegistration(harness, 'uid-retry', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await expect(runDailyWorkoutNotificationScheduler(dependencies as never)).resolves.toMatchObject({
      candidates: 1, claimed: 1, failed: 1, processed: 0,
    });
    expect((harness.data('notificationDailyUsers/uid-retry')?.nextEvaluationAt as Timestamp).toMillis())
      .toBe(NOW.toMillis() + 45 * 60 * 1000);
    expect(harness.exists('notificationDailyUsers/uid-retry')).toBe(true);
  });

  it('preserves the registration when authoritative user verification fails transiently', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'USER_NOT_FOUND',
        terminalCondition: 'USER_NOT_FOUND' as const,
      })),
    });
    dueRegistration(harness, 'uid-lookup-retry', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));
    const originalDb = dependencies.db;
    dependencies.db = {
      ...originalDb,
      runTransaction: async (operation: never) => originalDb.runTransaction(async (transaction) => {
        const guardedTransaction = {
          ...transaction,
          get: async (reference: { path?: string }) => {
            if (reference.path === 'users/uid-lookup-retry') throw new Error('temporary user lookup outage');
            return transaction.get(reference as never);
          },
        };
        return (operation as (value: typeof guardedTransaction) => Promise<unknown>)(guardedTransaction);
      }),
    } as typeof dependencies.db;

    await expect(runDailyWorkoutNotificationScheduler(dependencies as never))
      .rejects.toThrow('temporary user lookup outage');
    expect(harness.exists('notificationDailyUsers/uid-lookup-retry')).toBe(true);
  });

  it('is idempotent when the scheduler runs again after orphan cleanup', async () => {
    const { harness, dependencies } = fixture({
      evaluate: vi.fn(async () => ({
        status: 'SUPPRESSED' as const,
        reason: 'USER_NOT_FOUND',
        terminalCondition: 'USER_NOT_FOUND' as const,
      })),
    });
    dueRegistration(harness, 'uid-cleaned', Timestamp.fromMillis(NOW.toMillis() + 86_400_000));

    await runDailyWorkoutNotificationScheduler(dependencies as never);
    await expect(runDailyWorkoutNotificationScheduler(dependencies as never)).resolves.toMatchObject({
      candidates: 0, claimed: 0, processed: 0,
    });
    expect(harness.exists('notificationDailyUsers/uid-cleaned')).toBe(false);
  });
});
