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
    releaseProductWindow: vi.fn(async () => true),
    resolvePolicy: vi.fn(async () => ({ allowed: true, reason: 'ALLOWED' })),
    ...overrides,
  };
  return { dependencies, requests };
}

describe('daily workout notification evaluator', () => {
  it('does not send weekday-based workout or missed notifications for flexible plans', async () => {
    const { dependencies, requests } = fixture(context({
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      weeklySchedule: [],
      scheduleState: {
        nextSessionIndex: 1,
        cursorDate: '2026-08-28',
        lastCompletedAt: '2026-08-28',
        pendingMissDecision: null,
      },
    }));
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'FLEXIBLE_NO_CALENDAR_NOTIFICATION',
    });
    expect(requests).toHaveLength(0);
  });

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
      status: 'SUPPRESSED', reason: 'ALREADY_TRAINED_TODAY',
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
      status: 'SUPPRESSED', reason: 'ALREADY_TRAINED_TODAY',
    });
    expect(requests).toHaveLength(0);
  });

  it('does not notify Friday after its opportunity was completed early on Thursday', async () => {
    const friday = Timestamp.fromDate(new Date('2026-09-18T08:30:00.000Z'));
    const { dependencies, requests } = fixture(context({
      activatedAtLocalDate: '2026-09-14',
      weeklySchedule: week({ MON: 'TRAINING', TUE: 'TRAINING', WED: 'TRAINING', FRI: 'TRAINING' }),
      sessionCount: 4,
      scheduleState: {
        nextSessionIndex: 0,
        cursorDate: '2026-09-18',
        lastCompletedAt: '2026-09-18',
        pendingMissDecision: null,
      },
    }), { now: () => friday });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'ALREADY_TRAINED_TODAY',
    });
    expect(requests).toHaveLength(0);
    expect(dependencies.hasFinishedExecution).not.toHaveBeenCalled();
  });

  it('uses the current adapted schedule rather than an obsolete weekday', async () => {
    const { dependencies, requests } = fixture(context({
      weeklySchedule: week({ MON: 'REST', FRI: 'TRAINING' }),
      activatedAtLocalDate: '2026-09-07',
    }));
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'NOT_A_RECOMMENDED_DAY',
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
      status: 'SUPPRESSED', reason: 'NOT_A_RECOMMENDED_DAY',
    });
    expect(requests).toHaveLength(0);
  });

  // Decision 2.b: a recommended day the user did not train is simply a day.
  // Nothing is sent about it afterwards — the punitive type is unreachable.
  // Tuesday IS a recommended day here, so the user gets the FRIENDLY nudge
  // instead of being told they missed something.
  it('never creates MISSED_WORKOUT — an elapsed recommended day yields the friendly nudge', async () => {
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
      status: 'DISPATCHED', notificationType: 'WORKOUT_DAY', localDate: '2026-09-15',
    });
    expect(requests[0]?.type).toBe('WORKOUT_DAY');
    expect(requests.map((request) => request.type)).not.toContain('MISSED_WORKOUT');
  });

  // A legacy `pendingMissDecision` left on the rotation state must not
  // resurrect the punitive notification, and must not suppress the friendly
  // one either: it is simply ignored.
  it('ignores a legacy pending miss decision entirely', async () => {
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
    expect(requests.map((request) => request.type)).toEqual(['WORKOUT_DAY']);
  });

  it('persists a device-level outcome without breaking the scheduler', async () => {
    const { dependencies } = fixture(context(), {
      dispatchCandidate: vi.fn(async () => ({
        status: 'NO_ELIGIBLE_DEVICE' as const, dispatchId: 'no-device',
      })),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'DISPATCHED', outcome: 'NO_ELIGIBLE_DEVICE',
    });
    // A silenced device still consumed the user's product day.
    expect(dependencies.completeProductWindow).toHaveBeenCalledTimes(1);
    expect(dependencies.releaseProductWindow).not.toHaveBeenCalled();
  });

  it('never claims the shared daily slot when WORKOUTS_AND_REMINDERS is off', async () => {
    const { dependencies, requests } = fixture(context(), {
      resolvePolicy: vi.fn(async () => ({ allowed: false, reason: 'DISABLED_BY_USER' })),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'DISABLED_BY_USER',
    });
    expect(dependencies.claimProductWindow).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('releases the daily slot when the preference flips off between pre-check and dispatch', async () => {
    const { dependencies } = fixture(context(), {
      dispatchCandidate: vi.fn(async () => ({
        status: 'SUPPRESSED_BY_PREFERENCE' as const, dispatchId: 'suppressed',
      })),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'SUPPRESSED_BY_PREFERENCE',
    });
    expect(dependencies.releaseProductWindow).toHaveBeenCalledWith({
      windowId: 'window-1', claimToken: 'claim-1',
    });
    expect(dependencies.completeProductWindow).not.toHaveBeenCalled();
  });

  it('releases the daily slot when the dispatcher preflight fences a stale fact', async () => {
    const { dependencies } = fixture(context(), {
      dispatchCandidate: vi.fn(async () => ({
        status: 'SUPPRESSED_BY_POLICY' as const, dispatchId: 'stale',
      })),
    });
    await expect(evaluateDailyWorkoutNotification(UID, dependencies)).resolves.toMatchObject({
      status: 'SUPPRESSED', reason: 'SUPPRESSED_BY_POLICY',
    });
    expect(dependencies.releaseProductWindow).toHaveBeenCalledTimes(1);
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
