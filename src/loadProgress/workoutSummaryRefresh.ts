import type { PersistedWorkoutExecution } from '../services/workoutExecutions';

export type WorkoutSummaryLoadProgressStatus = 'waiting' | 'refreshing' | 'ready' | 'error';

export interface WorkoutSummaryRefreshState {
  executionId: string | null;
  status: WorkoutSummaryLoadProgressStatus;
}

export const INITIAL_WORKOUT_SUMMARY_REFRESH_STATE: WorkoutSummaryRefreshState = {
  executionId: null,
  status: 'waiting',
};

export function isTerminalWorkoutSummaryExecution(
  execution: PersistedWorkoutExecution | null,
): execution is PersistedWorkoutExecution {
  return execution !== null
    && (execution.status === 'COMPLETED' || execution.status === 'PARTIALLY_COMPLETED')
    && execution.completion != null;
}

/**
 * Executes one real post-commit read. Callbacks are guarded by `isCurrent`, so
 * a uid change/unmount or a superseding request never performs stale setters.
 */
export async function executeWorkoutSummaryRefresh(input: {
  executionId: string;
  loadExecution: (executionId: string) => Promise<PersistedWorkoutExecution | null>;
  isCurrent: () => boolean;
  onFreshExecution: (execution: PersistedWorkoutExecution) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
}): Promise<'READY' | 'ERROR' | 'CANCELLED'> {
  try {
    const execution = await input.loadExecution(input.executionId);
    if (!input.isCurrent()) return 'CANCELLED';
    if (!isTerminalWorkoutSummaryExecution(execution)) {
      throw new Error('WORKOUT_SUMMARY_EXECUTION_NOT_TERMINAL');
    }
    input.onFreshExecution(execution);
    if (!input.isCurrent()) return 'CANCELLED';
    input.onReady();
    return 'READY';
  } catch (error) {
    if (!input.isCurrent()) return 'CANCELLED';
    input.onError(error);
    return 'ERROR';
  }
}
