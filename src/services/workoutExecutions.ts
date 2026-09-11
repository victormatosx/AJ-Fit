import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { logInfo, logWarn } from '../lib/logger';
import type { WorkoutProgramSnapshot } from './workoutPrograms';
import {
  authorizeWorkoutLifecycleMutation,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../workoutLifecycle/authorityProvider';
import {
  WORKOUT_EXECUTION_SCHEMA_VERSION,
  WORKOUT_EXECUTION_LIFECYCLE_SCHEMA_VERSION,
  WORKOUT_EXECUTION_STATE_SCHEMA_VERSION,
  WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION,
  buildInitialExerciseExecutions,
  deriveFinishStatus,
  sweepPendingSetsToSkipped,
  workoutExecutionId,
  type CardioExecutionRecord,
  type ExerciseExecution,
  type ResolvedPermanentSubstitutionOverride,
  type SetExecution,
  type WorkoutExecution,
  type WorkoutExecutionStatePointer,
  type WorkoutExecutionStatus,
} from '../workoutExecution/types';
import type { FinalWorkoutSession } from '../workoutPrescription/types';
import { MANUAL_SUBSTITUTION_CATALOG } from '../workoutPrescription/manualSubstitutionCatalog';
import { resolvePermanentSubstitutionsForSession } from '../workoutPrescription/manualSubstitutionResolver';
// Deliberately from `exerciseSubstitutionContext.ts`, NOT `exerciseSubstitution.ts`
// — the latter imports `firebase/functions`, which calls `getFunctions()`
// eagerly at module load time and broke every test importing this file
// without a mocked Functions app. See that file's doc comment.
import { loadManualSubstitutionUserContext } from './exerciseSubstitutionContext';
import { loadPermanentExerciseSubstitutionPreferences } from './exerciseSubstitutionPreferences';

const USERS = 'users';
const WORKOUT_EXECUTIONS = 'workoutExecutions';
const WORKOUT_EXECUTION_STATE = 'workoutExecutionState';
const WORKOUT_EXECUTION_STATE_DOC_ID = 'current';

function executionsCollection(uid: string) {
  return collection(db, USERS, uid, WORKOUT_EXECUTIONS);
}

/**
 * "Todos os próximos treinos" gap fix (exercise-substitution architecture
 * audit). Only ever called right before a NEW execution's `exercises` are
 * built (fresh start or restart-after-abandon) — never on resume of an
 * existing one, since the caller (`startOrResumeWorkoutExecution`) only
 * reaches this code path there. Loads the user's stored permanent
 * preferences + current limitation/equipment context, then re-validates
 * each preference through the SAME canonical resolver Manual Substitution
 * itself uses — an invalid preference silently falls back to the prescribed
 * exercise (never a fabricated third alternative), and is left stored for
 * a future context where it might become valid again.
 */
/**
 * Fail-open by design (2026-09 hotfix — real Development Build regression:
 * a `permission-denied` on the `exerciseSubstitutionPreferences` `list`
 * query, caused by a local Rules change not yet deployed to the real
 * project, was propagating out of this function and aborting the ENTIRE
 * workout start). A permanent substitution preference is a nice-to-have
 * materialized at creation — never a precondition for starting a session at
 * all. Any failure at any stage here must degrade to "no preference
 * applied" (the plan's own prescribed exercises), never block the start.
 */
async function resolveExercisesForNewExecution(
  uid: string,
  program: WorkoutProgramSnapshot,
  session: FinalWorkoutSession,
): Promise<ExerciseExecution[]> {
  const preferencesStartedAtMs = Date.now();
  let preferences;
  try {
    preferences = await loadPermanentExerciseSubstitutionPreferences(uid);
  } catch (error) {
    logWarn('workout_execution', 'preferences_list_failed_fail_open', {
      durationMs: Date.now() - preferencesStartedAtMs,
      error,
    });
    return buildInitialExerciseExecutions(session);
  }
  logInfo('workout_execution', 'preferences_list_completed', {
    durationMs: Date.now() - preferencesStartedAtMs,
    resultCount: preferences.size,
  });
  if (preferences.size === 0) return buildInitialExerciseExecutions(session);

  const userContextStartedAtMs = Date.now();
  let userContext;
  try {
    userContext = await loadManualSubstitutionUserContext(uid, program.environment);
  } catch (error) {
    logWarn('workout_execution', 'preferences_user_context_failed_fail_open', {
      durationMs: Date.now() - userContextStartedAtMs,
      error,
    });
    return buildInitialExerciseExecutions(session);
  }
  logInfo('workout_execution', 'preferences_user_context_completed', {
    durationMs: Date.now() - userContextStartedAtMs,
    found: userContext != null,
  });
  // No usable questionnaire context -> never guess; materialize the
  // prescribed plan unchanged, exactly as if no preference existed.
  if (!userContext) return buildInitialExerciseExecutions(session);

  const resolved = resolvePermanentSubstitutionsForSession({
    sessionExerciseIds: session.exercises.map((exercise) => exercise.exerciseId),
    preferences,
    catalog: MANUAL_SUBSTITUTION_CATALOG,
    regions: userContext.regions,
    equipmentContext: userContext.equipmentContext,
  });
  if (resolved.size === 0) return buildInitialExerciseExecutions(session);

  const appliedAt = Timestamp.now();
  const overrides = new Map<number, ResolvedPermanentSubstitutionOverride>();
  resolved.forEach((exerciseId, exerciseIndex) => overrides.set(exerciseIndex, { exerciseId, appliedAt }));
  return buildInitialExerciseExecutions(session, overrides);
}

function executionRef(uid: string, executionId: string) {
  return doc(db, USERS, uid, WORKOUT_EXECUTIONS, executionId);
}

/**
 * The persistent mutex/pointer doc (docs §P0 — see `workoutExecution/types.ts`'s
 * `WorkoutExecutionStatePointer` doc comment). Fixed id: exactly one can ever
 * exist per user.
 */
function executionStateRef(uid: string) {
  return doc(db, USERS, uid, WORKOUT_EXECUTION_STATE, WORKOUT_EXECUTION_STATE_DOC_ID);
}

/** Another execution is already legitimately active — never resolvable by retrying the same call. */
export class WorkoutExecutionConflictError extends Error {
  readonly code = 'WORKOUT_EXECUTION_CONFLICT' as const;
  readonly active: { executionId: string; sessionIndex: number; scheduledLocalDate: string };
  constructor(active: { executionId: string; sessionIndex: number; scheduledLocalDate: string }) {
    super('WORKOUT_EXECUTION_CONFLICT');
    this.name = 'WorkoutExecutionConflictError';
    this.active = active;
  }
}

/**
 * One or more `IN_PROGRESS` WorkoutExecutions exist from before the
 * `workoutExecutionState/current` mutex was introduced (or from an
 * inconsistency this P0 cannot yet self-heal) and none of them is the
 * session being started. Never auto-resolved — the caller must offer
 * "abandon" (via `abandonWorkoutExecution`) before a new session can start
 * (docs §11/§12).
 */
export class WorkoutExecutionLegacyPendingError extends Error {
  readonly code = 'WORKOUT_EXECUTION_LEGACY_PENDING' as const;
  readonly executionIds: string[];
  constructor(executionIds: string[]) {
    super('WORKOUT_EXECUTION_LEGACY_PENDING');
    this.name = 'WorkoutExecutionLegacyPendingError';
    this.executionIds = executionIds;
  }
}

interface PersistedWorkoutExecution extends Omit<WorkoutExecution, 'startedAt' | 'finishedAt' | 'createdAt' | 'updatedAt'> {
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function fromDoc(executionId: string, data: Record<string, unknown>): PersistedWorkoutExecution {
  return {
    executionId,
    programId: data.programId as string,
    ...(typeof data.programInstanceId === 'string' ? { programInstanceId: data.programInstanceId } : {}),
    templateId: data.templateId as string,
    sessionIndex: data.sessionIndex as number,
    sessionName: data.sessionName as string,
    scheduledLocalDate: data.scheduledLocalDate as string,
    status: data.status as WorkoutExecutionStatus,
    startedAt: data.startedAt as Timestamp,
    finishedAt: (data.finishedAt as Timestamp | null) ?? null,
    exercises: data.exercises as ExerciseExecution[],
    // Absent on every execution written before this field existed, and on
    // every execution whose session has no cardio finisher — both degrade
    // identically to "not completed" (docs — `CardioExecutionRecord`).
    cardio: (data.cardio as CardioExecutionRecord | null | undefined) ?? null,
    executionSchemaVersion: data.executionSchemaVersion as number,
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
  };
}

function hasResolvedExecutionTimestamps(execution: PersistedWorkoutExecution): boolean {
  return execution.startedAt instanceof Timestamp
    && execution.createdAt instanceof Timestamp
    && execution.updatedAt instanceof Timestamp;
}

/**
 * Starts a new execution for `sessionIndex`, or resumes/restarts the one
 * already at the deterministic doc id for (programId, sessionIndex,
 * scheduledLocalDate) — never creates a duplicate for a double tap, a
 * network retry, or a cold start reopening the app (docs §22–25).
 *
 * P0 integrity fix (2026-09, see `workoutExecution/types.ts`'s
 * `WorkoutExecutionStatePointer` doc comment): the invariant
 * `count(IN_PROGRESS executions for this user) <= 1` is now enforced
 * persistently via `workoutExecutionState/current`, a single fixed-id mutex
 * doc, created/adopted atomically in the SAME transaction that touches the
 * execution doc. Two devices, a double tap, or a retry all serialize through
 * Firestore's normal transaction contention (both read `current`; the
 * loser's transaction is retried against the post-commit state and then
 * correctly reports a conflict instead of creating a second execution).
 *
 * - `IN_PROGRESS` (same id as `current`) → returned as-is (resume with prior
 *   data intact) — idempotent.
 * - `IN_PROGRESS` (different id than `current`, or `current` present at all
 *   while this id doesn't match it) → throws `WorkoutExecutionConflictError`.
 *   Never creates a second execution.
 * - `ABANDONED` → restarted fresh (the abandoned attempt's logged sets are
 *   discarded; nothing counted from it anyway). `startedAt` is renewed —
 *   this is semantically a NEW attempt, and the session timer
 *   (`elapsed = Date.now() - startedAt`) must not show hours/days of stale
 *   duration from the abandoned attempt (docs §13).
 * - `COMPLETED`/`PARTIALLY_COMPLETED` → this session is already done; throws
 *   rather than silently reopening a finished, immutable record.
 *
 * Legacy data predating this mutex (an `IN_PROGRESS` execution with no
 * `current` pointer) is detected up front: if it's the exact execution being
 * started, it's safely adopted (deterministic, single case, no execution
 * data touched). Any OTHER `IN_PROGRESS` execution with no tracking pointer
 * throws `WorkoutExecutionLegacyPendingError` — the caller must resolve it
 * (offer `abandonWorkoutExecution`) before a new session can start (docs
 * §11/§12). Never auto-picks a winner among multiple legacy executions.
 */
export async function startOrResumeWorkoutExecution(input: {
  uid: string;
  program: WorkoutProgramSnapshot;
  sessionIndex: number;
  scheduledLocalDate: string;
}): Promise<PersistedWorkoutExecution> {
  const serviceStartedAtMs = Date.now();
  const { uid, program, sessionIndex, scheduledLocalDate } = input;
  const session = program.sessions[sessionIndex];
  if (!session) throw new Error('SESSION_INDEX_OUT_OF_RANGE');
  const executionScopeId = program.programInstanceId ?? program.programId;
  const executionId = workoutExecutionId(executionScopeId, sessionIndex, scheduledLocalDate);
  const ref = executionRef(uid, executionId);
  const stateRef = executionStateRef(uid);

  // Legacy pre-check (best-effort, outside the transaction — a plain query
  // cannot participate in a client-SDK transaction). This only matters for
  // data written before `current` existed: every write going forward is
  // gated by the transaction below, so this can never race against itself.
  const legacyCheckStartedAtMs = Date.now();
  const legacySnapshot = await getDocs(query(executionsCollection(uid), where('status', '==', 'IN_PROGRESS'), fsLimit(5)));
  logInfo('workout_execution', 'start_legacy_check_completed', {
    durationMs: Date.now() - legacyCheckStartedAtMs,
    resultCount: legacySnapshot.size,
  });
  const legacyOrphans = legacySnapshot.docs.filter((item) => item.id !== executionId);
  if (legacyOrphans.length > 0) {
    const legacyPointerCheckStartedAtMs = Date.now();
    const currentSnapshot = await getDoc(stateRef);
    logInfo('workout_execution', 'start_legacy_pointer_check_completed', {
      durationMs: Date.now() - legacyPointerCheckStartedAtMs,
    });
    const trackedId = currentSnapshot.exists() ? (currentSnapshot.data().executionId as string) : null;
    const untracked = legacyOrphans.filter((item) => item.id !== trackedId);
    if (untracked.length > 0) {
      // Observability (docs P0-C §12): never logs uid/executionId content —
      // just enough to size "how often does this still happen" without any
      // personal data. This is the ONLY place a legacy-protocol write is
      // ever detected on the client side — an old client's own write is
      // invisible to us until a new-protocol client next tries to start.
      logWarn('workout_execution', 'legacy_in_progress_execution_detected', { count: untracked.length });
      throw new WorkoutExecutionLegacyPendingError(untracked.map((item) => item.id));
    }
  }

  // Best-effort pre-check (same non-transactional "peek" pattern as the
  // legacy check above): if the mutex pointer already points at THIS
  // executionId, this call is a resume — the "existing" transaction branch
  // below never reads `base.exercises` at all, so permanent-preference
  // resolution would be pure waste (and, per the hotfix below, a source of
  // needless failure exposure) on that path. If this peek is stale (the
  // pointer changes concurrently), the transaction's own atomic re-read of
  // `stateRef` remains the sole authority — `resolvedExercises` is simply
  // unused whenever the "existing" branch ends up winning anyway.
  const pointerPeekStartedAtMs = Date.now();
  const pointerPeek = await getDoc(stateRef);
  const isLikelyResume = pointerPeek.exists() && pointerPeek.data().executionId === executionId;
  logInfo('workout_execution', 'start_pointer_peek_completed', {
    durationMs: Date.now() - pointerPeekStartedAtMs,
    isLikelyResume,
  });
  const resolvedExercises = isLikelyResume
    ? [] // never read by the "existing" transaction branch below
    : await resolveExercisesForNewExecution(uid, program, session);

  const base = {
    programId: program.programId,
    ...(program.programInstanceId ? { programInstanceId: program.programInstanceId } : {}),
    templateId: program.templateId,
    sessionIndex,
    sessionName: session.name,
    scheduledLocalDate,
    status: 'IN_PROGRESS' as const,
    exercises: resolvedExercises,
    // Always reset on a fresh start AND on a restart-after-abandon — the
    // latter is semantically a new attempt (same rationale as `startedAt`
    // renewal just below), so a cardio completion recorded on the abandoned
    // attempt must never leak into the new one.
    cardio: null,
    executionSchemaVersion: program.programInstanceId
      ? WORKOUT_EXECUTION_LIFECYCLE_SCHEMA_VERSION
      : WORKOUT_EXECUTION_SCHEMA_VERSION,
    // P0-C (docs/workout-lifecycle/ hardening plan): marks this write as
    // coming from a client that follows the `workoutExecutionState/current`
    // mutex protocol — see `WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION`'s doc
    // comment. Never omit this; it's the only signal Rules/telemetry have
    // to distinguish this write path from a pre-P0-C client's.
    mutexProtocolVersion: WORKOUT_EXECUTION_MUTEX_PROTOCOL_VERSION,
    finishedAt: null,
  };
  const pointer = {
    executionId,
    programId: program.programId,
    programInstanceId: program.programInstanceId ?? null,
    sessionIndex,
    scheduledLocalDate,
    status: 'IN_PROGRESS' as const,
    schemaVersion: WORKOUT_EXECUTION_STATE_SCHEMA_VERSION,
  };

  const transactionStartedAtMs = Date.now();
  type TransactionResult =
    | { kind: 'existing'; execution: PersistedWorkoutExecution }
    | { kind: 'created' }
    | { kind: 'restarted' };
  let transactionResult: TransactionResult | null = null;
  try {
    transactionResult = await runTransaction(db, async (transaction): Promise<TransactionResult> => {
      const [snapshot, stateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(stateRef)]);

      if (stateSnapshot.exists()) {
        const trackedExecutionId = stateSnapshot.data().executionId as string;
        if (trackedExecutionId !== executionId) {
          const tracked = stateSnapshot.data();
          throw new WorkoutExecutionConflictError({
            executionId: trackedExecutionId,
            sessionIndex: tracked.sessionIndex as number,
            scheduledLocalDate: tracked.scheduledLocalDate as string,
          });
        }
        // A pointer without its execution (or pointing at a terminal one) is
        // inconsistent. Validate it inside the same authoritative read set;
        // the old post-transaction server read used to catch only the missing
        // document and added a full round trip to every healthy start.
        if (!snapshot.exists()) throw new Error('EXECUTION_WRITE_FAILED');
        const trackedExecution = fromDoc(executionId, snapshot.data());
        if (trackedExecution.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS');
        // Idempotent resume needs no write and can return the transaction's
        // already-authoritative snapshot directly.
        return { kind: 'existing', execution: trackedExecution };
      }

      if (snapshot.exists()) {
        const status = snapshot.data().status as WorkoutExecutionStatus;
        if (status === 'IN_PROGRESS') {
          // Legacy execution predating the mutex, matching exactly the id
          // being started, with no `current` pointer yet — safe, deterministic
          // adoption: only the pointer is created, execution data untouched.
          transaction.set(stateRef, { ...pointer, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          return { kind: 'existing', execution: fromDoc(executionId, snapshot.data()) };
        }
        if (status !== 'ABANDONED') throw new Error('SESSION_ALREADY_FINISHED');
        // Restart after abandon: the abandoned attempt's logged sets are
        // discarded — nothing was counted from it. `startedAt` is renewed
        // (docs §13) since this is a genuinely new attempt; `createdAt` stays put.
        transaction.update(ref, { ...base, startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        transaction.set(stateRef, { ...pointer, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        return { kind: 'restarted' };
      }

      transaction.set(ref, { ...base, startedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(stateRef, { ...pointer, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return { kind: 'created' };
    });
    logInfo('workout_execution', 'start_transaction_completed', {
      durationMs: Date.now() - transactionStartedAtMs,
      outcome: transactionResult.kind,
    });
  } catch (error) {
    // Observability (docs P0-C §12) — logged once per actual failure
    // (outside the transaction callback, which Firestore may retry
    // internally on contention) rather than inside it, to avoid
    // double-counting retries as separate conflicts.
    if (error instanceof WorkoutExecutionConflictError) {
      logWarn('workout_execution', 'mutex_conflict', { activeSessionIndex: error.active.sessionIndex });
    }
    logWarn('workout_execution', 'start_transaction_failed', {
      durationMs: Date.now() - transactionStartedAtMs,
      error,
    });
    throw error;
  }

  if (transactionResult?.kind === 'existing') {
    logInfo('workout_execution', 'start_service_succeeded', {
      durationMs: Date.now() - serviceStartedAtMs,
      materialization: 'transaction',
    });
    return transactionResult.execution;
  }

  // A committed transaction has already populated the SDK's local cache.
  // Read the server-resolved timestamps there instead of issuing the former
  // unconditional network getDoc. The server fallback is consistency-only:
  // unusual cache configurations must never turn a committed start into an
  // unusable execution object.
  const materializationStartedAtMs = Date.now();
  let result: PersistedWorkoutExecution | null = null;
  let materialization: 'cache' | 'server-fallback' = 'cache';
  // After ABANDONED -> IN_PROGRESS the cache may still hold the pre-update
  // terminal snapshot even though runTransaction has resolved. That rarer
  // restart path therefore keeps an authoritative read; a brand-new start
  // can safely use the newly-created cached document.
  if (transactionResult?.kind === 'created') {
    try {
      const cached = await getDocFromCache(ref);
      if (cached.exists()) {
        const candidate = fromDoc(executionId, cached.data());
        if (candidate.status === 'IN_PROGRESS' && hasResolvedExecutionTimestamps(candidate)) result = candidate;
      }
    } catch {
      // Fall through to the authoritative server read below.
    }
  }
  if (!result) {
    materialization = 'server-fallback';
    result = await loadWorkoutExecution(uid, executionId);
  }
  logInfo('workout_execution', 'start_materialization_completed', {
    durationMs: Date.now() - materializationStartedAtMs,
    source: materialization,
  });
  if (!result || !hasResolvedExecutionTimestamps(result)) throw new Error('EXECUTION_WRITE_FAILED');
  logInfo('workout_execution', 'start_service_succeeded', {
    durationMs: Date.now() - serviceStartedAtMs,
    materialization,
  });
  return result;
}

/** Loads an execution by id, or null if it doesn't exist. */
export async function loadWorkoutExecution(uid: string, executionId: string): Promise<PersistedWorkoutExecution | null> {
  const snapshot = await getDoc(executionRef(uid, executionId));
  if (!snapshot.exists()) return null;
  return fromDoc(executionId, snapshot.data());
}

/**
 * Read-only lookup of the persistent mutex pointer — the sole authority for
 * "does this user have an active execution right now" (docs P0). Used by
 * Workout Recovery to detect a pending session proactively at bootstrap,
 * independent of the user ever tapping "Iniciar treino". Never writes; a
 * caller that wants to resolve/clear it uses `abandonWorkoutExecution` or
 * the normal start flow, both already Rules-gated the same way.
 */
export async function loadActiveExecutionPointer(uid: string): Promise<WorkoutExecutionStatePointer | null> {
  const snapshot = await getDoc(executionStateRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    executionId: data.executionId as string,
    programId: data.programId as string,
    programInstanceId: (data.programInstanceId as string | null | undefined) ?? null,
    sessionIndex: data.sessionIndex as number,
    scheduledLocalDate: data.scheduledLocalDate as string,
    status: 'IN_PROGRESS',
    schemaVersion: data.schemaVersion as number,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/** Read-only convenience: the execution id for a session about to be started/resumed, without writing anything. */
export function activeExecutionId(programId: string, sessionIndex: number, scheduledLocalDate: string): string {
  return workoutExecutionId(programId, sessionIndex, scheduledLocalDate);
}

function replaceSet(
  exercises: ExerciseExecution[],
  exerciseIndex: number,
  setIndex: number,
  patch: Partial<SetExecution>,
): ExerciseExecution[] {
  return exercises.map((exercise, i) => {
    if (i !== exerciseIndex) return exercise;
    return {
      ...exercise,
      sets: exercise.sets.map((set, j) => (j === setIndex ? { ...set, ...patch } : set)),
    };
  });
}

async function mutateInProgressExecution(
  uid: string,
  executionId: string,
  mutate: (exercises: ExerciseExecution[]) => ExerciseExecution[],
): Promise<void> {
  const ref = executionRef(uid, executionId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('EXECUTION_NOT_FOUND');
    const data = snapshot.data();
    if (data.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS');
    const exercises = mutate(data.exercises as ExerciseExecution[]);
    transaction.update(ref, { exercises, updatedAt: serverTimestamp() });
  });
}

/** Records what was actually done for one set — reps/weight can differ from the prescription in either direction; never touches the Program Snapshot (docs §12/§17/§31/§33). */
export async function recordSetExecution(input: {
  uid: string;
  executionId: string;
  exerciseIndex: number;
  setIndex: number;
  actualReps?: number | null;
  weightKg?: number | null;
  actualDurationSeconds?: number | null;
}): Promise<void> {
  await mutateInProgressExecution(input.uid, input.executionId, (exercises) =>
    replaceSet(exercises, input.exerciseIndex, input.setIndex, {
      status: 'COMPLETED',
      actualReps: input.actualReps ?? null,
      weightKg: input.weightKg ?? null,
      actualDurationSeconds: input.actualDurationSeconds ?? null,
    }),
  );
}

/** Semantically distinct from a 0-rep completion — a skipped set was never performed at all (docs §29). */
export async function skipSetExecution(input: { uid: string; executionId: string; exerciseIndex: number; setIndex: number }): Promise<void> {
  await mutateInProgressExecution(input.uid, input.executionId, (exercises) =>
    replaceSet(exercises, input.exerciseIndex, input.setIndex, {
      status: 'SKIPPED',
      actualReps: null,
      weightKg: null,
      actualDurationSeconds: null,
    }),
  );
}

/** Skips every still-PENDING set of one exercise — sets already logged/skipped are left untouched (docs §30). */
export async function skipExerciseExecution(input: { uid: string; executionId: string; exerciseIndex: number }): Promise<void> {
  await mutateInProgressExecution(input.uid, input.executionId, (exercises) =>
    exercises.map((exercise, i) => {
      if (i !== input.exerciseIndex) return exercise;
      return {
        ...exercise,
        sets: exercise.sets.map((set) => (set.status === 'PENDING' ? { ...set, status: 'SKIPPED' as const } : set)),
      };
    }),
  );
}

/**
 * Cardio Finisher Completion Recovery hardening, Architecture B (2026-09
 * security audit): marks this execution's cardio finisher as durably
 * COMPLETED — persisted independently of, and always BEFORE,
 * `finishWorkoutExecution`. Two recoverable steps, deliberately not one
 * combined transaction with `finishWorkoutExecution`: this module's
 * existing terminal-write chain (`finishWorkoutExecution` ->
 * `completeScheduledSession` -> lifecycle reconciliation, orchestrated by
 * `AppShell`/`finishFlow.ts`) is ALREADY three separate, independently
 * idempotent steps rather than one atomic write — folding cardio completion
 * into `finishWorkoutExecution`'s own transaction would conflate two
 * different business facts ("the user finished their cardio" vs "this
 * execution record is terminal") and require a parallel completion pipeline
 * for the strength-only case (no cardio finisher at all), which never needs
 * this step. Keeping the same shape means the exact same self-heal path
 * WorkoutScreen already used for a died-before-`finish()` session (docs —
 * see `WorkoutScreen.tsx`'s `finished` initial-state comment) now also
 * covers "died after cardio persisted but before `finish()` ran": on resume,
 * hydration reads this record as COMPLETED and skips straight to
 * re-triggering `onSessionCompleted`, never back into a blank cardio timer.
 *
 * The actual Firestore write happens entirely server-side — see the
 * `completeCardioTransport` doc comment just below for why, and
 * `functions/src/workoutLifecycle/completeWorkoutCardio.ts` for the
 * authority (ownership, execution state, and "this session really has a
 * cardio finisher") this call is validated against. Idempotent from the
 * caller's perspective either way: if `cardio` is already
 * `{ status: 'COMPLETED' }`, the callable is a no-op that returns the
 * EXISTING record unchanged — a double tap, a retry after a network
 * failure, or the mount-time self-heal path can never overwrite an
 * already-recorded `completedAt`/`actualDurationSeconds` with a later
 * call's value.
 */
export type CompleteCardioTransport = (input: {
  executionId: string;
  actualDurationSeconds: number;
}) => Promise<{ status: 'COMPLETED'; actualDurationSeconds: number }>;

const COMPLETE_WORKOUT_CARDIO_CALLABLE = 'completeWorkoutCardio';

/**
 * Dynamic import (not a top-level `import ... from 'firebase/functions'`)
 * for the exact same reason `workoutLifecycle/authorityProvider.ts`'s own
 * `cloudAuthorizer` uses one, and the exact same reason this file already
 * avoids importing `services/exerciseSubstitution.ts` directly (see the
 * comment on that import above): `firebase/functions`'s `getFunctions()`
 * runs eagerly at module load time and broke every test importing this
 * file without a mocked Functions app.
 */
const cloudCompleteCardio: CompleteCardioTransport = async (input) => {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]);
  const callable = httpsCallable<
    { executionId: string; actualDurationSeconds: number },
    { status: 'COMPLETED'; actualDurationSeconds: number }
  >(functions, COMPLETE_WORKOUT_CARDIO_CALLABLE);
  return (await callable(input)).data;
};

let completeCardioTransport: CompleteCardioTransport = cloudCompleteCardio;

/** Test-only dependency injection — mirrors `authorityProvider.ts`'s `setWorkoutLifecycleAuthorityAuthorizerForTests`. Production always uses the App-Check-enforced callable. */
export function setCompleteCardioTransportForTests(value: CompleteCardioTransport): void {
  completeCardioTransport = value;
}

export function resetCompleteCardioTransportForTests(): void {
  completeCardioTransport = cloudCompleteCardio;
}

/**
 * `uid` is kept in the public signature for backward compatibility (every
 * call site already threads it through, and `useWorkoutExecution.ts` never
 * needs to know the transport changed) but is NOT used to build the
 * Firestore path anymore — the callable derives the authoritative uid
 * exclusively from the caller's verified ID token
 * (`context.auth.uid`/`requireAuth`, never trusted from a request payload).
 * A client can never claim to act as a different uid by passing one here.
 */
export async function completeCardioExecution(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API/call-site compatibility; see doc comment.
  uid: string,
  executionId: string,
  actualDurationSeconds: number,
): Promise<{ status: 'COMPLETED'; actualDurationSeconds: number }> {
  logInfo('workout_execution', 'cardio_finish_requested', { executionId });
  const startedAtMs = Date.now();
  try {
    const result = await completeCardioTransport({ executionId, actualDurationSeconds });
    logInfo('workout_execution', 'cardio_persist_completed', {
      executionId,
      durationMs: Date.now() - startedAtMs,
    });
    return result;
  } catch (error) {
    logWarn('workout_execution', 'cardio_persist_failed', {
      executionId,
      durationMs: Date.now() - startedAtMs,
      error,
    });
    throw error;
  }
}

/**
 * Finishes an IN_PROGRESS execution — any remaining PENDING sets are swept to
 * SKIPPED first (docs §34/§37), then the final status is COMPLETED or
 * PARTIALLY_COMPLETED. Idempotent: calling this again on an already-finished
 * execution just returns its (unchanged) status — a double tap never
 * re-derives or rewrites a finished record (docs §38/§39/§53).
 *
 * Does NOT advance the Schedule Engine — the caller does that afterward via
 * `completeScheduledSession`, reusing the existing, already-idempotent
 * completion mechanism instead of a parallel one (docs §40).
 */
export async function finishWorkoutExecution(uid: string, executionId: string): Promise<{ status: 'COMPLETED' | 'PARTIALLY_COMPLETED' }> {
  const ref = executionRef(uid, executionId);
  const stateRef = executionStateRef(uid);
  const existing = await getDoc(ref);
  if (existing.exists() && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(existing.data().status)) {
    return { status: existing.data().status as 'COMPLETED' | 'PARTIALLY_COMPLETED' };
  }
  const requiresV2Authority = typeof existing.data()?.programInstanceId === 'string';
  if (requiresV2Authority) {
    await authorizeWorkoutLifecycleMutation({ operation: 'FINISH_EXECUTION', executionId });
  }
  const grantRef = doc(db, USERS, uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID);
  return runTransaction(db, async (transaction) => {
    const [snapshot, stateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(stateRef)]);
    if (!snapshot.exists()) throw new Error('EXECUTION_NOT_FOUND');
    const data = snapshot.data();
    if (data.status === 'COMPLETED' || data.status === 'PARTIALLY_COMPLETED') {
      if (requiresV2Authority) transaction.delete(grantRef);
      return { status: data.status as 'COMPLETED' | 'PARTIALLY_COMPLETED' };
    }
    if (data.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS');

    const exercises = sweepPendingSetsToSkipped(data.exercises as ExerciseExecution[]);
    const status = deriveFinishStatus(exercises);
    transaction.update(ref, { exercises, status, finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    // Terminalization and mutex release are one atomic write — there is
    // never a window where the execution is terminal but `current` still
    // points at it as active (docs §7).
    if (stateSnapshot.exists() && stateSnapshot.data().executionId === executionId) {
      transaction.delete(stateRef);
    }
    if (requiresV2Authority) transaction.delete(grantRef);
    return { status };
  });
}

/**
 * Abandons an IN_PROGRESS execution — deliberately distinct from finishing:
 * the Schedule Engine must never advance because of this (docs §36).
 * Idempotent: a no-op rewrite if already ABANDONED, and never touches a
 * COMPLETED/PARTIALLY_COMPLETED record. Also works on a legacy orphan
 * execution never tracked by `current` (docs §12's "abandon a pending
 * session" recovery path) — the pointer is only cleared if it actually
 * points at this execution; otherwise it's left untouched.
 */
export async function abandonWorkoutExecution(uid: string, executionId: string): Promise<void> {
  const ref = executionRef(uid, executionId);
  const stateRef = executionStateRef(uid);
  await runTransaction(db, async (transaction) => {
    const [snapshot, stateSnapshot] = await Promise.all([transaction.get(ref), transaction.get(stateRef)]);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (data.status === 'IN_PROGRESS') {
      transaction.update(ref, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    // Defensive self-heal: clear a lingering pointer even if the execution
    // was already terminal by the time this ran (e.g. a retried abandon
    // racing a finish) — the mutex must never be left dangling (docs §8).
    if (stateSnapshot.exists() && stateSnapshot.data().executionId === executionId) {
      transaction.delete(stateRef);
    }
  });
}

/**
 * History is derived entirely from `workoutExecutions` — no separate
 * `workoutHistory` collection (docs §41). Executions from a since-superseded
 * program still appear; nothing here filters by the active program (docs
 * §45).
 */
export async function listRecentWorkoutExecutions(uid: string, count = 20): Promise<PersistedWorkoutExecution[]> {
  const q = query(
    executionsCollection(uid),
    where('status', 'in', ['COMPLETED', 'PARTIALLY_COMPLETED', 'ABANDONED']),
    orderBy('scheduledLocalDate', 'desc'),
    fsLimit(count),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => fromDoc(item.id, item.data()));
}

/**
 * Every execution recorded for one specific program — a single equality
 * filter (`programId`), no composite index required. Used by the Progression
 * Engine to count completed/partial sessions and detect an IN_PROGRESS
 * execution for THIS program only (docs/workout-lifecycle/
 * 09_WORKOUT_EXECUTION_AND_HISTORY.md; progression docs §17/§22/§71/§87 —
 * executions from a superseded program must never count toward the new
 * one's eligibility). Status filtering is done by the caller, not here —
 * a program's execution count is small enough that a second composite index
 * isn't worth the operational cost for V1.
 */
export async function listExecutionsForProgram(uid: string, programId: string): Promise<PersistedWorkoutExecution[]> {
  const q = query(executionsCollection(uid), where('programId', '==', programId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => fromDoc(item.id, item.data()));
}

/** V2 instance-scoped history; prevents equivalent content reused in two cycles from sharing progression counts. */
export async function listExecutionsForProgramInstance(uid: string, programInstanceId: string): Promise<PersistedWorkoutExecution[]> {
  const q = query(executionsCollection(uid), where('programInstanceId', '==', programInstanceId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => fromDoc(item.id, item.data()));
}

/**
 * Distinct calendar dates (`scheduledLocalDate`) with a COMPLETED or
 * PARTIALLY_COMPLETED execution within `[fromLocalDate, toLocalDate]`
 * (inclusive) — the Home screen's weekly overview and frequency heatmap
 * share this single bounded read instead of one query per day/week (docs
 * §41/§45: history is derived entirely from `workoutExecutions`, unscoped by
 * program, so a since-superseded program's completions still count). Status
 * is filtered client-side rather than via a second `where` clause so this
 * never requires a composite Firestore index beyond the single-field range
 * on `scheduledLocalDate`.
 */
export async function listCompletedWorkoutDatesInRange(
  uid: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<string[]> {
  const q = query(
    executionsCollection(uid),
    where('scheduledLocalDate', '>=', fromLocalDate),
    where('scheduledLocalDate', '<=', toLocalDate),
  );
  const snapshot = await getDocs(q);
  const dates = new Set<string>();
  snapshot.docs.forEach((item) => {
    const data = item.data();
    const status = data.status as WorkoutExecutionStatus;
    if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') {
      dates.add(data.scheduledLocalDate as string);
    }
  });
  return Array.from(dates);
}

export type { PersistedWorkoutExecution };
