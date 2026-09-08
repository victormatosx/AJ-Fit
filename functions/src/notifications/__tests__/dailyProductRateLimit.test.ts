import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import {
  buildMissedWorkoutNotification,
  buildWorkoutDayNotification,
} from '../contentPolicy';
import {
  claimDailyProductWindow,
  completeDailyProductWindow,
} from '../dailyProductRateLimit';

const UID = 'uid-1';
const DATE = '2026-09-07';
const NOW = Timestamp.fromMillis(2_000_000_000_000);

function db() {
  return createFakeFirestore().db as never;
}

describe('daily product rate limit', () => {
  it('deduplicates the same semantic candidate and completes only with the claim fence', async () => {
    const firestore = db();
    const input = {
      uid: UID,
      localDate: DATE,
      request: buildWorkoutDayNotification({ uid: UID, localDate: DATE, locale: 'pt-BR' }),
    };
    const first = await claimDailyProductWindow(firestore, input, NOW);
    const duplicate = await claimDailyProductWindow(firestore, input, NOW);

    expect(first.outcome).toBe('CLAIMED');
    expect(duplicate.outcome).toBe('DUPLICATE');
    if (first.outcome !== 'CLAIMED') throw new Error('expected claim');
    await expect(completeDailyProductWindow(firestore, {
      windowId: first.windowId,
      claimToken: 'wrong-token',
      outcome: 'PENDING_RECEIPTS',
    }, NOW)).resolves.toBe(false);
    await expect(completeDailyProductWindow(firestore, {
      windowId: first.windowId,
      claimToken: first.claimToken,
      outcome: 'PENDING_RECEIPTS',
    }, NOW)).resolves.toBe(true);
    await expect(claimDailyProductWindow(firestore, input, NOW)).resolves.toMatchObject({
      outcome: 'DUPLICATE',
    });
  });

  it('prevents MISSED_WORKOUT and WORKOUT_DAY from occupying the same user/day slot', async () => {
    const firestore = db();
    await claimDailyProductWindow(firestore, {
      uid: UID,
      localDate: DATE,
      request: buildMissedWorkoutNotification({
        uid: UID,
        plannedSessionIdentity: 'wpi-1:2026-09-05:0',
        locale: 'pt-BR',
      }),
    }, NOW);

    await expect(claimDailyProductWindow(firestore, {
      uid: UID,
      localDate: DATE,
      request: buildWorkoutDayNotification({ uid: UID, localDate: DATE, locale: 'pt-BR' }),
    }, NOW)).resolves.toMatchObject({ outcome: 'RATE_LIMITED' });
  });

  it('allows only the same semantic candidate to reclaim a stale worker', async () => {
    const firestore = db();
    const input = {
      uid: UID,
      localDate: DATE,
      request: buildWorkoutDayNotification({ uid: UID, localDate: DATE, locale: 'pt-BR' }),
    };
    const first = await claimDailyProductWindow(firestore, input, NOW);
    const later = Timestamp.fromMillis(NOW.toMillis() + 16 * 60 * 1000);
    const replacement = await claimDailyProductWindow(firestore, input, later);

    expect(first.outcome).toBe('CLAIMED');
    expect(replacement.outcome).toBe('CLAIMED');
    if (first.outcome !== 'CLAIMED' || replacement.outcome !== 'CLAIMED') {
      throw new Error('expected claims');
    }
    await expect(completeDailyProductWindow(firestore, {
      windowId: first.windowId,
      claimToken: first.claimToken,
      outcome: 'PENDING_RECEIPTS',
    }, later)).resolves.toBe(false);
    await expect(completeDailyProductWindow(firestore, {
      windowId: replacement.windowId,
      claimToken: replacement.claimToken,
      outcome: 'PENDING_RECEIPTS',
    }, later)).resolves.toBe(true);
  });
});
