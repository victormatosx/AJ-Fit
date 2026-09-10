import type { FinalWorkoutSession } from '../workoutPrescription/types';
import { workoutExecutionDocumentId } from '../scheduleEngine/identities';

/**
 * Workout Execution & History V1 (docs/workout-lifecycle/09_WORKOUT_EXECUTION_AND_HISTORY.md).
 * Records what a user actually did in a session — never what the Program
 * Snapshot prescribes and never how the Schedule Engine picked the session.
 * Persist facts (actualReps, weightKg), not derived metrics (item §59).
 */

export type WorkoutExecutionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
export type SetExecutionStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export interface SetExecution {
  setIndex: number;
  status: SetExecutionStatus;
  /** Only meaningful for rep-based prescriptions. */
  actualReps: number | null;
  /** kg, always the canonical unit — never a display unit. 0 is a valid logged value (bodyweight). */
  weightKg: number | null;
  /** Only meaningful for duration-based prescriptions. */
  actualDurationSeconds: number | null;
}

/**
 * A minimal snapshot of the prescription for this exercise slot — enough to
 * reconstruct "what was prescribed" for history without re-reading (or being
 * broken by) a Program Snapshot that may later be superseded. Never the
 * source of truth for the prescription itself.
 */
export interface ExerciseExecution {
  /** Position in `session.exercises[]` at the time this Execution was created — the only stable slot identity the Prescription Engine provides. */
  exerciseIndex: number;
  /** Final, post-substitution exercise id already prescribed to the user (never re-resolved via modifiers). */
  exerciseId: string;
  prescribedSets: number | null;
  prescribedReps: string | null;
  prescribedDuration: string | null;
  prescribedCycles: number | null;
  sets: SetExecution[];
}

export const WORKOUT_EXECUTION_SCHEMA_VERSION = 1;
export const WORKOUT_EXECUTION_LIFECYCLE_SCHEMA_VERSION = 2;

/**
 * P0-C protocol marker (2026-09, docs/workout-lifecycle/ hardening plan):
 * distinguishes a client that follows the `workoutExecutionState/current`
 * mutex protocol from one that doesn't. Written on every NEW `IN_PROGRESS`
 * creation by this module (`startOrResumeWorkoutExecution`) — never present
 * on a pre-P0 client's write, since that code has no knowledge of this
 * field. This is the only reliable "old vs new protocol" signal: it is NOT
 * an app version number (the app version itself is never plumbed into
 * Firestore Rules) — it is a fact about which write path produced this
 * exact document. Used for (a) observability (how many executions are still
 * being created by an unpatched client) and (b) as the value Firestore
 * Rules check once the `workoutExecutionProtocolConfig/active` hardening
 * flag is turned on (see `firestore.rules`'s `workoutExecutionMutexHardeningEnabled()`).
 */
export const WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION = 1;

/**
 * P0 integrity fix (2026-09): `users/{uid}/workoutExecutionState/current` —
 * a single, fixed-id document that acts as both a persistent mutex and a
 * pointer to whichever WorkoutExecution is legitimately IN_PROGRESS.
 * Existence of this document IS the authority: a user has an active
 * execution iff this doc exists. Because Firestore allows only one document
 * at a fixed path, "at most one active execution" is enforced by
 * construction — never by a query-then-write race. Created/deleted
 * atomically alongside the WorkoutExecution it tracks, in the SAME
 * transaction that starts/finishes/abandons that execution (see
 * `src/services/workoutExecutions.ts`). Delete is ALWAYS Rules-tied to the
 * referenced execution actually being terminal via `getAfter()`. Create is
 * Rules-tied to a real, matching, IN_PROGRESS execution via `getAfter()`
 * only once the `workoutExecutionProtocolConfig/active` hardening flag is
 * on (P0-C, 2026-09) — before that, a pre-P0 client can still write
 * `workoutExecutions` directly without this pointer at all; see
 * `WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION`'s doc comment and
 * `firestore.rules`'s `workoutExecutionMutexHardeningEnabled()`.
 */
export const WORKOUT_EXECUTION_STATE_SCHEMA_VERSION = 1;

export interface WorkoutExecutionStatePointer {
  executionId: string;
  programId: string;
  programInstanceId: string | null;
  sessionIndex: number;
  scheduledLocalDate: string;
  /** Always 'IN_PROGRESS' while this document exists — its existence, not this field, is the authority. */
  status: 'IN_PROGRESS';
  schemaVersion: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface WorkoutExecution {
  executionId: string;
  /** V1 content identity retained for prescription lookup/backward compatibility. */
  programId: string;
  /** V2 lifecycle namespace. Absent only on legacy executions. */
  programInstanceId?: string;
  templateId: string;
  sessionIndex: number;
  sessionName: string;
  /** Local calendar date (YYYY-MM-DD) this execution corresponds to — the same date passed to the Schedule Engine's `completeScheduledSession`. */
  scheduledLocalDate: string;
  status: WorkoutExecutionStatus;
  startedAt: unknown;
  finishedAt: unknown | null;
  exercises: ExerciseExecution[];
  executionSchemaVersion: number;
  /** P0-C protocol marker — see `WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION`'s doc comment. Absent on every pre-P0-C write. */
  mutexProtocolVersion?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Deterministic — a retried "start workout" (double tap, network retry, cold start) lands on the same doc instead of creating a duplicate execution (docs §22 Idempotência). */
export function workoutExecutionId(programOrInstanceId: string, sessionIndex: number, scheduledLocalDate: string): string {
  return workoutExecutionDocumentId(programOrInstanceId, sessionIndex, scheduledLocalDate);
}

/**
 * Builds the initial, all-PENDING exercise/set snapshot for a freshly
 * started (or restarted-after-abandon) execution. Set count mirrors
 * `WorkoutScreen`'s existing materialization (`prescribed.sets ?? 1`) so both
 * layers agree on how many sets a duration/cycles-based exercise has.
 */
export function buildInitialExerciseExecutions(session: FinalWorkoutSession): ExerciseExecution[] {
  return session.exercises.map((exercise, exerciseIndex) => {
    const setCount = exercise.sets ?? 1;
    return {
      exerciseIndex,
      exerciseId: exercise.exerciseId,
      prescribedSets: exercise.sets ?? null,
      prescribedReps: exercise.reps ?? null,
      prescribedDuration: exercise.duration ?? null,
      prescribedCycles: exercise.cycles ?? null,
      sets: Array.from({ length: setCount }, (_, setIndex): SetExecution => ({
        setIndex,
        status: 'PENDING',
        actualReps: null,
        weightKg: null,
        actualDurationSeconds: null,
      })),
    };
  });
}

/** Every PENDING set becomes SKIPPED — the implicit skip when a user finishes a session without touching it (docs §34/§37). Already-COMPLETED/SKIPPED sets are left exactly as recorded. */
export function sweepPendingSetsToSkipped(exercises: ExerciseExecution[]): ExerciseExecution[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => (set.status === 'PENDING' ? { ...set, status: 'SKIPPED' as const } : set)),
  }));
}

/** COMPLETED only if every set in every exercise was actually completed — any skip (explicit or swept-in-at-finish) makes it PARTIALLY_COMPLETED. Both count as a finished session for the Schedule Engine (docs §35). */
export function deriveFinishStatus(exercises: ExerciseExecution[]): 'COMPLETED' | 'PARTIALLY_COMPLETED' {
  const allCompleted = exercises.every((exercise) => exercise.sets.every((set) => set.status === 'COMPLETED'));
  return allCompleted ? 'COMPLETED' : 'PARTIALLY_COMPLETED';
}

/** Used to gate the "some exercises weren't finished" confirmation before an early finish (docs §37). */
export function hasPendingSets(exercises: ExerciseExecution[]): boolean {
  return exercises.some((exercise) => exercise.sets.some((set) => set.status === 'PENDING'));
}
