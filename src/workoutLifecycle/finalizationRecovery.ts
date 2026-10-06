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

/**
 * Authoritative "does this prescribed session have a cardio finisher" check
 * for workout-finish recovery — reads the SAME program document
 * (`workoutPrograms/{programId}`) the backend's own `finalizeWorkoutSession`
 * preflight re-derives its cardio requirement from (functions/src/
 * workoutLifecycle/finalizeWorkoutSession.ts), never AppShell's in-memory
 * `activeProgram`.
 *
 * Root-cause audit (2026-10): a stale/divergent `activeProgram` was the only
 * reachable path that could send `mode=NORMAL` with no cardio payload while
 * the backend still required one, producing `CARDIO_COMPLETION_REQUIRED` on
 * every identical retry. This closes that gap at the source — the call site
 * (`AppShell.tsx`'s `handleFinishRecovery`) decides `EARLY` vs `NORMAL` from
 * this function's result instead of a locally cached session.
 *
 * Returns `null` on any read failure — a missing program document, content
 * that fails shape validation, an out-of-range `sessionIndex`, or a
 * network/permission error. The caller must treat `null` as "unknown,"
 * never silently as "no cardio finisher" (that is exactly the divergence
 * this function exists to remove).
 */
export async function resolveAuthoritativeCardioFinisherPresence(input: {
  programId: string;
  sessionIndex: number;
  loadProgram: (programId: string) => Promise<{ sessions: readonly { cardioFinisher?: unknown }[] } | null>;
}): Promise<boolean | null> {
  try {
    const program = await input.loadProgram(input.programId);
    const session = program?.sessions[input.sessionIndex];
    return session === undefined ? null : !!session.cardioFinisher;
  } catch {
    return null;
  }
}
