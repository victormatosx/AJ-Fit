import type { LocalDate } from '../scheduleEngine/calendar';
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
  exercises: ReadonlyArray<{
    exerciseIndex?: number;
    exerciseId?: string;
    sets: ReadonlyArray<{ setIndex?: number; status: 'PENDING' | 'COMPLETED' | 'SKIPPED' }>;
  }>;
}

export interface PrescribedOpportunity {
  scheduledLocalDate: LocalDate;
  programInstanceId: string;
}

interface OpportunityEvent {
  type: 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED';
  programInstanceId?: string;
  sessionIndex: number;
  scheduledDate: string;
}

function opportunityKey(sessionIndex: number, localDate: string): string {
  return `${localDate}:${sessionIndex}`;
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
