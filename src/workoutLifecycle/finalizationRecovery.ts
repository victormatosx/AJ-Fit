import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import type { WorkoutCompletion } from '../workoutExecution/types';

export type AuthoritativelyCommittedExecution = PersistedWorkoutExecution & {
  status: 'COMPLETED' | 'PARTIALLY_COMPLETED';
  completion: WorkoutCompletion;
};

/**
 * Reconciles an ambiguous callable failure from the two durable facts written
 * by the authoritative transaction. Neither fact alone is enough to unlock
 * completion UI.
 */
export async function loadAuthoritativelyCommittedFinalization(input: {
  executionId: string;
  loadExecution: (executionId: string) => Promise<PersistedWorkoutExecution | null>;
  hasCompletionEvent: (execution: PersistedWorkoutExecution) => Promise<boolean>;
}): Promise<AuthoritativelyCommittedExecution | null> {
  const execution = await input.loadExecution(input.executionId);
  if (!execution
    || (execution.status !== 'COMPLETED' && execution.status !== 'PARTIALLY_COMPLETED')
    || !execution.completion) return null;
  return await input.hasCompletionEvent(execution)
    ? execution as AuthoritativelyCommittedExecution
    : null;
}
