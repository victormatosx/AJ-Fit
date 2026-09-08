import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationDispatchRequest } from '../schema';
import {
  evaluateDailyWorkoutNotification,
  type DailyWorkoutContext,
  type DailyWorkoutNotificationDependencies,
} from '../dailyWorkoutNotifications';

const UID = 'user-123';
const MONDAY_AT_08_30_UTC = Timestamp.fromDate(new Date('2026-09-07T08:30:00.000Z'));

function week(overrides: Partial<Record<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN',
  'TRAINING' | 'ACTIVE_RECOVERY' | 'REST'>> = {}) {
  return (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
    weekday,
    state: overrides[weekday] ?? (weekday === 'MON' ? 'TRAINING' as const : 'REST' as const),
  }));
}

function context(overrides: Partial<DailyWorkoutContext> = {}): DailyWorkoutContext {
  return {
    status: 'READY',
    timezone: 'UTC',
    programId: 'wpg-current',
    programInstanceId: 'wpi-current',
    activatedAtLocalDate: '2026-09-07',
    weeklySchedule: week(),
    sessionCount: 1,
    scheduleState: null,
    resolvedMissScheduledDate: null,
    ...overrides,
  };
}

function accepted() {
  return {
    status: 'PENDING_RECEIPTS' as const,
    dispatchId: 'dispatch-1',
    deviceCount: 1,
    acceptedCount: 1,
  };
}

function fixture(
  current: DailyWorkoutContext | Exclude<Awaited<ReturnType<DailyWorkoutNotificationDependencies['loadContext']>>, DailyWorkoutContext>,
  overrides: Partial<DailyWorkoutNotificationDependencies> = {},
) {
  const requests: NotificationDispatchRequest[] = [];
  const dependencies: DailyWorkoutNotificationDependencies = {
    db: {} as never,
    now: () => MONDAY_AT_08_30_UTC,
    loadContext: vi.fn(async () => current),
    hasFinishedExecution: vi.fn(async () => false),
    dispatchCandidate: vi.fn(async (candidate) => {
      requests.push(candidate.build('pt-BR'));
      return accepted();
    }),
    claimProductWindow: vi.fn(async () => ({
      outcome: 'CLAIMED' as const,
      windowId: 'window-1',
      claimToken: 'claim-1',
    })),
    completeProductWindow: vi.fn(async () => true),
    ...overrides,
  };
  return { dependencies, requests };
}

describe('daily workout notification evaluator', () => {
  it('creates WORKOUT_DAY for the current prescribed training day', async () => {
    const { dependencies, requests } = fixture(context());
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED',
      notificationType: 'WORKOUT_DAY',
      localDate: '2026-09-07',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: 'WORKOUT_DAY',
      category: 'WORKOUTS_AND_REMINDERS',
      data: {},
    });
  });

  it('suppresses WORKOUT_DAY when the deterministic execution is already finished', async () => {
    const { dependencies, requests } = fixture(context(), {
      hasFinishedExecution: vi.fn(async () => true),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'ALREADY_COMPLETED',
    });
    expect(requests).toHaveLength(0);
  });

  it('suppresses when schedule state already records today as completed', async () => {
    const { dependencies, requests } = fixture(context({
      scheduleState: {
        nextSessionIndex: 0,
        cursorDate: '2026-09-07',
        lastCompletedAt: '2026-09-07',
        pendingMissDecision: null,
      },
    }));
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'TODAY_COMPLETED',
    });
    expect(requests).toHaveLength(0);
  });

  it('uses the current adapted schedule rather than an obsolete weekday', async () => {
    const { dependencies, requests } = fixture(context({
      weeklySchedule: week({ MON: 'REST', FRI: 'TRAINING' }),
      activatedAtLocalDate: '2026-09-07',
    }));
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'REST_DAY',
    });
    expect(requests).toHaveLength(0);
  });

  it('never treats a neutral REST day as RECOVERY_DAY', async () => {
    const { dependencies, requests } = fixture(context({
      weeklySchedule: week({ MON: 'REST', WED: 'TRAINING' }),
      activatedAtLocalDate: '2026-09-07',
    }));
    await evaluateDailyWorkoutNotification(UID, dependencies);
    expect(requests).toHaveLength(0);
  });

  it('creates RECOVERY_DAY only for explicit ACTIVE_RECOVERY', async () => {
    const now = Timestamp.fromDate(new Date('2026-09-08T08:30:00.000Z'));
    const { dependencies, requests } = fixture(context({
      weeklySchedule: week({ MON: 'TRAINING', TUE: 'ACTIVE_RECOVERY' }),
    }), { now: () => now });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'RECOVERY_DAY', localDate: '2026-09-08',
    });
    expect(requests[0]?.type).toBe('RECOVERY_DAY');
  });

  it('does not classify one skipped occurrence as missed before the next training day', async () => {
    const now = Timestamp.fromDate(new Date('2026-09-11T08:30:00.000Z')); // Friday
    const { dependencies, requests } = fixture(context({
      activatedAtLocalDate: '2026-09-01',
      weeklySchedule: week({ MON: 'REST', TUE: 'TRAINING', THU: 'TRAINING' }),
      sessionCount: 2,
      scheduleState: {
        nextSessionIndex: 1,
        cursorDate: '2026-09-08',
        lastCompletedAt: '2026-09-08',
        pendingMissDecision: null,
      },
    }), { now: () => now });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'REST_DAY',
    });
    expect(requests).toHaveLength(0);
  });

  it('creates MISSED_WORKOUT only when the canonical resolver exposes an unresolved gap', async () => {
    const now = Timestamp.fromDate(new Date('2026-09-15T08:30:00.000Z')); // following Tuesday
    const { dependencies, requests } = fixture(context({
      activatedAtLocalDate: '2026-09-01',
      weeklySchedule: week({ MON: 'REST', TUE: 'TRAINING', THU: 'TRAINING' }),
      sessionCount: 2,
      scheduleState: {
        nextSessionIndex: 1,
        cursorDate: '2026-09-08',
        lastCompletedAt: '2026-09-08',
        pendingMissDecision: null,
      },
    }), { now: () => now });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', notificationType: 'MISSED_WORKOUT', localDate: '2026-09-15',
    });
    expect(requests[0]?.type).toBe('MISSED_WORKOUT');
  });

  it('gives MISSED_WORKOUT priority over today’s WORKOUT_DAY', async () => {
    const pending = {
      missedSessionIndex: 0,
      calendarSessionIndex: 1,
      missedScheduledDate: '2026-09-04',
      detectedOnDate: '2026-09-07',
    };
    const { dependencies, requests } = fixture(context({
      scheduleState: {
        nextSessionIndex: 0,
        cursorDate: '2026-09-03',
        lastCompletedAt: '2026-09-03',
        pendingMissDecision: pending,
      },
    }));
    await evaluateDailyWorkoutNotification(UID, dependencies);
    expect(requests.map((request) => request.type)).toEqual(['MISSED_WORKOUT']);
  });

  it('persists normal preference and device outcomes without breaking the scheduler', async () => {
    for (const outcome of [
      { status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed' },
      { status: 'NO_ELIGIBLE_DEVICE' as const, dispatchId: 'no-device' },
    ]) {
      const { dependencies } = fixture(context(), {
        dispatchCandidate: vi.fn(async () => outcome),
      });
      await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
        status: 'DISPATCHED', outcome: outcome.status,
      });
    }
  });

  it('absorbs dispatcher failure and never mutates the workout domain', async () => {
    const { dependencies } = fixture(context(), {
      dispatchCandidate: vi.fn(async () => { throw new Error('dispatcher unavailable'); }),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'FAILED', localDate: '2026-09-07',
    });
  });

  it.each([
    'USER_NOT_FOUND',
    'ACCOUNT_INACTIVE',
    'TIMEZONE_UNAVAILABLE',
    'PROGRAM_UNAVAILABLE',
    'SCHEDULE_UNAVAILABLE',
  ] as const)('suppresses unavailable eligibility state %s', async (status) => {
    const { dependencies } = fixture({ status });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: status,
    });
  });

  it('suppresses outside the local window using the canonical timezone', async () => {
    const { dependencies } = fixture(context(), {
      now: () => Timestamp.fromDate(new Date('2026-09-07T07:59:00.000Z')),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'OUTSIDE_LOCAL_WINDOW',
    });
  });

  it('deduplicates concurrent scheduler workers before dispatching twice', async () => {
    let claimed = false;
    const dispatchCandidate = vi.fn(async () => accepted());
    const shared = {
      dispatchCandidate,
      claimProductWindow: vi.fn(async () => {
        if (claimed) return { outcome: 'DUPLICATE' as const, windowId: 'window-1' };
        claimed = true;
        return { outcome: 'CLAIMED' as const, windowId: 'window-1', claimToken: 'claim-1' };
      }),
    };
    const first = fixture(context(), shared);
    const second = fixture(context(), shared);

    const outcomes = await Promise.all([
      evaluateDailyWorkoutNotification(UID, first.dependencies),
      evaluateDailyWorkoutNotification(UID, second.dependencies),
    ]);
    expect(dispatchCandidate).toHaveBeenCalledTimes(1);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['DISPATCHED', 'SUPPRESSED']);
  });

  it('enforces one workouts/reminders product slot per local day across types', async () => {
    const { dependencies } = fixture(context(), {
      claimProductWindow: vi.fn(async () => ({ outcome: 'RATE_LIMITED' as const, windowId: 'window-1' })),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'PRODUCT_RATE_LIMIT',
    });
  });
});
