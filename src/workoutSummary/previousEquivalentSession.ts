import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { performedLocalDateOf } from '../workoutExecution/types';

/**
 * "Most recent" ranking key. `performedLocalDate`/`scheduledLocalDate` are
 * civil-date strings (day granularity) — before `occurrence` existed, at
 * most one execution of a given `(sessionIndex, date)` was ever possible, so
 * day granularity was sufficient to totally order candidates. A `flexible`
 * schedule can now legitimately produce several same-day executions of the
 * SAME sessionIndex (occurrence 1, 2, 3...), which collapse to identical
 * dates — the real authority for "which happened later" is the execution's
 * own instant, never the id's occurrence suffix and never array order from
 * whatever Firestore query produced `executions`. `finishedAt` is the moment
 * the session actually ended (closest to "when this comparison point
 * happened"); `startedAt` is always present and is the correct fallback for
 * the rare terminal execution missing it.
 */
function executionOrderingKey(execution: PersistedWorkoutExecution): number {
  return (execution.finishedAt ?? execution.startedAt).toMillis();
}

/**
 * The most recent OTHER execution of the exact same workout slot
 * (`sessionIndex` within the same program instance — or, on legacy
 * executions with no `programInstanceId`, the same `programId`), used as
 * the baseline for "Pulso do treino". Never "any previous workout" — a
 * different session of the same program (e.g. Pull after Push) must never
 * be compared against.
 *
 * `executions` is expected to be the bounded list `LoadProgressContext`
 * already holds in memory (`listWorkoutExecutionsForLoadProgress`) — this
 * function performs no Firestore read of its own, avoiding a second query
 * for the same "last N executions" data.
 */
export function findPreviousEquivalentExecution(
  executions: readonly PersistedWorkoutExecution[],
  target: {
    programId: string;
    programInstanceId?: string;
    sessionIndex: number;
    excludeExecutionId: string;
  },
): PersistedWorkoutExecution | null {
  const candidates = executions.filter((execution) => {
    if (execution.executionId === target.excludeExecutionId) return false;
    if (execution.status !== 'COMPLETED' && execution.status !== 'PARTIALLY_COMPLETED') return false;
    if (execution.sessionIndex !== target.sessionIndex) return false;
    return target.programInstanceId
      ? execution.programInstanceId === target.programInstanceId
      : execution.programId === target.programId;
  });
  if (candidates.length === 0) return null;

  return candidates.reduce((latest, candidate) => {
    const candidateAt = executionOrderingKey(candidate);
    const latestAt = executionOrderingKey(latest);
    if (candidateAt !== latestAt) return candidateAt > latestAt ? candidate : latest;
    // Real instants tied (or both defaulted identically, e.g. in tests) —
    // `occurrence` is a deterministic, authoritative secondary key for a
    // same-day repeat (higher occurrence is strictly later in the user's
    // actual sequence); `performedLocalDate` string compare is the final,
    // pre-existing fallback for anything still tied after that.
    const candidateOccurrence = candidate.occurrence ?? 1;
    const latestOccurrence = latest.occurrence ?? 1;
    if (candidateOccurrence !== latestOccurrence) return candidateOccurrence > latestOccurrence ? candidate : latest;
    return performedLocalDateOf(candidate) > performedLocalDateOf(latest) ? candidate : latest;
  });
}
