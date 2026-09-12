/**
 * Integrity boundary shared by AppShell and unit tests. Schedule completion
 * can happen only after a durable terminal Execution snapshot exists.
 */
export type WorkoutCompletionResult =
  | 'EXECUTION_FAILED'
  | 'SCHEDULE_FAILED'
  | 'LIFECYCLE_FOLLOW_UP_FAILED'
  | 'COMPLETED';

export interface WorkoutCompletionAttemptRef {
  current: Promise<WorkoutCompletionResult> | null;
}

/**
 * Keeps exactly one completion attempt in flight. A settled Promise is never
 * retained: a recoverable result must permit a genuinely new attempt over the
 * same durable Execution, while a double tap during the attempt reuses it.
 */
export function runWorkoutCompletionAttempt(
  ref: WorkoutCompletionAttemptRef,
  task: () => Promise<WorkoutCompletionResult>,
): Promise<WorkoutCompletionResult> {
  if (ref.current) return ref.current;

  // Start on the next microtask so the ref is installed before any callback
  // can settle (including a synchronous test double or an immediate failure).
  const attempt = Promise.resolve().then(task);
  ref.current = attempt;
  const release = () => {
    if (ref.current === attempt) ref.current = null;
  };
  void attempt.then(release, release);
  return attempt;
}

export async function completeWorkoutSessionFlow(input: {
  finishExecution: () => Promise<'COMPLETED' | 'PARTIALLY_COMPLETED' | null>;
  completeSchedule: () => Promise<boolean>;
}): Promise<WorkoutCompletionResult> {
  const executionStatus = await input.finishExecution();
  if (!executionStatus) return 'EXECUTION_FAILED';
  const scheduleCompleted = await input.completeSchedule();
  if (!scheduleCompleted) return 'SCHEDULE_FAILED';
  // This is the durable-completion boundary: finishExecution has committed
  // the terminal Execution + mutex release, and completeSchedule has
  // committed the Schedule event/state. Lifecycle reconciliation and UI
  // projections are intentionally orchestrated after this Promise resolves.
  return 'COMPLETED';
}

export interface WorkoutCompletionFollowUpOutcome {
  lifecycle: 'COMPLETED' | 'FAILED';
  projections: 'COMPLETED' | 'FAILED';
}

/**
 * Runs the single post-workout lifecycle pipeline outside the durable finish
 * critical path. Every rejection is consumed and reported through the
 * optional callbacks, so callers can retain the returned Promise without an
 * unhandled rejection. Cold-start/foreground reconciliation remains the
 * durable retry mechanism if this best-effort in-process attempt fails or
 * the process is terminated.
 */
export async function runWorkoutCompletionFollowUp(input: {
  reconcileLifecycle: () => Promise<void>;
  refreshProjections: () => Promise<void>;
  onLifecycleFailure?: (error: unknown) => void;
  onProjectionFailure?: (error: unknown) => void;
}): Promise<WorkoutCompletionFollowUpOutcome> {
  const reportFailure = (handler: ((error: unknown) => void) | undefined, error: unknown) => {
    try {
      handler?.(error);
    } catch {
      // Observability must never resurrect a handled background rejection.
    }
  };
  let lifecycle: WorkoutCompletionFollowUpOutcome['lifecycle'] = 'COMPLETED';
  let projections: WorkoutCompletionFollowUpOutcome['projections'] = 'COMPLETED';
  try {
    await input.reconcileLifecycle();
  } catch (error) {
    lifecycle = 'FAILED';
    reportFailure(input.onLifecycleFailure, error);
  }
  try {
    await input.refreshProjections();
  } catch (error) {
    projections = 'FAILED';
    reportFailure(input.onProjectionFailure, error);
  }
  return { lifecycle, projections };
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
