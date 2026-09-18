import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';
import type { ProgressionSnapshotV2 } from '../../workoutLifecycle/prescriptionEngine/progressionEngineV2/types';
import { addDaysLocal } from '../../workoutLifecycle/prescriptionEngine/scheduleEngine/calendar';
import { approachingReason, readApproachingContext } from '../evolutionApproachingContext';

function snapshot(overrides: Partial<ProgressionSnapshotV2> = {}): ProgressionSnapshotV2 {
  return {
    level: 'BEGINNER',
    activeTime: { activeDays: 25, pausedAt: null },
    adherence: { ratio: 0.75, quality: 'GOOD' },
    earnedIntermediateCycleCount: 0,
    hasInProgressExecution: false,
    validSessionCount: 8,
    ...overrides,
  };
}

describe('EVOLUTION_APPROACHING Progression V2 gate', () => {
  it.each([25, 26, 27])('enters the one-shot window with %s beginner active days', (activeDays) => {
    expect(approachingReason(snapshot({ activeTime: { activeDays, pausedAt: null } }))).toBeNull();
  });

  it('does nothing before the exact three-active-day window', () => {
    expect(approachingReason(snapshot({ activeTime: { activeDays: 24, pausedAt: null } })))
      .toBe('OUTSIDE_APPROACHING_WINDOW');
  });

  it('never approaches after earned eligibility', () => {
    expect(approachingReason(snapshot({ activeTime: { activeDays: 28, pausedAt: null } })))
      .toBe('LEVEL_PROMOTION_ELIGIBLE');
  });

  it('fails closed for low adherence, paused active time, and in-progress work', () => {
    expect(approachingReason(snapshot({ adherence: { ratio: 0.69, quality: 'BELOW_TARGET' } })))
      .toBe('ADHERENCE_BELOW_THRESHOLD');
    expect(approachingReason(snapshot({ activeTime: { activeDays: 25, pausedAt: '2026-09-01' } })))
      .toBe('ACTIVE_TIME_PAUSED');
    expect(approachingReason(snapshot({ hasInProgressExecution: true }))).toBe('NO_ACTION');
  });

  it('uses the real 85-day threshold for intermediate and advanced cycles', () => {
    expect(approachingReason(snapshot({
      level: 'INTERMEDIATE', activeTime: { activeDays: 82, pausedAt: null },
    }))).toBeNull();
    expect(approachingReason(snapshot({
      level: 'ADVANCED', activeTime: { activeDays: 81, pausedAt: null },
    }))).toBe('OUTSIDE_APPROACHING_WINDOW');
  });

  it('does not reinterpret the low-adherence motivational-renewal path as approaching', () => {
    expect(approachingReason(snapshot({
      activeTime: { activeDays: 58, pausedAt: null },
      adherence: { ratio: 0.6, quality: 'BELOW_TARGET' },
    }))).toBe('MOTIVATIONAL_RENEWAL_AVAILABLE');
  });
});

function progressionContextFixture() {
  const harness = createFakeFirestore();
  const uid = 'uid-context';
  const root = `users/${uid}`;
  harness.seed(root, { preferences: {} });
  harness.seed(`${root}/workoutLifecycleState/current`, {
    currentCycleId: 'cycle-1',
    activeProgramInstanceId: 'instance-1',
    activeContentIdentity: 'program-1',
    currentTrainingLevel: 'BEGINNER',
  });
  harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'America/Sao_Paulo' });
  harness.seed(`${root}/programInstances/instance-1`, {
    cycleId: 'cycle-1',
    contentIdentity: 'program-1',
    supersededAt: null,
    activatedAt: Timestamp.fromDate(new Date('2026-08-15T12:00:00.000Z')),
    prescriptionInputSnapshot: { inputs: {
      trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    } },
  });
  harness.seed(`${root}/trainingCycles/cycle-1`, { status: 'ACTIVE', eligibleAt: null });
  harness.seed(`${root}/workoutPrograms/program-1`, {
    status: 'active', sessions: [{ exercises: [{ exerciseId: 'exercise-1', sets: 1 }] }],
  });
  let date = '2026-08-15';
  for (let index = 0; index < 24; index += 1) {
    harness.seed(`${root}/workoutExecutions/execution-${index}`, {
      programInstanceId: 'instance-1',
      sessionIndex: 0,
      scheduledLocalDate: date,
      status: 'COMPLETED',
      exercises: [{ exerciseIndex: 0, exerciseId: 'exercise-1', sets: [{ setIndex: 0, status: 'COMPLETED' }] }],
    });
    harness.seed(`${root}/workoutPrograms/program-1/scheduleEvents/completed-${index}`, {
      type: 'COMPLETED', programInstanceId: 'instance-1', sessionIndex: 0, scheduledDate: date,
    });
    date = addDaysLocal(date, 1);
  }
  return { harness, uid, root };
}

describe('EVOLUTION_APPROACHING authoritative context', () => {
  const now = Timestamp.fromDate(new Date('2026-09-08T11:30:00.000Z'));

  it('derives the approaching fact from the active immutable prescription window', async () => {
    const { harness, uid } = progressionContextFixture();
    await expect(readApproachingContext(harness.db as never, uid, now)).resolves.toMatchObject({
      allowed: true,
      progressionWindowId: 'instance-1',
      timezone: 'America/Sao_Paulo',
      localDate: '2026-09-08',
    });
  });

  it('does not pull a next-day advanced completion into today\'s evolution window', async () => {
    const { harness, uid, root } = progressionContextFixture();
    harness.seed(`${root}/workoutExecutions/advanced-tomorrow`, {
      programInstanceId: 'instance-1',
      sessionIndex: 0,
      scheduledLocalDate: '2026-09-09',
      performedLocalDate: '2026-09-08',
      status: 'COMPLETED',
      exercises: [{ exerciseIndex: 0, exerciseId: 'exercise-1', sets: [{ setIndex: 0, status: 'COMPLETED' }] }],
    });
    harness.seed(`${root}/workoutPrograms/program-1/scheduleEvents/advanced-tomorrow`, {
      type: 'COMPLETED',
      programInstanceId: 'instance-1',
      sessionIndex: 0,
      scheduledDate: '2026-09-09',
      performedLocalDate: '2026-09-08',
    });

    await expect(readApproachingContext(harness.db as never, uid, now)).resolves.toMatchObject({
      allowed: true,
      localDate: '2026-09-08',
      progressionWindowId: 'instance-1',
    });
  });

  it('suppresses pending/earned evolution and gives the unlock fact priority', async () => {
    const pending = progressionContextFixture();
    pending.harness.seed(`${pending.root}/pendingEvolutions/current`, { cycleId: 'cycle-1' });
    await expect(readApproachingContext(pending.harness.db as never, pending.uid, now))
      .resolves.toMatchObject({ allowed: false, reason: 'PENDING_EVOLUTION' });

    const earned = progressionContextFixture();
    earned.harness.seed(`${earned.root}/workoutLifecycleEvents/earned`, {
      cycleId: 'cycle-1', programInstanceId: 'instance-1', type: 'EVOLUTION_EARNED',
    });
    await expect(readApproachingContext(earned.harness.db as never, earned.uid, now))
      .resolves.toMatchObject({ allowed: false, reason: 'EVOLUTION_ALREADY_EARNED_OR_OFFERED' });
  });

  it('uses the currently active program instance after adaptation', async () => {
    const { harness, uid, root } = progressionContextFixture();
    harness.seed(`${root}/workoutLifecycleState/current`, {
      currentCycleId: 'cycle-1',
      activeProgramInstanceId: 'instance-adapted',
      activeContentIdentity: 'program-adapted',
      currentTrainingLevel: 'BEGINNER',
    });
    await expect(readApproachingContext(harness.db as never, uid, now)).resolves.toMatchObject({
      allowed: false, reason: 'PROGRAM_UNAVAILABLE',
    });
  });

  it('fails closed for an invalid timezone rather than falling back to UTC', async () => {
    const { harness, uid, root } = progressionContextFixture();
    harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'UTC-3' });
    await expect(readApproachingContext(harness.db as never, uid, now)).resolves.toMatchObject({
      allowed: false, reason: 'TIMEZONE_UNAVAILABLE',
    });
  });
});
