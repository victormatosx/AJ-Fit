import { describe, expect, it } from 'vitest';

import { computeAdherence } from '../adherence';
import {
  buildFlexibleWeeklyTargets,
  buildPrescribedOpportunities,
  countFulfilledPrescribedOpportunities,
  countFulfilledWeeklyTrainedDays,
} from '../prescribedOpportunities';
import type { LocalDate } from '../../scheduleEngine/calendar';
import type { Weekday } from '../../state/AppState';

/**
 * Adherence for the new training model.
 *
 * The rule under test, stated once:
 *
 *     meta(semana)     = min(frequência prescrita, dias ativos na semana)
 *     cumprido(semana) = min(meta(semana), dias DISTINTOS treinados na semana)
 *     ratio            = Σ cumprido / Σ meta
 *
 * These tests are written adversarially: each one is a way the old
 * weekday-identity rule produced a number a user would call wrong.
 */

const INSTANCE = 'wpi_test';

/**
 * Six sessions, each prescribing one exercise of three sets. The executions
 * below mirror this shape exactly, because
 * `isValidProgressionSessionAgainstPrescription` fails closed on any
 * mismatch — these fixtures have to be as well-formed as real ones.
 * `partialSessionMinSetCompletionPercent` is 70, and with three sets that
 * means only 3/3 clears it (2/3 is 66.7%).
 */
const SESSIONS = Array.from({ length: 6 }, (_, index) => ({
  exercises: [{ exerciseId: `ex-${index}`, setCount: 3 }],
}));

function execution(date: LocalDate, sessionIndex: number, options: {
  performedLocalDate?: LocalDate;
  completedSets?: number;
  status?: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED' | 'IN_PROGRESS';
} = {}) {
  const completed = options.completedSets ?? 3;
  return {
    programInstanceId: INSTANCE,
    sessionIndex,
    scheduledLocalDate: date,
    ...(options.performedLocalDate ? { performedLocalDate: options.performedLocalDate } : {}),
    status: options.status ?? 'COMPLETED',
    exercises: [{
      exerciseIndex: 0,
      exerciseId: `ex-${sessionIndex}`,
      sets: [0, 1, 2].map((setIndex) => ({
        setIndex,
        status: setIndex < completed ? 'COMPLETED' as const : 'PENDING' as const,
      })),
    }],
  };
}

function ledgerEvent(date: LocalDate, sessionIndex: number) {
  return { type: 'COMPLETED' as const, programInstanceId: INSTANCE, sessionIndex, scheduledDate: date };
}

/** Every day in `[from, to]`, which is what an uninterrupted active window is. */
function activeDates(from: LocalDate, to: LocalDate): Set<LocalDate> {
  const dates = new Set<LocalDate>();
  for (let cursor = new Date(`${from}T12:00:00Z`); cursor <= new Date(`${to}T12:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.add(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function pilotRatio(input: {
  from: LocalDate; to: LocalDate; frequency: number;
  executions: ReturnType<typeof execution>[];
}): number {
  const weeklyTargets = buildFlexibleWeeklyTargets({
    countedActiveDates: activeDates(input.from, input.to),
    prescribedTrainingFrequency: input.frequency,
  });
  const fulfilled = countFulfilledWeeklyTrainedDays({
    programInstanceId: INSTANCE,
    executions: input.executions,
    scheduleEvents: input.executions.map((item) => ledgerEvent(item.scheduledLocalDate, item.sessionIndex)),
    prescribedSessions: SESSIONS,
    weeklyTargets,
  });
  const expected = [...weeklyTargets.values()].reduce((sum, count) => sum + count, 0);
  return computeAdherence(fulfilled, expected).ratio;
}

/** The legacy fixed rule, for the side-by-side comparisons below. */
function legacyFixedRatio(input: {
  from: LocalDate; to: LocalDate; trainingDays: Weekday[];
  executions: ReturnType<typeof execution>[];
}): number {
  const counted = activeDates(input.from, input.to);
  const prescribedOpportunities = buildPrescribedOpportunities({
    programInstanceId: INSTANCE, trainingDays: input.trainingDays, countedActiveDates: counted,
  });
  const fulfilled = countFulfilledPrescribedOpportunities({
    programInstanceId: INSTANCE,
    executions: input.executions,
    scheduleEvents: input.executions.map((item) => ledgerEvent(item.scheduledLocalDate, item.sessionIndex)),
    prescribedOpportunities,
    prescribedSessions: SESSIONS,
    trainingDays: input.trainingDays,
  });
  return computeAdherence(fulfilled, prescribedOpportunities.length).ratio;
}

// 2026-10-19 is a Monday; the week runs through Sunday 2026-10-25.
const MON = '2026-10-19', TUE = '2026-10-20', WED = '2026-10-21';
const THU = '2026-10-22', FRI = '2026-10-23', SAT = '2026-10-24', SUN = '2026-10-25';

describe('the defect this replaces', () => {
  /** The exact scenario in the product brief. */
  it('meta 3, treinos TER/QUI/SÁB, recomendação SEG/QUA/SEX: 100%, não 0%', () => {
    const executions = [execution(TUE, 0), execution(THU, 1), execution(SAT, 2)];

    expect(legacyFixedRatio({
      from: MON, to: SUN, trainingDays: ['MON', 'WED', 'FRI'], executions,
    })).toBe(0);

    expect(pilotRatio({ from: MON, to: SUN, frequency: 3, executions })).toBe(1);
  });

  it('agreement is restored: training ON the recommended days scores the same under both', () => {
    const executions = [execution(MON, 0), execution(WED, 1), execution(FRI, 2)];
    expect(legacyFixedRatio({ from: MON, to: SUN, trainingDays: ['MON', 'WED', 'FRI'], executions })).toBe(1);
    expect(pilotRatio({ from: MON, to: SUN, frequency: 3, executions })).toBe(1);
  });
});

describe('it measures the goal, not the weekday', () => {
  it('missing one of three still costs exactly one third', () => {
    expect(pilotRatio({ from: MON, to: SUN, frequency: 3, executions: [execution(TUE, 0), execution(SAT, 1)] }))
      .toBeCloseTo(2 / 3, 10);
  });

  it('a seventh workout cannot buy back a week that was skipped', () => {
    // Week 1 (19–25/10): six days trained against a goal of 3 — capped at 3.
    // Week 2 (26/10–01/11): nothing. Expected 3 + 3; fulfilled 3 + 0.
    const week1 = [MON, TUE, WED, THU, FRI, SAT].map((date, index) => execution(date, index));
    expect(pilotRatio({ from: MON, to: '2026-11-01', frequency: 3, executions: week1 }))
      .toBeCloseTo(0.5, 10);
  });

  it('never exceeds 100%', () => {
    const all = [MON, TUE, WED, THU, FRI, SAT, SUN].map((date, index) => execution(date, index % 6));
    expect(pilotRatio({ from: MON, to: SUN, frequency: 3, executions: all })).toBe(1);
  });
});

describe('the week is the unit, and a partial week is honest about it', () => {
  it('a program activated mid-week expects only the days it actually had', () => {
    // Active from Friday: that week has 3 active days (FRI, SAT, SUN), so the
    // goal of 5 is capped at 3. Training Friday and Saturday is 2/3.
    expect(pilotRatio({ from: FRI, to: SUN, frequency: 5, executions: [execution(FRI, 0), execution(SAT, 1)] }))
      .toBeCloseTo(2 / 3, 10);
  });

  it('the week still in progress is not scored against days that have not happened', () => {
    // Monday and Tuesday only: goal 6 capped at 2 active days, both trained.
    expect(pilotRatio({ from: MON, to: TUE, frequency: 6, executions: [execution(MON, 0), execution(TUE, 1)] }))
      .toBe(1);
  });

  it('weeks are Monday-anchored, so Sunday belongs to the week that precedes it', () => {
    // SUN 25/10 closes the 19/10 week; MON 26/10 opens the next one.
    const executions = [execution(SUN, 0), execution('2026-10-26', 1)];
    // Two weeks, goal 1 each, one trained day each.
    expect(pilotRatio({ from: MON, to: '2026-11-01', frequency: 1, executions })).toBe(1);
  });
});

describe('days, not sessions', () => {
  it('two qualifying sessions on one day count as one day', () => {
    // Both are real and ledger-backed; the unit is still the day.
    const twice = [execution(TUE, 0), execution(TUE, 1)];
    expect(pilotRatio({ from: MON, to: SUN, frequency: 2, executions: twice }))
      .toBeCloseTo(0.5, 10);
  });

  it('counts the day the effort happened, not the day it was scheduled for', () => {
    // Scheduled Saturday, performed Thursday: the trained day is Thursday.
    const anticipated = [execution(SAT, 0, { performedLocalDate: THU })];
    expect(pilotRatio({ from: MON, to: SUN, frequency: 1, executions: anticipated })).toBe(1);
    // ...and it lands in Thursday's week, not a later one.
    expect(pilotRatio({ from: MON, to: THU, frequency: 1, executions: anticipated })).toBe(1);
  });
});

describe('what counts as training is unchanged', () => {
  it('accepts a PARTIALLY_COMPLETED session above the minimum set threshold', () => {
    const partial = [execution(TUE, 0, { status: 'PARTIALLY_COMPLETED', completedSets: 3 })];
    expect(pilotRatio({ from: MON, to: SUN, frequency: 1, executions: partial })).toBe(1);
  });

  it('rejects a partial below the threshold', () => {
    const tooLittle = [execution(TUE, 0, { status: 'PARTIALLY_COMPLETED', completedSets: 1 })];
    expect(pilotRatio({ from: MON, to: SUN, frequency: 1, executions: tooLittle })).toBe(0);
  });

  it('rejects ABANDONED and IN_PROGRESS', () => {
    for (const status of ['ABANDONED', 'IN_PROGRESS'] as const) {
      expect(pilotRatio({ from: MON, to: SUN, frequency: 1, executions: [execution(TUE, 0, { status })] }))
        .toBe(0);
    }
  });

  it('refuses an execution with no COMPLETED ledger event — fabrication stays impossible', () => {
    const weeklyTargets = buildFlexibleWeeklyTargets({
      countedActiveDates: activeDates(MON, SUN), prescribedTrainingFrequency: 1,
    });
    const fulfilled = countFulfilledWeeklyTrainedDays({
      programInstanceId: INSTANCE,
      executions: [execution(TUE, 0)],
      scheduleEvents: [],            // the ledger says nothing happened
      prescribedSessions: SESSIONS,
      weeklyTargets,
    });
    expect(fulfilled).toBe(0);
  });

  it('refuses an execution from another ProgramInstance', () => {
    const foreign = { ...execution(TUE, 0), programInstanceId: 'wpi_outro' };
    const weeklyTargets = buildFlexibleWeeklyTargets({
      countedActiveDates: activeDates(MON, SUN), prescribedTrainingFrequency: 1,
    });
    expect(countFulfilledWeeklyTrainedDays({
      programInstanceId: INSTANCE,
      executions: [foreign],
      scheduleEvents: [ledgerEvent(TUE, 0)],
      prescribedSessions: SESSIONS,
      weeklyTargets,
    })).toBe(0);
  });

  it('ignores effort outside the counted window instead of inventing a week for it', () => {
    const weeklyTargets = buildFlexibleWeeklyTargets({
      countedActiveDates: activeDates(MON, SUN), prescribedTrainingFrequency: 3,
    });
    const before = execution('2026-09-01', 0);
    expect(countFulfilledWeeklyTrainedDays({
      programInstanceId: INSTANCE,
      executions: [before],
      scheduleEvents: [ledgerEvent('2026-09-01', 0)],
      prescribedSessions: SESSIONS,
      weeklyTargets,
    })).toBe(0);
  });
});

describe('the progression contract is untouched', () => {
  it('70% remains the earning threshold and 85% the HIGH band', () => {
    // 7 of 10 and 85 of 100 are the exact boundaries; the rule change moves
    // what feeds them, never where they sit.
    expect(computeAdherence(7, 10).quality).toBe('GOOD');
    expect(computeAdherence(69, 100).quality).toBe('BELOW_TARGET');
    expect(computeAdherence(85, 100).quality).toBe('HIGH');
  });

  it('a pilot user training off-days now clears the threshold that used to block them', () => {
    const executions = [execution(TUE, 0), execution(THU, 1), execution(SAT, 2)];
    const legacy = legacyFixedRatio({ from: MON, to: SUN, trainingDays: ['MON', 'WED', 'FRI'], executions });
    const pilot = pilotRatio({ from: MON, to: SUN, frequency: 3, executions });
    expect(computeAdherence(0, 3).quality).toBe('BELOW_TARGET');   // o que acontecia
    expect(legacy).toBeLessThan(0.7);
    expect(pilot).toBeGreaterThanOrEqual(0.7);
  });
});
