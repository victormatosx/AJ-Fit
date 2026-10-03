import { useMemo } from 'react';

import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { buildWorkoutSummaryData, type WorkoutSummaryData } from '../workoutSummary/buildWorkoutSummaryData';
import { findPreviousEquivalentExecution } from '../workoutSummary/previousEquivalentSession';

/**
 * Builds the post-workout summary screen's data entirely from state
 * `LoadProgressContext` already holds in memory (mounted for the whole
 * active-workout flow for the live PR overlay) — no Firestore read of its
 * own, so opening this screen never costs a second query beyond what the
 * workout session already pays for.
 */
export function useWorkoutSummaryData(input: {
  workoutName: string;
  execution: PersistedWorkoutExecution | null | undefined;
  durationSeconds: number;
}): WorkoutSummaryData | null {
  const { execution, workoutName, durationSeconds } = input;
  const { executions, recordsLast90Days } = useLoadProgressState();

  return useMemo(() => {
    if (!execution) return null;

    const previousEquivalentExecution = findPreviousEquivalentExecution(executions, {
      programId: execution.programId,
      programInstanceId: execution.programInstanceId,
      sessionIndex: execution.sessionIndex,
      excludeExecutionId: execution.executionId,
    });

    return buildWorkoutSummaryData({
      workoutName,
      execution,
      durationSeconds,
      recordsLast90Days,
      previousEquivalentExecution,
    });
  }, [durationSeconds, execution, executions, recordsLast90Days, workoutName]);
}
