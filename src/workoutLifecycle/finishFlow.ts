/**
 * Integrity boundary shared by AppShell and unit tests. Schedule completion
 * can happen only after a durable terminal Execution snapshot exists.
 */
export async function completeWorkoutSessionFlow(input: {
  finishExecution: () => Promise<'COMPLETED' | 'PARTIALLY_COMPLETED' | null>;
  completeSchedule: () => Promise<boolean>;
  afterSchedule?: () => Promise<void>;
}): Promise<'EXECUTION_FAILED' | 'SCHEDULE_FAILED' | 'LIFECYCLE_FOLLOW_UP_FAILED' | 'COMPLETED'> {
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
