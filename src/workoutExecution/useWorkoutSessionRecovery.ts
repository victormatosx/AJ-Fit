import { useCallback, useEffect, useRef, useState } from 'react';
import { logWarn } from '../lib/logger';
import {
  loadActiveExecutionPointer,
  loadWorkoutExecution,
  type PersistedWorkoutExecution,
} from '../services/workoutExecutions';
import type { WorkoutExecutionStatePointer } from './types';

export type WorkoutSessionRecoveryState =
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'pending'; pointer: WorkoutExecutionStatePointer; execution: PersistedWorkoutExecution }
  /**
   * `current` points at an execution that no longer backs it up — either the
   * execution doc is gone (never produced by any write path in this module;
   * `workoutExecutions` deletes are always Rules-denied, so this is
   * defensive-only) or it's already terminal (COMPLETED/PARTIALLY_COMPLETED/
   * ABANDONED, e.g. another device finished it while this one was closed).
   * The terminal case self-heals via the normal `abandonWorkoutExecution`
   * call (Rules allow clearing `current` once the execution it names is
   * terminal); the missing-doc case cannot be cleared client-side at all —
   * Rules require reading the named execution to authorize the delete — so
   * it's surfaced as a safe, non-destructive dead end instead (docs §12).
   */
  | {
    status: 'inconsistent';
    reason: 'EXECUTION_MISSING' | 'EXECUTION_TERMINAL';
    pointer: WorkoutExecutionStatePointer;
    execution: PersistedWorkoutExecution | null;
  };

export interface WorkoutSessionRecoveryController {
  state: WorkoutSessionRecoveryState;
  /** Re-runs the bootstrap check against Firestore — call right before acting on "Continuar"/"Descartar" to guard against another device having changed things while the modal was open. */
  recheck: () => Promise<WorkoutSessionRecoveryState>;
  /** Locally dismisses the recovery UI once the pending session has been handled (continued, discarded, or acknowledged as unrecoverable) — never itself writes to Firestore. */
  resolve: () => void;
}

/**
 * Pure resolution of "what should Workout Recovery show for this uid right
 * now" — separated from the React hook below so it's directly testable
 * against the Firestore emulator with no rendering harness involved. Reads
 * only; never writes.
 */
export async function resolveWorkoutSessionRecoveryState(uid: string): Promise<WorkoutSessionRecoveryState> {
  const pointer = await loadActiveExecutionPointer(uid);
  if (!pointer) return { status: 'none' };
  const execution = await loadWorkoutExecution(uid, pointer.executionId);
  if (!execution) return { status: 'inconsistent', reason: 'EXECUTION_MISSING', pointer, execution: null };
  if (execution.status !== 'IN_PROGRESS') {
    return { status: 'inconsistent', reason: 'EXECUTION_TERMINAL', pointer, execution };
  }
  return { status: 'pending', pointer, execution };
}

/**
 * Proactive bootstrap detection for Workout Recovery (docs: Workout
 * Recovery / Resume após process death) — reads `workoutExecutionState/
 * current` as soon as `uid` is known, independent of the user ever tapping
 * "Iniciar treino". Scoped entirely by `uid`: a uid change (login as a
 * different account) resets straight back to `checking` before the new
 * account's pointer is fetched, so one account's pending session can never
 * render for another (docs §13) — this is defense-in-depth on top of
 * `AppShell` already fully unmounting (and this hook with it) on logout.
 *
 * A transient read failure falls back to `none` rather than surfacing an
 * error state — the persistent mutex guarantee itself does not depend on
 * this hook (a real pending execution is still caught by
 * `startOrResumeWorkoutExecution`'s own transaction the moment the user
 * tries to start a session), so this only ever affects how early/proactively
 * the recovery UI appears, never data integrity.
 */
export function useWorkoutSessionRecovery(uid: string | null): WorkoutSessionRecoveryController {
  const [state, setState] = useState<WorkoutSessionRecoveryState>(uid ? { status: 'checking' } : { status: 'none' });
  const uidRef = useRef(uid);
  uidRef.current = uid;

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setState({ status: 'none' });
      return undefined;
    }
    setState({ status: 'checking' });
    void (async () => {
      try {
        const next = await resolveWorkoutSessionRecoveryState(uid);
        if (!cancelled && uidRef.current === uid) setState(next);
      } catch (error) {
        logWarn('workout_execution', 'session_recovery_check_failed', { error });
        if (!cancelled && uidRef.current === uid) setState({ status: 'none' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const recheck = useCallback(async () => {
    if (!uid) return { status: 'none' as const };
    const next = await resolveWorkoutSessionRecoveryState(uid);
    if (uidRef.current === uid) setState(next);
    return next;
  }, [uid]);

  const resolve = useCallback(() => setState({ status: 'none' }), []);

  return { state, recheck, resolve };
}
