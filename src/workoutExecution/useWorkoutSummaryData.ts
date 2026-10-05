import { useCallback, useEffect, useMemo } from 'react';

import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { buildWorkoutSummaryData, type WorkoutSummaryData } from '../workoutSummary/buildWorkoutSummaryData';
import { findPreviousEquivalentExecution } from '../workoutSummary/previousEquivalentSession';
import type { WorkoutSummaryLoadProgressStatus } from '../loadProgress/workoutSummaryRefresh';

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
  completionConfirmed: boolean;
}): {
  data: WorkoutSummaryData | null;
  loadProgressStatus: WorkoutSummaryLoadProgressStatus;
  retryLoadProgress: () => void;
} {
  const { execution, workoutName, durationSeconds, completionConfirmed } = input;
  const {
    executions,
    recordsLast90Days,
    summaryRefresh,
    refreshExecutionForWorkoutSummary,
  } = useLoadProgressState();
  const executionId = execution?.executionId ?? null;
  const matchingRefresh = executionId !== null && summaryRefresh.executionId === executionId;

  const requestRefresh = useCallback(() => {
    if (!completionConfirmed || !executionId) return;
    void refreshExecutionForWorkoutSummary(executionId);
  }, [completionConfirmed, executionId, refreshExecutionForWorkoutSummary]);

  useEffect(() => {
    if (!completionConfirmed || !executionId) return;
    if (!matchingRefresh || summaryRefresh.status === 'waiting') requestRefresh();
  }, [completionConfirmed, executionId, matchingRefresh, requestRefresh, summaryRefresh.status]);

  const data = useMemo(() => {
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

  const loadProgressStatus: WorkoutSummaryLoadProgressStatus = !completionConfirmed || !executionId
    ? 'waiting'
    : matchingRefresh ? summaryRefresh.status : 'refreshing';

  return { data, loadProgressStatus, retryLoadProgress: requestRefresh };
}
