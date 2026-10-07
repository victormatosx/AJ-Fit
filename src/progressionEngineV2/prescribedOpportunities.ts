import { addDaysLocal, type LocalDate } from '../scheduleEngine/calendar';
import type { Weekday } from '../state/AppState';
import { weekdayOfLocalDate } from '../scheduleEngine/calendar';
import { buildExpectedSessionIndexByDate } from './expectedSessionIndex';
import {
  isValidProgressionSessionAgainstPrescription,
  type PrescribedSessionShape,
} from './sessionQualification';

interface OpportunityExecution {
  programInstanceId?: string;
  sessionIndex: number;
  scheduledLocalDate: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
  exercises: readonly {
    exerciseIndex?: number;
    exerciseId?: string;
    sets: readonly { setIndex?: number; status: 'PENDING' | 'COMPLETED' | 'SKIPPED' }[];
  }[];
}

export interface PrescribedOpportunity {
  scheduledLocalDate: LocalDate;
  programInstanceId: string;
}

interface OpportunityEvent {
  type: 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED' | 'REPOSITIONED';
  programInstanceId?: string;
  sessionIndex: number;
  scheduledDate: string;
}

function opportunityKey(sessionIndex: number, localDate: string): string {
  return `${localDate}:${sessionIndex}`;
}

const WEEKDAY_OFFSET_FROM_MONDAY: Record<Weekday, number> = {
  MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6,
};

function mondayOf(date: LocalDate): LocalDate {
  return addDaysLocal(date, -WEEKDAY_OFFSET_FROM_MONDAY[weekdayOfLocalDate(date)]);
}

/** Weekly prescription targets for flexible plans. Dates only delimit local
 * weeks; they never make a particular weekday mandatory. The current partial
 * week expects at most one opportunity per elapsed active day. */
export function buildFlexibleWeeklyTargets(input: {
  countedActiveDates: ReadonlySet<LocalDate>;
  prescribedTrainingFrequency: number;
}): ReadonlyMap<LocalDate, number> {
  const activeDaysByWeek = new Map<LocalDate, number>();
  for (const date of input.countedActiveDates) {
    const week = mondayOf(date);
    activeDaysByWeek.set(week, (activeDaysByWeek.get(week) ?? 0) + 1);
  }
  return new Map([...activeDaysByWeek.entries()].map(([week, activeDays]) => [
    week,
    Math.min(input.prescribedTrainingFrequency, activeDays),
  ]));
}

/** Counts real qualifying flexible completions, capped by each week's target.
 * A COMPLETED ledger fact is still required, so client-only/fabricated
 * executions never influence progression. */
export function countFulfilledFlexibleWeeklyTargets(input: {
  programInstanceId: string;
  executions: readonly OpportunityExecution[];
  scheduleEvents: readonly OpportunityEvent[];
  prescribedSessions: readonly PrescribedSessionShape[];
  weeklyTargets: ReadonlyMap<LocalDate, number>;
}): number {
  const completedLedger = new Set(input.scheduleEvents
    .filter((event) => event.type === 'COMPLETED' && event.programInstanceId === input.programInstanceId)
    .map((event) => opportunityKey(event.sessionIndex, event.scheduledDate)));
  const fulfilledByWeek = new Map<LocalDate, Set<string>>();
  for (const execution of input.executions) {
    const week = mondayOf(execution.scheduledLocalDate);
    if (!input.weeklyTargets.has(week)) continue;
    const prescribedSession = input.prescribedSessions[execution.sessionIndex];
    const key = opportunityKey(execution.sessionIndex, execution.scheduledLocalDate);
    if (!completedLedger.has(key) || !prescribedSession) continue;
    if (!isValidProgressionSessionAgainstPrescription({
      execution,
      prescribedSession,
      expectedProgramInstanceId: input.programInstanceId,
      expectedSessionIndex: execution.sessionIndex,
    })) continue;
    const fulfilled = fulfilledByWeek.get(week) ?? new Set<string>();
    fulfilled.add(key);
    fulfilledByWeek.set(week, fulfilled);
  }
  let total = 0;
  for (const [week, target] of input.weeklyTargets) {
    total += Math.min(target, fulfilledByWeek.get(week)?.size ?? 0);
  }
  return total;
}

/**
 * Credits only schedule-ledger opportunities that have a matching qualifying
 * execution for the active ProgramInstance. Both sides are deduplicated by
 * (scheduled local date, session index), so an extra workout has no credit
 * without a prescribed COMPLETED event and one opportunity can contribute at
 * most one session even if malformed/legacy data contains duplicates.
 */
export function countFulfilledPrescribedOpportunities(input: {
  programInstanceId: string;
  executions: readonly OpportunityExecution[];
  scheduleEvents: readonly OpportunityEvent[];
  prescribedOpportunities: readonly PrescribedOpportunity[];
  prescribedSessions: readonly PrescribedSessionShape[];
  trainingDays: readonly Weekday[];
}): number {
  const ownOpportunities = input.prescribedOpportunities
    .filter((opportunity) => opportunity.programInstanceId === input.programInstanceId);
  const prescribedDates = new Set(ownOpportunities.map((opportunity) => opportunity.scheduledLocalDate));
  const sortedDates = [...prescribedDates].sort();
  const expectedIndexByDate = buildExpectedSessionIndexByDate({
    programInstanceId: input.programInstanceId,
    prescribedDates: sortedDates,
    trainingDays: input.trainingDays,
    sessionCount: input.prescribedSessions.length,
    rotationEvents: input.scheduleEvents.map((event) => ({
      type: event.type,
      programInstanceId: event.programInstanceId,
      sessionIndex: event.sessionIndex,
      scheduledDate: event.scheduledDate,
    })),
  });
  const qualifyingExecutionKeys = new Set<string>();
  for (const execution of input.executions) {
    if (!prescribedDates.has(execution.scheduledLocalDate)) continue;
    const expectedSessionIndex = expectedIndexByDate.get(execution.scheduledLocalDate);
    if (expectedSessionIndex === undefined) continue;
    if (!isValidProgressionSessionAgainstPrescription({
      execution,
      prescribedSession: input.prescribedSessions[expectedSessionIndex],
      expectedProgramInstanceId: input.programInstanceId,
      expectedSessionIndex,
    })) continue;
    qualifyingExecutionKeys.add(opportunityKey(expectedSessionIndex, execution.scheduledLocalDate));
  }
  const fulfilled = new Set<string>();
  for (const event of input.scheduleEvents) {
    if (event.type !== 'COMPLETED' || event.programInstanceId !== input.programInstanceId) continue;
    const key = opportunityKey(event.sessionIndex, event.scheduledDate);
    if (qualifyingExecutionKeys.has(key)) fulfilled.add(key);
  }
  return fulfilled.size;
}


/** Enumerates the real prescribed calendar opportunities in the effective active window. */
export function buildPrescribedOpportunities(input: {
  programInstanceId: string;
  trainingDays: readonly Weekday[];
  countedActiveDates: ReadonlySet<LocalDate>;
}): PrescribedOpportunity[] {
  const trainingDays = new Set(input.trainingDays);
  return [...input.countedActiveDates]
    .filter((date) => trainingDays.has(weekdayOfLocalDate(date)))
    .sort()
    .map((scheduledLocalDate) => ({
      scheduledLocalDate,
      programInstanceId: input.programInstanceId,
    }));
}
