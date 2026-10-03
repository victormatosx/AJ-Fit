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

/**
 * Cardio Finisher Completion Recovery hardening (2026-09): the durable,
 * server-side answer to "was this execution's cardio finisher completed" —
 * never derived from the local timer (`lib/cardioTimer.ts`'s `CardioSession`,
 * AsyncStorage-only) or from transient React state. `COMPLETED` is written
 * when the user confirms "Finalizar cardio"; `SKIPPED/EARLY_FINISH` is
 * written only by the official workout finalizer when the user explicitly
 * ends the workout before cardio. There is no persisted
 * `NOT_STARTED`/`IN_PROGRESS` value. Absent (`null`) remains the "not settled
 * yet" state and is also how executions written before this field existed
 * degrade (`fromDoc` in `services/workoutExecutions.ts`).
 */
export type CardioExecutionStatus = 'COMPLETED' | 'SKIPPED';

export interface CompletedCardioExecutionRecord {
  status: 'COMPLETED';
  /** Frozen the instant cardio was marked complete — same semantics as `CardioSession.actualDurationSeconds` (`lib/cardioTimer.ts`). Never a tick count. */
  actualDurationSeconds: number;
  /** `FieldValue.serverTimestamp()` sentinel when writing, a resolved `Timestamp` when read back. */
  completedAt: unknown;
  reason?: never;
  skippedAt?: never;
}

export interface SkippedCardioExecutionRecord {
  status: 'SKIPPED';
  reason: 'EARLY_FINISH';
  /** `FieldValue.serverTimestamp()` sentinel when writing, a resolved `Timestamp` when read back. */
  skippedAt: unknown;
  actualDurationSeconds?: never;
  completedAt?: never;
}

export type CardioExecutionRecord = CompletedCardioExecutionRecord | SkippedCardioExecutionRecord;

export interface WorkoutCompletion {
  /** Set opportunities frozen from the server-validated prescription. */
  plannedSets: number;
  /** Only sets durably recorded as COMPLETED. */
  completedSets: number;
  /** Integer percentage in hundredths of one percent (0..10000). */
  percentageBasisPoints: number;
}

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
/**
 * Exercise-substitution architecture audit / Manual Substitution feature:
 * `scope: 'SESSION'` never survives past this one execution (the anchor's
 * `prescribedExerciseId` is what any future execution re-materializes
 * against); `'PERMANENT'` is only a record of WHY this slot's `exerciseId`
 * changed — the durable preference itself lives in
 * `users/{uid}/exerciseSubstitutionPreferences/{prescribedExerciseId}`, never
 * only here. `appliedAt` is a plain `Timestamp` value (never
 * `FieldValue.serverTimestamp()`), because Firestore does not support server
 * timestamp sentinels inside array elements — `exercises` is a plain array.
 */
export interface ExerciseExecutionSubstitution {
  scope: 'SESSION' | 'PERMANENT';
  appliedAt: unknown;
}

export interface ExerciseExecution {
  /** Position in `session.exercises[]` at the time this Execution was created — the only stable slot identity the Prescription Engine provides. */
  exerciseIndex: number;
  /**
   * The exercise this slot's sets are actually logged against right now —
   * the engine's post-substitution id at creation time, and (Manual
   * Substitution feature) mutable afterward via `applyExerciseSubstitution`
   * ONLY while no set in this slot has been recorded yet. Never re-resolved
   * by prescription modifiers after creation.
   */
  exerciseId: string;
  /**
   * The exercise originally prescribed for this slot at creation time —
   * immutable for the lifetime of this execution. Absent on every execution
   * created before the Manual Substitution feature existed; callers needing
   * "what was prescribed" on a legacy execution must fall back to `exerciseId`
   * (see `prescribedExerciseIdOf`), since pre-feature `exerciseId` never
   * changed after creation anyway.
   */
  prescribedExerciseId?: string;
  /** Present only once a manual substitution has been applied to this slot. */
  substitution?: ExerciseExecutionSubstitution;
  prescribedSets: number | null;
  prescribedReps: string | null;
  prescribedDuration: string | null;
  prescribedCycles: number | null;
  sets: SetExecution[];
}

/** "Foi prescrito A e executado B" — the single place that answers this for both legacy (no `prescribedExerciseId`) and current executions. */
export function prescribedExerciseIdOf(exercise: Pick<ExerciseExecution, 'exerciseId' | 'prescribedExerciseId'>): string {
  return exercise.prescribedExerciseId ?? exercise.exerciseId;
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
  /**
   * Local date on which the activity actually took place. The prescribed
   * opportunity remains `scheduledLocalDate`; legacy executions omit this
   * field and are displayed as if both dates were equal.
   */
  performedLocalDate?: string;
  status: WorkoutExecutionStatus;
  startedAt: unknown;
  finishedAt: unknown | null;
  exercises: ExerciseExecution[];
  /**
   * Durable cardio-finisher completion record for this execution — see
   * `CardioExecutionRecord`'s doc comment. `null` until
   * `completeCardioExecution` runs, including forever on an execution whose
   * session has no cardio finisher at all (nothing ever writes it). Never
   * read as "this session has a cardio finisher" — that fact comes only
   * from `FinalWorkoutSession.cardioFinisher` (the plan), never from this
   * execution record.
   */
  cardio: CardioExecutionRecord | null;
  /**
   * Server-authoritative terminal completion facts. Optional only for
   * executions finalized before this field existed; historical readers may
   * derive a safe fallback from the immutable set snapshot.
   */
  completion?: WorkoutCompletion;
  /**
   * 1-based disambiguator for a `flexible` schedule repeating the same
   * sessionIndex on the same `scheduledLocalDate` (docs — agenda livre
   * multiple-sessions-per-day). Absent on every execution written before
   * this field existed and on every `fixed`-schedule execution — both
   * degrade identically to `1`, the implicit first/only occurrence. Never
   * recompute this from the id string; it is the single source of truth the
   * finalizer's schedule-event identity derives from.
   */
  occurrence?: number;
  /**
   * The finalization intent actually used to terminalize this execution —
   * persisted explicitly so `PARTIALLY_COMPLETED` is never conflated with
   * "the user tapped Finalizar antes". A plain `NORMAL` finish can also land
   * on `PARTIALLY_COMPLETED` if sets were skipped along the way, so `status`
   * alone can never answer "was this an early finish". Absent on every
   * execution finalized before this field existed and on every still
   * `IN_PROGRESS`/`ABANDONED` execution — absence must never be read as
   * `'EARLY'` (nor as `'NORMAL'`): a surface that cares must check
   * `=== 'EARLY'` explicitly, never infer from `!== 'EARLY'` or from `status`.
   */
  finalizationMode?: 'NORMAL' | 'EARLY';
  executionSchemaVersion: number;
  /** P0-C protocol marker — see `WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION`'s doc comment. Absent on every pre-P0-C write. */
  mutexProtocolVersion?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * Deterministic — a retried "start workout" (double tap, network retry, cold
 * start) lands on the same doc instead of creating a duplicate execution
 * (docs §22 Idempotência). `occurrence` (omitted/`1` = original behavior)
 * only ever varies for a `flexible` schedule's same-day repeat — see
 * `workoutExecutionDocumentId`'s doc comment.
 */
export function workoutExecutionId(
  programOrInstanceId: string,
  sessionIndex: number,
  scheduledLocalDate: string,
  occurrence?: number,
): string {
  return workoutExecutionDocumentId(programOrInstanceId, sessionIndex, scheduledLocalDate, occurrence);
}

/** Backward-compatible visual/activity date. Never use this as schedule authority. */
export function performedLocalDateOf(
  execution: Pick<WorkoutExecution, 'scheduledLocalDate' | 'performedLocalDate'>,
): string {
  return execution.performedLocalDate ?? execution.scheduledLocalDate;
}

/** A permanent substitution preference already resolved/validated by the caller for one slot — see `resolvePermanentSubstitutionsForSession` (`workoutPrescription/manualSubstitutionResolver.ts`). */
export interface ResolvedPermanentSubstitutionOverride {
  exerciseId: string;
  /** Plain `Timestamp` value supplied by the caller — never `FieldValue.serverTimestamp()` (unsupported inside array elements). */
  appliedAt: unknown;
}

/**
 * Builds the initial, all-PENDING exercise/set snapshot for a freshly
 * started (or restarted-after-abandon) execution. Set count mirrors
 * `WorkoutScreen`'s existing materialization (`prescribed.sets ?? 1`) so both
 * layers agree on how many sets a duration/cycles-based exercise has.
 *
 * `permanentOverrides` (exercise-substitution architecture audit, "Todos os
 * próximos treinos" gap fix): only ever supplied by the orchestration layer
 * immediately before a NEW execution is created (`startOrResumeWorkoutExecution`
 * in `services/workoutExecutions.ts`), never by this function itself — it
 * stays pure (no Firestore, no resolving) and never re-derives anything on
 * RESUME of an existing execution (the caller simply never passes overrides
 * on that path). `prescribedExerciseId` always reflects the plan's own id,
 * regardless of any override — "prescrito A, executado B" stays intact.
 */
export function buildInitialExerciseExecutions(
  session: FinalWorkoutSession,
  permanentOverrides?: ReadonlyMap<number, ResolvedPermanentSubstitutionOverride>,
): ExerciseExecution[] {
  return session.exercises.map((exercise, exerciseIndex) => {
    const setCount = exercise.sets ?? 1;
    const override = permanentOverrides?.get(exerciseIndex);
    return {
      exerciseIndex,
      exerciseId: override?.exerciseId ?? exercise.exerciseId,
      prescribedExerciseId: exercise.exerciseId,
      ...(override ? { substitution: { scope: 'PERMANENT' as const, appliedAt: override.appliedAt } } : {}),
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
