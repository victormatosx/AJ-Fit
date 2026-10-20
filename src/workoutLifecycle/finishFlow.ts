import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import type { WorkoutFinalizationMode } from '../services/finalizeWorkoutSession';

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

export function shouldRetryWorkoutCompletionOnForeground(input: {
  appState: string;
  workoutInProgress: boolean;
  finishing: boolean;
  result: WorkoutCompletionResult | null;
}): boolean {
  return input.appState === 'active'
    && input.workoutInProgress
    && !input.finishing
    && (input.result === 'EXECUTION_FAILED' || input.result === 'SCHEDULE_FAILED');
}

/**
 * Mirrors WorkoutScreen's existing completion semantics for a persisted
 * cold-start recovery snapshot. An execution with pending strength work, or
 * an unsettled cardio finisher, is the same "finalizar agora"/EARLY action
 * the live exit sheet uses. A fully-settled execution keeps the normal
 * completion mode. No progress is synthesized here; the server remains the
 * authority for validating and terminalizing the referenced execution.
 */
export function recoveryFinalizationMode(
  execution: PersistedWorkoutExecution,
  hasCardioFinisher: boolean,
): WorkoutFinalizationMode {
  // A lost response can leave the modal open even though the backend already
  // committed a terminal execution. Preserve that immutable decision on the
  // idempotent retry (notably, EARLY must still end any cardio Live Activity).
  if (execution.finalizationMode) return execution.finalizationMode;
  const hasPendingSet = execution.exercises.some((exercise) =>
    exercise.sets.some((set) => set.status === 'PENDING'));
  const cardioSettled = execution.cardio?.status === 'COMPLETED'
    || execution.cardio?.status === 'SKIPPED';
  return hasPendingSet || (hasCardioFinisher && !cardioSettled) ? 'EARLY' : 'NORMAL';
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

export interface WorkoutHomeProjectionSyncOutcome {
  schedule: 'COMPLETED' | 'FAILED';
  week: 'COMPLETED' | 'FAILED';
  frequency: 'COMPLETED' | 'FAILED';
  streak: 'COMPLETED' | 'FAILED';
}

export type WorkoutDiscardProjectionSyncOutcome = 'COMPLETED' | 'FAILED';
export type WorkoutDiscardResult = { ok: true } | { ok: false; error: unknown };

/**
 * Recomputes the one client projection that depends on an execution being
 * IN_PROGRESS after abandon has already committed. A projection failure is
 * secondary: report it, preserve the durable ABANDONED fact, and let the
 * caller leave WorkoutScreen. Cold-start/foreground reconciliation remains
 * the retry path for the retained projection.
 */
export async function runWorkoutDiscardProjectionSync(input: {
  refreshProjection: () => Promise<void>;
  onFailure?: (error: unknown) => void;
}): Promise<WorkoutDiscardProjectionSyncOutcome> {
  try {
    await input.refreshProjection();
    return 'COMPLETED';
  } catch (error) {
    try {
      input.onFailure?.(error);
    } catch {
      // Diagnostics must never turn a handled projection failure into a
      // navigation blocker after abandon is already durable.
    }
    return 'FAILED';
  }
}

/**
 * Durable discard boundary. Projection work is never attempted when abandon
 * fails; once abandon succeeds, projection failure is deliberately absorbed
 * so the caller can navigate without undoing or contradicting Firestore.
 */
export async function runWorkoutDiscardFlow(input: {
  abandon: () => Promise<WorkoutDiscardResult>;
  refreshProjection: () => Promise<void>;
  onProjectionFailure?: (error: unknown) => void;
}): Promise<WorkoutDiscardResult> {
  const abandoned = await input.abandon();
  if (!abandoned.ok) return abandoned;
  await runWorkoutDiscardProjectionSync({
    refreshProjection: input.refreshProjection,
    onFailure: input.onProjectionFailure,
  });
  return abandoned;
}

/**
 * Refreshes the four projections that must be coherent before the
 * persistent Home surface becomes visible again. Callers start this after
 * durable completion and may await the same Promise at the success -> Home
 * boundary; it is deliberately independent from lifecycle/evolution work.
 */
export async function runWorkoutHomeProjectionSync(input: {
  refreshSchedule: () => Promise<unknown>;
  refreshWeek: () => Promise<void>;
  refreshFrequency: () => Promise<void>;
  /** Resolved value is ignored here; `unknown` lets the caller return the freshly-read streak for its own milestone check. */
  refreshStreak: () => Promise<unknown>;
}): Promise<WorkoutHomeProjectionSyncOutcome> {
  const [schedule, week, frequency, streak] = await Promise.allSettled([
    input.refreshSchedule(),
    input.refreshWeek(),
    input.refreshFrequency(),
    input.refreshStreak(),
  ]);
  return {
    schedule: schedule.status === 'fulfilled' ? 'COMPLETED' : 'FAILED',
    week: week.status === 'fulfilled' ? 'COMPLETED' : 'FAILED',
    frequency: frequency.status === 'fulfilled' ? 'COMPLETED' : 'FAILED',
    streak: streak.status === 'fulfilled' ? 'COMPLETED' : 'FAILED',
  };
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
