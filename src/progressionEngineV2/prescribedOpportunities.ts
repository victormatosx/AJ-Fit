import type { LocalDate } from '../scheduleEngine/calendar';
import type { Weekday } from '../state/AppState';
import { weekdayOfLocalDate } from '../scheduleEngine/calendar';
import { mondayOfWeek } from '../home/calendarWeek';
import { buildExpectedSessionIndexByDate } from './expectedSessionIndex';
import {
  isValidProgressionSessionAgainstPrescription,
  type PrescribedSessionShape,
} from './sessionQualification';

interface OpportunityExecution {
  programInstanceId?: string;
  sessionIndex: number;
  scheduledLocalDate: string;
  /**
   * The day the effort actually happened. Differs from `scheduledLocalDate`
   * only for anticipated/deferred legacy sessions; under the new training
   * model the two are always the same day. Optional so legacy documents
   * written before the field existed still load.
   */
  performedLocalDate?: string;
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

/** One Monday-anchoring definition for the whole app — the same one the Home
 * frequency widget uses, so a week never means two different things. */
const mondayOf = mondayOfWeek;

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

/**
 * Adherence accounting for accounts on the NEW training model.
 *
 * ## Why this exists
 *
 * The `fixed` accounting above asks "did you train on the days we named?".
 * It builds its denominator from the recommended weekdays and discards any
 * execution that lands outside them. That question is coherent for an account
 * whose calendar is an obligation — and incoherent for one whose calendar is
 * explicitly a suggestion. Under the new model a user may train any day, and
 * the app tells them so; scoring them against weekday identity afterwards
 * penalises exactly the freedom the model grants. Concretely: recommended
 * MON/WED/FRI, trained TUE/THU/SAT, weekly frequency 100%, adherence 0%.
 *
 * So for these accounts adherence asks the same question the weekly frequency
 * widget asks — "did you train as often as you meant to?" — and answers it
 * with the same unit: DISTINCT LOCAL DAYS TRAINED, per week, against the
 * prescribed frequency.
 *
 * ## The rule
 *
 *     meta(semana)     = min(frequência prescrita, dias ativos na semana)
 *     cumprido(semana) = min(meta(semana), dias distintos treinados na semana)
 *     ratio            = Σ cumprido / Σ meta
 *
 * The per-week cap on active days is what keeps a partial week honest: the
 * week a program starts mid-Thursday expects at most the days it actually
 * had, and the week still in progress expects at most the days elapsed. Weeks
 * are Monday-anchored local weeks, the same anchor the frequency widget uses.
 * Capping `cumprido` at the target is what stops a seventh workout from
 * paying for a week the user skipped.
 *
 * ## What still gates a day
 *
 * Every integrity guard of the `fixed`/`flexible` counters is preserved — this
 * function changes WHICH DAYS COUNT, never WHAT COUNTS AS TRAINING:
 *
 *  - the execution must belong to the active ProgramInstance;
 *  - a matching `COMPLETED` schedule-ledger event must exist, so an execution
 *    written by a modified client can never move adherence on its own;
 *  - `isValidProgressionSessionAgainstPrescription` must accept it, which is
 *    what admits `PARTIALLY_COMPLETED` only above the minimum set threshold
 *    and rejects `IN_PROGRESS`/`ABANDONED`.
 *
 * ## Days, not sessions
 *
 * The unit is the day: two qualifying sessions in one local day are one day,
 * which is why the per-week accumulator is a Set of DAYS and not of
 * `(date, sessionIndex)` keys. The day used is the day the effort happened
 * (`performedLocalDate`), falling back to `scheduledLocalDate` for documents
 * written before that field existed. The ledger lookup still uses the
 * scheduled key, because that is the key the ledger itself is written with.
 */
export function collectWeeklyTrainedDays(input: {
  programInstanceId: string;
  executions: readonly OpportunityExecution[];
  scheduleEvents: readonly OpportunityEvent[];
  prescribedSessions: readonly PrescribedSessionShape[];
  weeklyTargets: ReadonlyMap<LocalDate, number>;
}): ReadonlyMap<LocalDate, ReadonlySet<LocalDate>> {
  const completedLedger = new Set(input.scheduleEvents
    .filter((event) => event.type === 'COMPLETED' && event.programInstanceId === input.programInstanceId)
    .map((event) => opportunityKey(event.sessionIndex, event.scheduledDate)));
  const trainedDaysByWeek = new Map<LocalDate, Set<LocalDate>>();
  for (const execution of input.executions) {
    const prescribedSession = input.prescribedSessions[execution.sessionIndex];
    if (!prescribedSession) continue;
    if (!completedLedger.has(opportunityKey(execution.sessionIndex, execution.scheduledLocalDate))) continue;
    if (!isValidProgressionSessionAgainstPrescription({
      execution,
      prescribedSession,
      expectedProgramInstanceId: input.programInstanceId,
      expectedSessionIndex: execution.sessionIndex,
    })) continue;
    const trainedDay = execution.performedLocalDate ?? execution.scheduledLocalDate;
    const week = mondayOf(trainedDay);
    // A day outside the counted window has no target to pay into. Dropping it
    // here (rather than letting it create a week) is what keeps effort from
    // before the program — or during a paused stretch — out of the ratio.
    if (!input.weeklyTargets.has(week)) continue;
    const days = trainedDaysByWeek.get(week) ?? new Set<LocalDate>();
    days.add(trainedDay);
    trainedDaysByWeek.set(week, days);
  }
  return trainedDaysByWeek;
}

/**
 * `collectWeeklyTrainedDays`, capped per week and summed — the single-instance
 * form of the rule. A Training Cycle spanning several ProgramInstances must
 * UNION the day sets before capping (see
 * `src/progressionEngineV2/cycleProgression.ts`), otherwise two instances with
 * a record on the same date would pay into the same week twice.
 */
export function countFulfilledWeeklyTrainedDays(input: {
  programInstanceId: string;
  executions: readonly OpportunityExecution[];
  scheduleEvents: readonly OpportunityEvent[];
  prescribedSessions: readonly PrescribedSessionShape[];
  weeklyTargets: ReadonlyMap<LocalDate, number>;
}): number {
  const trainedDaysByWeek = collectWeeklyTrainedDays(input);
  let total = 0;
  for (const [week, target] of input.weeklyTargets) {
    total += Math.min(target, trainedDaysByWeek.get(week)?.size ?? 0);
  }
  return total;
}
