import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore, type FakeFirestoreHarness } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import { workoutExecutionDocumentId } from '../../workoutLifecycle/scheduleEngine/identities';
import {
  buildMissedWorkoutNotification,
  buildRecoveryDayNotification,
  buildWorkoutDayNotification,
} from '../contentPolicy';
import { runNotificationPreflight } from '../notificationPreflight';

const UID = 'uid-1';
const PROGRAM = 'wpg-1';
const INSTANCE = 'wpi-1';

/** 2026-09-07 is a Monday; the retry scheduler runs well outside 08:00–10:00. */
const MONDAY = Timestamp.fromDate(new Date('2026-09-07T21:00:00.000Z'));
const TUESDAY = Timestamp.fromDate(new Date('2026-09-08T21:00:00.000Z'));

type DayState = 'TRAINING' | 'ACTIVE_RECOVERY' | 'REST';

function week(overrides: Partial<Record<string, DayState>> = {}) {
  return (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
    weekday,
    state: overrides[weekday] ?? (weekday === 'MON' ? 'TRAINING' : 'REST'),
  }));
}

function seedProgram(
  harness: FakeFirestoreHarness,
  options: {
    weeklySchedule?: ReturnType<typeof week>;
    instanceId?: string;
    activatedAtLocalDate?: string;
    sessionCount?: number;
  } = {},
) {
  const instanceId = options.instanceId ?? INSTANCE;
  harness.seed(`users/${UID}`, { preferences: {} });
  harness.seed(`users/${UID}/workoutProgramState/scheduleConfig`, { timezone: 'UTC' });
  harness.seed(`users/${UID}/workoutLifecycleState/current`, {
    activeContentIdentity: PROGRAM,
    activeProgramInstanceId: instanceId,
  });
  harness.seed(`users/${UID}/programInstances/${instanceId}`, {
    activatedAt: Timestamp.fromDate(new Date(`${options.activatedAtLocalDate ?? '2026-09-07'}T00:00:00.000Z`)),
    contentIdentity: PROGRAM,
    supersededAt: null,
  });
  harness.seed(`users/${UID}/workoutPrograms/${PROGRAM}`, {
    status: 'active',
    weeklySchedule: options.weeklySchedule ?? week(),
    prescribedTrainingFrequency: options.sessionCount ?? 1,
    sessions: [{ exercises: [{ exerciseId: 'ex-1', sets: 3 }] }],
  });
}

function seedScheduleState(
  harness: FakeFirestoreHarness,
  state: Record<string, unknown>,
  instanceId = INSTANCE,
) {
  harness.seed(`users/${UID}/workoutPrograms/${PROGRAM}/scheduleState/${instanceId}`, state);
}

function workoutDay(localDate: string) {
  return buildWorkoutDayNotification({ uid: UID, localDate, locale: 'pt-BR' });
}

function recoveryDay(localDate: string) {
  return buildRecoveryDayNotification({ uid: UID, localDate, locale: 'pt-BR' });
}

function missedWorkout(plannedSessionIdentity: string) {
  return buildMissedWorkoutNotification({ uid: UID, plannedSessionIdentity, locale: 'pt-BR' });
}

/**
 * `retryNotificationDispatches` re-runs the central preflight before resending.
 * Without a branch for these three types the preflight fell through to the
 * permissive `allowed: true`, so a delayed retry could still deliver "Dia de
 * treino" after the session was finished, "Dia de recuperação" after the
 * schedule changed, or "Treino perdido" after the miss was resolved.
 */
describe('daily workout retry preflight', () => {
  it('allows a legitimate retry while the same fact is still true', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: true });
  });

  it('suppresses WORKOUT_DAY once the prescribed session is finished', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    harness.seed(
      `users/${UID}/workoutExecutions/${workoutExecutionDocumentId(INSTANCE, 0, '2026-09-07')}`,
      {
        programInstanceId: INSTANCE,
        sessionIndex: 0,
        scheduledLocalDate: '2026-09-07',
        status: 'COMPLETED',
      },
    );
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: false, reason: 'ALREADY_COMPLETED' });
  });

  it('suppresses WORKOUT_DAY when the schedule no longer prescribes today', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness, { weeklySchedule: week({ MON: 'REST', FRI: 'TRAINING' }) });
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: false, reason: 'REST_DAY' });
  });

  it('never delivers yesterday’s WORKOUT_DAY on a later retry day', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), TUESDAY))
      .resolves.toEqual({ allowed: false, reason: 'REST_DAY' });
  });

  it('never lets a stale WORKOUT_DAY ride a new day that happens to be valid', async () => {
    const harness = createFakeFirestore();
    // Both Monday and Tuesday are prescribed, so Tuesday is a genuinely valid
    // WORKOUT_DAY fact — but it is not the fact this dispatch was created for.
    seedProgram(harness, {
      weeklySchedule: week({ MON: 'TRAINING', TUE: 'TRAINING' }),
      sessionCount: 2,
    });
    seedScheduleState(harness, {
      nextSessionIndex: 1,
      cursorDate: '2026-09-07',
      lastCompletedAt: '2026-09-07',
      pendingMissDecision: null,
    });
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), TUESDAY))
      .resolves.toEqual({ allowed: false, reason: 'DAILY_WORKOUT_FACT_CHANGED' });
  });

  it('suppresses RECOVERY_DAY when the schedule dropped the recovery day', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness, { weeklySchedule: week({ MON: 'TRAINING', TUE: 'ACTIVE_RECOVERY' }) });
    await expect(runNotificationPreflight(harness.db as never, recoveryDay('2026-09-08'), TUESDAY))
      .resolves.toEqual({ allowed: true });

    const dropped = createFakeFirestore();
    seedProgram(dropped, { weeklySchedule: week({ MON: 'TRAINING', TUE: 'REST' }) });
    await expect(runNotificationPreflight(dropped.db as never, recoveryDay('2026-09-08'), TUESDAY))
      .resolves.toEqual({ allowed: false, reason: 'REST_DAY' });
  });

  it('never delivers a RECOVERY_DAY built for another local day', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness, { weeklySchedule: week({ MON: 'TRAINING', TUE: 'ACTIVE_RECOVERY' }) });
    await expect(runNotificationPreflight(harness.db as never, recoveryDay('2026-09-07'), TUESDAY))
      .resolves.toEqual({ allowed: false, reason: 'DAILY_WORKOUT_FACT_CHANGED' });
  });

  it('allows MISSED_WORKOUT while the pending decision is still open', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    seedScheduleState(harness, {
      nextSessionIndex: 0,
      cursorDate: '2026-08-31',
      lastCompletedAt: '2026-08-31',
      pendingMissDecision: {
        missedSessionIndex: 0,
        calendarSessionIndex: 1,
        missedScheduledDate: '2026-08-31',
        detectedOnDate: '2026-09-07',
      },
    });
    await expect(runNotificationPreflight(
      harness.db as never,
      missedWorkout(`${INSTANCE}:2026-08-31:0`),
      MONDAY,
    )).resolves.toEqual({ allowed: true });
  });

  it('suppresses MISSED_WORKOUT once the user resolved the pending decision', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    seedScheduleState(harness, {
      nextSessionIndex: 0,
      cursorDate: '2026-08-31',
      lastCompletedAt: '2026-08-31',
      pendingMissDecision: null,
    });
    await expect(runNotificationPreflight(
      harness.db as never,
      missedWorkout(`${INSTANCE}:2026-08-31:0`),
      MONDAY,
    )).resolves.toEqual({ allowed: false, reason: 'DAILY_WORKOUT_FACT_CHANGED' });
  });

  it('suppresses MISSED_WORKOUT after the Program Instance was replaced', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness, { instanceId: 'wpi-2' });
    seedScheduleState(harness, {
      nextSessionIndex: 0,
      cursorDate: '2026-08-31',
      lastCompletedAt: '2026-08-31',
      pendingMissDecision: {
        missedSessionIndex: 0,
        calendarSessionIndex: 1,
        missedScheduledDate: '2026-08-31',
        detectedOnDate: '2026-09-07',
      },
    }, 'wpi-2');
    // The old identity carries the superseded instance id.
    await expect(runNotificationPreflight(
      harness.db as never,
      missedWorkout(`${INSTANCE}:2026-08-31:0`),
      MONDAY,
    )).resolves.toEqual({ allowed: false, reason: 'DAILY_WORKOUT_FACT_CHANGED' });
  });

  it('suppresses MISSED_WORKOUT for a different missed date', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    seedScheduleState(harness, {
      nextSessionIndex: 0,
      cursorDate: '2026-08-31',
      lastCompletedAt: '2026-08-31',
      pendingMissDecision: {
        missedSessionIndex: 0,
        calendarSessionIndex: 1,
        missedScheduledDate: '2026-08-31',
        detectedOnDate: '2026-09-07',
      },
    });
    await expect(runNotificationPreflight(
      harness.db as never,
      missedWorkout(`${INSTANCE}:2026-08-24:0`),
      MONDAY,
    )).resolves.toEqual({ allowed: false, reason: 'DAILY_WORKOUT_FACT_CHANGED' });
  });

  it('suppresses a daily workout retry once the program is gone', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    harness.seed(`users/${UID}/workoutPrograms/${PROGRAM}`, { status: 'archived' });
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: false, reason: 'PROGRAM_UNAVAILABLE' });
  });

  it('suppresses a daily workout retry for a deleted account', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    harness.seed(`accountDeletionLocks/${UID}`, { lockedAt: MONDAY });
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: false, reason: 'ACCOUNT_INACTIVE' });
  });

  it('does not re-apply the 08:00–10:00 send window to a legitimate retry', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    const lateNight = Timestamp.fromDate(new Date('2026-09-07T23:59:00.000Z'));
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), lateNight))
      .resolves.toEqual({ allowed: true });
  });

  it('suppresses a retry that crossed the local day after a timezone change', async () => {
    const harness = createFakeFirestore();
    seedProgram(harness);
    // Kiritimati is UTC+14: 2026-09-07T21:00Z is already 2026-09-08 locally.
    harness.seed(`users/${UID}/workoutProgramState/scheduleConfig`, {
      timezone: 'Pacific/Kiritimati',
    });
    await expect(runNotificationPreflight(harness.db as never, workoutDay('2026-09-07'), MONDAY))
      .resolves.toEqual({ allowed: false, reason: 'REST_DAY' });
  });
});
