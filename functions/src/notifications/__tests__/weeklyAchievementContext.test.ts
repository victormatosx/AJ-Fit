import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createFakeFirestore } from '../../accountDeletion/firestoreCleanup/__tests__/fakeFirestore';

import {
  perfectWeekFacts,
  readWeeklyAchievementContext,
  selectWeeklyAchievementCandidate,
} from '../weeklyAchievementContext';
import { addDaysLocal } from '../../workoutLifecycle/prescriptionEngine/scheduleEngine/calendar';

type Opportunity = Parameters<typeof perfectWeekFacts>[0][number];

function opportunity(localDate: string, fulfilled = true, programInstanceId = 'instance-1'): Opportunity {
  return { localDate, fulfilled, programInstanceId, prescriptionIdentity: `prescription-${programInstanceId}` };
}

function perfectWeek(weekStart: string, instance = 'instance-1'): Opportunity[] {
  return [0, 2, 4].map((offset) => opportunity(addDaysLocal(weekStart, offset), true, instance));
}

describe('canonical perfect prescribed week', () => {
  it('forms WEEK_COMPLETED only after every TRAINING opportunity is fulfilled', () => {
    const complete = perfectWeekFacts(perfectWeek('2026-09-07'), '2026-09-11', '2026-09-07');
    expect(selectWeeklyAchievementCandidate(complete)).toMatchObject({
      notificationType: 'WEEK_COMPLETED',
      week: { opportunityCount: 3, fulfilledCount: 3, perfect: true },
    });

    for (const missedIndex of [0, 1]) {
      const missed = perfectWeek('2026-09-07');
      missed[missedIndex] = { ...missed[missedIndex], fulfilled: false };
      expect(selectWeeklyAchievementCandidate(
        perfectWeekFacts(missed, '2026-09-11', '2026-09-07'),
      )).toBeNull();
    }
  });

  it('does not complete while a future training opportunity remains', () => {
    const facts = perfectWeekFacts([
      opportunity('2026-09-07'),
      opportunity('2026-09-09'),
      opportunity('2026-09-11', false),
    ], '2026-09-09', '2026-09-07');
    expect(selectWeeklyAchievementCandidate(facts)).toBeNull();
  });

  it('ignores REST/ACTIVE_RECOVERY because only TRAINING opportunities enter the fact', () => {
    const facts = perfectWeekFacts([
      opportunity('2026-09-07'),
      opportunity('2026-09-11'),
    ], '2026-09-11', '2026-09-07');
    expect(selectWeeklyAchievementCandidate(facts)).toMatchObject({
      notificationType: 'WEEK_COMPLETED',
      week: { opportunityCount: 2, perfect: true },
    });
  });

  it('judges a partial onboarding week only from opportunities after its known-history boundary', () => {
    const facts = perfectWeekFacts([
      opportunity('2026-09-11'),
    ], '2026-09-11', '2026-09-11');
    expect(selectWeeklyAchievementCandidate(facts)).toMatchObject({
      week: { weekStart: '2026-09-07', opportunityCount: 1, perfect: true },
    });
  });

  it('preserves pre-adaptation misses and does not invent removed or retroactive opportunities', () => {
    const validChange = [
      opportunity('2026-09-07', true, 'old-instance'),
      opportunity('2026-09-11', true, 'new-instance'),
    ];
    expect(selectWeeklyAchievementCandidate(
      perfectWeekFacts(validChange, '2026-09-11', '2026-09-07'),
    )).toMatchObject({ week: { opportunityCount: 2, perfect: true } });

    const priorMiss = [{ ...validChange[0], fulfilled: false }, validChange[1]];
    expect(selectWeeklyAchievementCandidate(
      perfectWeekFacts(priorMiss, '2026-09-11', '2026-09-07'),
    )).toBeNull();
  });

  it('changes the semantic identity when the effective weekly prescription changes', () => {
    const original = selectWeeklyAchievementCandidate(perfectWeekFacts([
      opportunity('2026-09-07', true, 'old-instance'),
      opportunity('2026-09-09', true, 'old-instance'),
    ], '2026-09-09', '2026-09-07'));
    const adapted = selectWeeklyAchievementCandidate(perfectWeekFacts([
      opportunity('2026-09-07', true, 'old-instance'),
      opportunity('2026-09-09', true, 'new-instance'),
    ], '2026-09-09', '2026-09-07'));
    expect(adapted?.achievementIdentity).not.toBe(original?.achievementIdentity);
  });

  it('uses Monday-Sunday civil dates across a DST transition without UTC drift', () => {
    const facts = perfectWeekFacts([
      opportunity('2026-10-26'),
      opportunity('2026-10-28'),
      opportunity('2026-11-01'),
    ], '2026-11-01', '2026-10-26');
    expect(facts[0]).toMatchObject({
      weekStart: '2026-10-26', weekEnd: '2026-11-01', perfect: true,
    });
  });
});

describe('weekly fact loader', () => {
  function seededHistory(setStatus: 'COMPLETED' | 'PENDING' = 'COMPLETED') {
    const harness = createFakeFirestore();
    const root = 'users/uid-week';
    const activated = Timestamp.fromDate(new Date('2026-09-07T00:00:00Z'));
    const updated = Timestamp.fromDate(new Date('2026-09-07T00:01:00Z'));
    harness.seed(root, { preferences: {} });
    harness.seed(`${root}/workoutProgramState/scheduleConfig`, { timezone: 'UTC', updatedAt: activated });
    harness.seed(`${root}/workoutLifecycleState/current`, {
      initializationOrigin: 'V2_NATIVE',
      activeProgramInstanceId: 'instance-1',
      historyCompleteFrom: activated,
      updatedAt: updated,
    });
    harness.seed(`${root}/programInstances/instance-1`, {
      programInstanceId: 'instance-1',
      prescriptionIdentity: 'prescription-1',
      contentIdentity: 'program-1',
      previousProgramInstanceId: null,
      activatedAt: activated,
      supersededAt: null,
      prescriptionInputSnapshot: { inputs: { trainingDays: ['MON', 'WED', 'FRI'] } },
    });
    harness.seed(`${root}/workoutPrograms/program-1`, {
      weeklySchedule: (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((weekday) => ({
        weekday,
        state: ['MON', 'WED', 'FRI'].includes(weekday) ? 'TRAINING' : 'REST',
      })),
      sessions: [0, 1, 2].map((index) => ({
        exercises: [{ exerciseId: `exercise-${index}`, sets: 1 }],
      })),
    });
    for (const [index, date] of ['2026-09-07', '2026-09-09', '2026-09-11'].entries()) {
      harness.seed(`${root}/workoutPrograms/program-1/scheduleEvents/event-${index}`, {
        type: 'COMPLETED',
        programInstanceId: 'instance-1',
        sessionIndex: index,
        scheduledDate: date,
        occurredAt: Timestamp.fromDate(new Date(`${date}T07:00:00Z`)),
      });
      harness.seed(`${root}/workoutExecutions/execution-${index}`, {
        programInstanceId: 'instance-1',
        sessionIndex: index,
        scheduledLocalDate: date,
        status: index === 2 && setStatus === 'PENDING' ? 'PARTIALLY_COMPLETED' : 'COMPLETED',
        exercises: [{
          exerciseIndex: 0,
          exerciseId: `exercise-${index}`,
          sets: [{ setIndex: 0, status: index === 2 ? setStatus : 'COMPLETED' }],
        }],
      });
    }
    return harness;
  }

  it('proves a complete M/W/F week from immutable schedule and qualifying execution pairs', async () => {
    const harness = seededHistory();
    const result = await readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    );
    expect(result).toMatchObject({
      allowed: true,
      candidate: {
        notificationType: 'WEEK_COMPLETED',
        week: { opportunityCount: 3, fulfilledCount: 3, perfect: true },
      },
    });
  });

  it('keeps the Friday prescription fulfilled when its execution happened on Thursday', async () => {
    const harness = seededHistory();
    harness.seed('users/uid-week/workoutPrograms/program-1/scheduleEvents/event-2', {
      type: 'COMPLETED', programInstanceId: 'instance-1', sessionIndex: 2,
      scheduledDate: '2026-09-11', performedLocalDate: '2026-09-10',
      occurredAt: Timestamp.fromDate(new Date('2026-09-10T07:00:00Z')),
    });
    harness.seed('users/uid-week/workoutExecutions/execution-2', {
      programInstanceId: 'instance-1', sessionIndex: 2,
      scheduledLocalDate: '2026-09-11', performedLocalDate: '2026-09-10', status: 'COMPLETED',
      exercises: [{
        exerciseIndex: 0, exerciseId: 'exercise-2', sets: [{ setIndex: 0, status: 'COMPLETED' }],
      }],
    });
    await expect(readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-10T08:30:00Z')),
    )).resolves.toMatchObject({
      allowed: true,
      candidate: { week: { opportunityCount: 3, fulfilledCount: 3, perfect: true } },
    });
  });

  it('treats flexible as a numeric weekly target and not as weekday misses', async () => {
    const harness = seededHistory();
    harness.seed('users/uid-week/programInstances/instance-1', {
      programInstanceId: 'instance-1',
      prescriptionIdentity: 'prescription-1',
      contentIdentity: 'program-1',
      previousProgramInstanceId: null,
      activatedAt: Timestamp.fromDate(new Date('2026-09-07T00:00:00Z')),
      supersededAt: null,
      prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
    });
    harness.seed('users/uid-week/workoutPrograms/program-1', {
      scheduleMode: 'flexible',
      prescribedTrainingFrequency: 3,
      weeklySchedule: [],
      sessions: [0, 1, 2].map((index) => ({
        exercises: [{ exerciseId: `exercise-${index}`, sets: 1 }],
      })),
    });
    const result = await readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    );
    expect(result).toMatchObject({
      allowed: true,
      candidate: { week: { opportunityCount: 3, fulfilledCount: 3, perfect: true } },
    });
  });

  it('counts distinct flexible sequence sessions even when performed on the same day', async () => {
    const harness = seededHistory();
    const activated = Timestamp.fromDate(new Date('2026-09-07T00:00:00Z'));
    harness.seed('users/uid-week/programInstances/instance-1', {
      programInstanceId: 'instance-1', prescriptionIdentity: 'prescription-1', contentIdentity: 'program-1',
      previousProgramInstanceId: null, activatedAt: activated, supersededAt: null,
      prescriptionInputSnapshot: { inputs: { scheduleMode: 'flexible', trainingDays: null } },
    });
    harness.seed('users/uid-week/workoutPrograms/program-1', {
      scheduleMode: 'flexible', prescribedTrainingFrequency: 3, weeklySchedule: [],
      sessions: [0, 1, 2].map((index) => ({ exercises: [{ exerciseId: `exercise-${index}`, sets: 1 }] })),
    });
    for (const index of [0, 1, 2]) {
      harness.seed(`users/uid-week/workoutPrograms/program-1/scheduleEvents/event-${index}`, {
        type: 'COMPLETED', programInstanceId: 'instance-1', sessionIndex: index,
        scheduledDate: '2026-09-07', occurredAt: Timestamp.fromDate(new Date('2026-09-07T07:00:00Z')),
      });
      harness.seed(`users/uid-week/workoutExecutions/execution-${index}`, {
        programInstanceId: 'instance-1', sessionIndex: index, scheduledLocalDate: '2026-09-07', status: 'COMPLETED',
        exercises: [{ exerciseIndex: 0, exerciseId: `exercise-${index}`, sets: [{ setIndex: 0, status: 'COMPLETED' }] }],
      });
    }
    await expect(readWeeklyAchievementContext(
      harness.db as never, 'uid-week', Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    )).resolves.toMatchObject({
      allowed: true,
      candidate: { week: { opportunityCount: 3, fulfilledCount: 3, perfect: true } },
    });
  });

  it('fails closed when a terminal execution does not meet Progression V2 qualification', async () => {
    const harness = seededHistory('PENDING');
    await expect(readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    )).resolves.toMatchObject({ allowed: false, reason: 'NO_WEEKLY_ACHIEVEMENT' });
  });

  it('gives an earned evolution in the same perfect week higher priority', async () => {
    const harness = seededHistory();
    harness.seed('users/uid-week/workoutLifecycleEvents/earned', {
      type: 'EVOLUTION_EARNED',
      programInstanceId: 'instance-1',
      occurredAt: Timestamp.fromDate(new Date('2026-09-11T08:00:00Z')),
    });
    await expect(readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    )).resolves.toMatchObject({ allowed: false, reason: 'EVOLUTION_UNLOCKED_PRIORITY' });
  });

  it('postpones a weekly achievement on the local day PROGRAM_UPDATED is emitted', async () => {
    const harness = seededHistory();
    harness.seed('users/uid-week/workoutLifecycleEvents/adapted', {
      type: 'PROGRAM_ADAPTED',
      programInstanceId: 'instance-1',
      occurredAt: Timestamp.fromDate(new Date('2026-09-11T08:00:00Z')),
    });
    await expect(readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T08:30:00Z')),
    )).resolves.toMatchObject({ allowed: false, reason: 'PROGRAM_UPDATED_PRIORITY' });
  });

  it('allows retry preflight to revalidate the same fact outside the daily window', async () => {
    const harness = seededHistory();
    await expect(readWeeklyAchievementContext(
      harness.db as never,
      'uid-week',
      Timestamp.fromDate(new Date('2026-09-11T15:00:00Z')),
      { requireDailyWindow: false },
    )).resolves.toMatchObject({ allowed: true, candidate: { notificationType: 'WEEK_COMPLETED' } });
  });
});

describe('weekly streak', () => {
  it('uses the same perfect-week fact and emits the 2-week milestone instead of WEEK_COMPLETED', () => {
    const opportunities = [
      ...perfectWeek('2026-09-07'),
      ...perfectWeek('2026-08-31'),
    ];
    const candidate = selectWeeklyAchievementCandidate(
      perfectWeekFacts(opportunities, '2026-09-11', '2026-08-31'),
    );
    expect(candidate).toMatchObject({
      notificationType: 'WEEK_STREAK', weeks: 2, sequenceStartWeek: '2026-08-31',
    });
  });

  it('breaks on an imperfect week and allows a later sequence to start again', () => {
    const opportunities = [
      ...perfectWeek('2026-09-07'),
      ...perfectWeek('2026-08-31'),
      ...perfectWeek('2026-08-24').map((item, index) => index === 1 ? { ...item, fulfilled: false } : item),
      ...perfectWeek('2026-08-17'),
    ];
    expect(selectWeeklyAchievementCandidate(
      perfectWeekFacts(opportunities, '2026-09-11', '2026-08-17'),
    )).toMatchObject({ notificationType: 'WEEK_STREAK', weeks: 2 });
  });

  it('treats a zero-training week as a break, never a vacuous perfect week', () => {
    const opportunities = [
      ...perfectWeek('2026-09-07'),
      ...perfectWeek('2026-08-24'),
    ];
    expect(selectWeeklyAchievementCandidate(
      perfectWeekFacts(opportunities, '2026-09-11', '2026-08-24'),
    )).toMatchObject({ notificationType: 'WEEK_COMPLETED' });
  });

  it.each([2, 4, 8, 12, 24, 52] as const)('emits only the deliberate %i-week milestone', (count) => {
    const facts = Array.from({ length: count }, (_, index) => ({
      weekStart: `week-${index}`,
      weekEnd: `end-${index}`,
      opportunityCount: 3,
      fulfilledCount: 3,
      perfect: true,
      prescriptionIdentity: `prescription-${index}`,
    }));
    expect(selectWeeklyAchievementCandidate(facts)).toMatchObject({
      notificationType: 'WEEK_STREAK', weeks: count,
    });
  });

  it('does not re-emit the 52-week milestone after the sequence has grown beyond it', () => {
    const facts = Array.from({ length: 53 }, (_, index) => ({
      weekStart: `week-${index}`,
      weekEnd: `end-${index}`,
      opportunityCount: 3,
      fulfilledCount: 3,
      perfect: true,
      prescriptionIdentity: `prescription-${index}`,
    }));
    expect(selectWeeklyAchievementCandidate(facts)).toMatchObject({ notificationType: 'WEEK_COMPLETED' });
  });
});
