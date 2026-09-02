import { describe, expect, it } from 'vitest';
import { addDaysLocal, type LocalDate } from '../../scheduleEngine/calendar';
import { computeActiveTimeTrace } from '../activeTime';
import {
  buildPrescribedOpportunities,
  countFulfilledPrescribedOpportunities,
} from '../prescribedOpportunities';

const prescribedSessions = [{ exercises: [{ exerciseId: 'a', setCount: 1 }] }];
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function execution(date: string, sessionIndex = 0, status: 'COMPLETED' | 'PARTIALLY_COMPLETED' = 'COMPLETED') {
  return {
    programInstanceId: 'wpi-a', sessionIndex, scheduledLocalDate: date, status,
    exercises: [{ exerciseIndex: 0, exerciseId: 'a', sets: [{ setIndex: 0, status: 'COMPLETED' as const }] }],
  };
}

function event(date: string, sessionIndex = 0) {
  return { type: 'COMPLETED' as const, programInstanceId: 'wpi-a', sessionIndex, scheduledDate: date };
}

function opportunities(...dates: string[]) {
  return dates.map((scheduledLocalDate) => ({ scheduledLocalDate, programInstanceId: 'wpi-a' }));
}

describe('countFulfilledPrescribedOpportunities', () => {
  it('counts prescribed completions and ignores extras outside the real opportunity calendar', () => {
    const prescribedDates = Array.from({ length: 6 }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`);
    const prescribed = prescribedDates.map((date) => execution(date));
    const extras = Array.from({ length: 4 }, (_, index) => execution(`2026-02-${String(index + 1).padStart(2, '0')}`));
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [...prescribed, ...extras],
      scheduleEvents: [...prescribed, ...extras].map((item) => event(item.scheduledLocalDate)),
      prescribedOpportunities: opportunities(...prescribedDates), prescribedSessions, trainingDays: ALL_DAYS,
    })).toBe(6);
  });

  it('credits one opportunity at most once even with duplicate execution/event records', () => {
    const one = execution('2026-01-05');
    const completed = event('2026-01-05');
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [one, { ...one }], scheduleEvents: [completed, { ...completed }],
      prescribedOpportunities: opportunities('2026-01-05'), prescribedSessions, trainingDays: ALL_DAYS,
    })).toBe(1);
  });

  it('requires a completed ledger event and a snapshot-qualified execution', () => {
    const corrupted = { ...execution('2026-01-05', 0, 'PARTIALLY_COMPLETED'), exercises: [] };
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [corrupted], scheduleEvents: [event('2026-01-05')],
      prescribedOpportunities: opportunities('2026-01-05'), prescribedSessions, trainingDays: ALL_DAYS,
    })).toBe(0);
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [execution('2026-01-06')], scheduleEvents: [],
      prescribedOpportunities: opportunities('2026-01-06'), prescribedSessions, trainingDays: ALL_DAYS,
    })).toBe(0);
  });

  it('rejects an execution that self-selects an easier session than the one actually expected that day', () => {
    // Two-session rotation A(2 sets)/B(1 set). Real rotation on 01-05 owes
    // session 0; the attacker always submits session 1 (cheaper) for every
    // date instead. This must never qualify, even though session 1's own
    // content is completed perfectly (docs §Wrong session attack).
    const twoSessions = [
      { exercises: [{ exerciseId: 'a', setCount: 2 }] },
      { exercises: [{ exerciseId: 'b', setCount: 1 }] },
    ];
    const cheapExecution = {
      programInstanceId: 'wpi-a', sessionIndex: 1, scheduledLocalDate: '2026-01-05', status: 'COMPLETED' as const,
      exercises: [{ exerciseIndex: 0, exerciseId: 'b', sets: [{ setIndex: 0, status: 'COMPLETED' as const }] }],
    };
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [cheapExecution], scheduleEvents: [],
      prescribedOpportunities: opportunities('2026-01-05'), prescribedSessions: twoSessions, trainingDays: ALL_DAYS,
    })).toBe(0);
  });

  it('credits a rotation-correct execution after an authoritative SKIPPED gap moved the expected index forward', () => {
    // Rotation A(0)/B(1)/C(2); a FOLLOW_SCHEDULE decision on 01-05 skips both
    // A and B that same day, so 01-06 legitimately expects session 2 — not
    // the naive "one step after the anchor" (1) a single-skip replay would give.
    const threeSessions = [
      { exercises: [{ exerciseId: 'a', setCount: 1 }] },
      { exercises: [{ exerciseId: 'b', setCount: 1 }] },
      { exercises: [{ exerciseId: 'c', setCount: 1 }] },
    ];
    const skippedA = { type: 'SKIPPED' as const, programInstanceId: 'wpi-a', sessionIndex: 0, scheduledDate: '2026-01-05' };
    const skippedB = { type: 'SKIPPED' as const, programInstanceId: 'wpi-a', sessionIndex: 1, scheduledDate: '2026-01-05' };
    const correctFollowUp = {
      programInstanceId: 'wpi-a', sessionIndex: 2, scheduledLocalDate: '2026-01-06', status: 'COMPLETED' as const,
      exercises: [{ exerciseIndex: 0, exerciseId: 'c', sets: [{ setIndex: 0, status: 'COMPLETED' as const }] }],
    };
    const completedEvent = { type: 'COMPLETED' as const, programInstanceId: 'wpi-a', sessionIndex: 2, scheduledDate: '2026-01-06' };
    expect(countFulfilledPrescribedOpportunities({
      programInstanceId: 'wpi-a', executions: [correctFollowUp], scheduleEvents: [skippedA, skippedB, completedEvent],
      prescribedOpportunities: opportunities('2026-01-05', '2026-01-06'), prescribedSessions: threeSessions, trainingDays: ALL_DAYS,
    })).toBe(1);
  });
});

describe('buildPrescribedOpportunities calendar boundaries', () => {
  const weekdaySets = [
    { trainingDays: ['MON', 'THU'] as const },
    { trainingDays: ['MON', 'WED', 'FRI'] as const },
    { trainingDays: ['MON', 'TUE', 'THU', 'FRI'] as const },
    { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const },
    { trainingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const },
  ];
  const noPauseConfig = {
    beginnerMinimumActiveDays: 28, intermediateAdvancedMinimumActiveDays: 85,
    motivationalRenewalExtensionDays: 30, adherenceEarnedThresholdBp: 7000,
    adherenceHighThresholdBp: 8500, partialSessionMinSetCompletionPercent: 70,
    intermediateCyclesForPromotion: 4, inactivityMissedOpportunityThreshold: 999,
  };

  it.each(weekdaySets)('enumerates real opportunities for $trainingDays across 28/85-day windows from every weekday', ({ trainingDays }) => {
    for (let startOffset = 0; startOffset < 7; startOffset += 1) {
      const start = addDaysLocal('2026-07-20', startOffset);
      for (const windowDays of [28, 85]) {
        const trace = computeActiveTimeTrace({
          startDateInclusive: start, todayLocalDate: addDaysLocal(start, windowDays - 1),
          trainingDays, executionDates: new Set(),
        }, noPauseConfig);
        const actual = buildPrescribedOpportunities({ programInstanceId: 'wpi-a', trainingDays, countedActiveDates: trace.countedDates });
        expect(new Set(actual.map((item) => item.scheduledLocalDate)).size).toBe(actual.length);
      }
    }
  });

  it('produces 49 real opportunities for the audited 4x/85-day boundary', () => {
    const trainingDays = ['MON', 'TUE', 'THU', 'FRI'] as const;
    const trace = computeActiveTimeTrace({
      startDateInclusive: '2026-07-20', todayLocalDate: addDaysLocal('2026-07-20', 84),
      trainingDays, executionDates: new Set(),
    }, noPauseConfig);
    expect(buildPrescribedOpportunities({ programInstanceId: 'wpi-a', trainingDays, countedActiveDates: trace.countedDates })).toHaveLength(49);
  });

  it('excludes paused opportunities and includes the return day', () => {
    const trainingDays = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
    const returnDate: LocalDate = '2026-07-27';
    const trace = computeActiveTimeTrace({
      startDateInclusive: '2026-07-20', todayLocalDate: returnDate,
      trainingDays, executionDates: new Set([returnDate]),
    });
    const dates = buildPrescribedOpportunities({ programInstanceId: 'wpi-a', trainingDays, countedActiveDates: trace.countedDates })
      .map((item) => item.scheduledLocalDate);
    expect(dates).toContain(returnDate);
    expect(dates).not.toContain('2026-07-23');
    expect(dates).not.toContain('2026-07-24');
  });

  it('resets the opportunity window at the adapted ProgramInstance activation date', () => {
    const trainingDays = ['MON', 'WED', 'FRI'] as const;
    const trace = computeActiveTimeTrace({
      startDateInclusive: '2026-08-03', todayLocalDate: '2026-08-09',
      trainingDays, executionDates: new Set(),
    });
    expect(buildPrescribedOpportunities({ programInstanceId: 'wpi-adapted', trainingDays, countedActiveDates: trace.countedDates }))
      .toEqual([
        { scheduledLocalDate: '2026-08-03', programInstanceId: 'wpi-adapted' },
        { scheduledLocalDate: '2026-08-05', programInstanceId: 'wpi-adapted' },
        { scheduledLocalDate: '2026-08-07', programInstanceId: 'wpi-adapted' },
      ]);
  });
});
