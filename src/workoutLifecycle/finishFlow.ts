/**
 * Integrity boundary shared by AppShell and unit tests. Schedule completion
 * can happen only after a durable terminal Execution snapshot exists.
 */
export type WorkoutCompletionResult =
  | 'EXECUTION_FAILED'
  | 'SCHEDULE_FAILED'
  | 'LIFECYCLE_FOLLOW_UP_FAILED'
  | 'COMPLETED';

export async function completeWorkoutSessionFlow(input: {
  finishExecution: () => Promise<'COMPLETED' | 'PARTIALLY_COMPLETED' | null>;
  completeSchedule: () => Promise<boolean>;
  afterSchedule?: () => Promise<void>;
}): Promise<WorkoutCompletionResult> {
  const executionStatus = await input.finishExecution();
  if (!executionStatus) return 'EXECUTION_FAILED';
  const scheduleCompleted = await input.completeSchedule();
  if (!scheduleCompleted) return 'SCHEDULE_FAILED';
  try {
    await input.afterSchedule?.();
  } catch {
    // Execution and Schedule are durable facts by this point. A lifecycle
    // follow-up is deliberately retryable and must never make a completed
    // workout look unfinished to the caller.
    return 'LIFECYCLE_FOLLOW_UP_FAILED';
  }
  return 'COMPLETED';
}

/**
 * The only two results for which leaving the completed-workout surface is
 * safe. In both cases Execution and Schedule are already durable; the latter
 * differs only in a retryable lifecycle/reconciliation follow-up.
 */
export function workoutCompletionAllowsHome(result: WorkoutCompletionResult): boolean {
  return result === 'COMPLETED' || result === 'LIFECYCLE_FOLLOW_UP_FAILED';
}

/**
 * Small behavior boundary used by AppShell: failure results must not run any
 * of its local teardown/navigation actions. Keeping this pure makes the
 * regression test assert behavior instead of source text.
 */
export function applyWorkoutCompletionNavigation(
  result: WorkoutCompletionResult,
  leaveWorkout: () => void,
): boolean {
  if (!workoutCompletionAllowsHome(result)) return false;
  leaveWorkout();
  return true;
}

/** Same-tick guard for the Done/Retry CTA; returns false for a reentrant call. */
export async function runWorkoutCompletionSingleFlight(
  guard: { current: boolean },
  task: () => Promise<void>,
): Promise<boolean> {
  if (guard.current) return false;
  guard.current = true;
  try {
    await task();
    return true;
  } finally {
    guard.current = false;
  }
}
