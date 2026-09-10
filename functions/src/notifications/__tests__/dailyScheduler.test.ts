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
  });
});
