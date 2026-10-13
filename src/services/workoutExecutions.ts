import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  Timestamp,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { errorClass, errorCode, logInfo, logWarn } from '../lib/logger';
import { countFirestoreRead } from '../lib/perf';
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
  type WorkoutCompletion,
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
import type { ManualSubstitutionUserContext } from './exerciseSubstitutionContext';
import { addDaysLocal } from '../scheduleEngine/calendar';
import {
  applyCompletedSetEdit,
  type CompletedSetEditPatch,
} from '../workoutExecution/setEdit';

const USERS = 'users';
const WORKOUT_EXECUTIONS = 'workoutExecutions';
const WORKOUT_EXECUTION_STATE = 'workoutExecutionState';
const WORKOUT_EXECUTION_STATE_DOC_ID = 'current';
/**
 * One tiny counter doc per (programInstanceId, sessionIndex, scheduledLocalDate)
 * tuple — keyed by that tuple's own occurrence-1 execution id, so no parallel
 * encoding is invented. Only ever read/written when a `flexible` schedule
 * needs a 2nd+ same-day occurrence (see `startOrResumeWorkoutExecution`);
 * `fixed` schedules and every flexible schedule's first occurrence of the day
 * never touch this collection.
 */
const WORKOUT_EXECUTION_OCCURRENCE_COUNTERS = 'workoutExecutionOccurrenceCounters';

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
  prepared?: WorkoutExecutionStartPreparation,
): Promise<ExerciseExecution[]> {
  const preferencesStartedAtMs = Date.now();
  let preferences;
  try {
    preferences = prepared?.permanentPreferences
      ?? await loadPermanentExerciseSubstitutionPreferences(uid);
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

  if (prepared?.manualSubstitutionContextStatus === 'error') return buildInitialExerciseExecutions(session);
  const userContextStartedAtMs = Date.now();
  let userContext;
  try {
    userContext = prepared?.manualSubstitutionContextStatus === 'ready'
      ? prepared.manualSubstitutionContext
      : await loadManualSubstitutionUserContext(uid, program.environment, program.templateSourceVersion);
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
  /** Client-only provenance. LOCAL_UI_PROJECTION is usable only after the transaction commit and is never lifecycle authority. */
  timestampAuthority: 'SERVER' | 'LOCAL_UI_PROJECTION';
}

function parseWorkoutCompletion(value: unknown): WorkoutCompletion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const { plannedSets, completedSets, percentageBasisPoints } = candidate;
  if (!Number.isInteger(plannedSets) || !Number.isInteger(completedSets) || !Number.isInteger(percentageBasisPoints)) {
    return undefined;
  }
  const planned = plannedSets as number;
  const completed = completedSets as number;
  const basisPoints = percentageBasisPoints as number;
  if (planned <= 0 || completed < 0 || completed > planned || basisPoints < 0 || basisPoints > 10_000) {
    return undefined;
  }
  if (basisPoints !== Math.round((completed / planned) * 10_000)) return undefined;
  return { plannedSets: planned, completedSets: completed, percentageBasisPoints: basisPoints };
}

function fromDoc(executionId: string, data: Record<string, unknown>): PersistedWorkoutExecution {
  const completion = parseWorkoutCompletion(data.completion);
  return {
    executionId,
    programId: data.programId as string,
    ...(typeof data.programInstanceId === 'string' ? { programInstanceId: data.programInstanceId } : {}),
    templateId: data.templateId as string,
    sessionIndex: data.sessionIndex as number,
    sessionName: data.sessionName as string,
    scheduledLocalDate: data.scheduledLocalDate as string,
    ...(typeof data.performedLocalDate === 'string'
      ? { performedLocalDate: data.performedLocalDate }
      : {}),
    status: data.status as WorkoutExecutionStatus,
    startedAt: data.startedAt as Timestamp,
    finishedAt: (data.finishedAt as Timestamp | null) ?? null,
    exercises: data.exercises as ExerciseExecution[],
    // Absent on every execution written before this field existed, and on
    // every execution whose session has no cardio finisher — both degrade
    // identically to "not completed" (docs — `CardioExecutionRecord`).
    cardio: (data.cardio as CardioExecutionRecord | null | undefined) ?? null,
    ...(completion ? { completion } : {}),
    // Absent on every execution written before this field existed and on
    // every `fixed`-schedule execution — both degrade to `1` (docs —
    // `WorkoutExecution.occurrence`'s doc comment).
    ...(Number.isInteger(data.occurrence) && (data.occurrence as number) > 0
      ? { occurrence: data.occurrence as number } : {}),
    // Absent on every execution finalized before this field existed — never
    // defaulted to 'NORMAL' or 'EARLY' (docs — `WorkoutExecution.finalizationMode`'s
    // doc comment); a consumer that needs this fact must handle `undefined`.
    ...(data.finalizationMode === 'NORMAL' || data.finalizationMode === 'EARLY'
      ? { finalizationMode: data.finalizationMode } : {}),
    executionSchemaVersion: data.executionSchemaVersion as number,
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
    timestampAuthority: 'SERVER',
  };
}

export interface WorkoutExecutionStartPreparation {
  /** Server-observed compatibility snapshot, maintained outside the confirm click. */
  legacyInProgressExecutionIds?: readonly string[];
  /** Server-observed permanent preferences, maintained outside the confirm click. */
  permanentPreferences?: ReadonlyMap<string, string>;
  /** Reuses AppShell's already-loaded questionnaire projection when available. */
  manualSubstitutionContext?: ManualSubstitutionUserContext | null;
  manualSubstitutionContextStatus?: 'loading' | 'ready' | 'error';
}

export async function loadInProgressWorkoutExecutionIds(uid: string): Promise<string[]> {
  const snapshot = await getDocs(query(executionsCollection(uid), where('status', '==', 'IN_PROGRESS'), fsLimit(5)));
  return snapshot.docs.map((item) => item.id);
}

/**
 * Keeps the legacy-compatibility query warm outside the confirm click. Only
 * server snapshots are accepted by the start controller; cache snapshots are
 * useful for rendering but are not fresh enough to guard a durable start.
 */
export function subscribeToInProgressWorkoutExecutionIds(
  uid: string,
  onIds: (ids: string[], metadata: { fromCache: boolean }) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(executionsCollection(uid), where('status', '==', 'IN_PROGRESS'), fsLimit(5)),
    (snapshot) => onIds(snapshot.docs.map((item) => item.id), { fromCache: snapshot.metadata.fromCache }),
    (error) => onError?.(error),
  );
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
 * - `COMPLETED`/`PARTIALLY_COMPLETED` → this session is already done.
 *   `fixed` schedules throw rather than silently reopening a finished,
 *   immutable record — a given (sessionIndex, date) pair only ever occurs
 *   once in a fixed rotation, so this is always a genuine re-finish attempt.
 *   `flexible` schedules instead allocate a brand-new, distinct occurrence
 *   (docs — agenda livre: freedom of date, never freedom of sequence, so the
 *   rotation legitimately wraps back onto an already-completed sessionIndex
 *   on the SAME day). See `workoutExecutionDocumentId`'s doc comment for the
 *   occurrence id scheme; `WORKOUT_EXECUTION_OCCURRENCE_COUNTERS` allocates
 *   occurrence numbers 2+ transactionally so two near-simultaneous starts of
 *   "the next same-day session" can never allocate two different occurrences
 *   for what is really one attempt — the SAME mutex-contention retry this
 *   function already relies on for occurrence 1 covers this too (see the
 *   `trackedMatchesThisTarget` branch below, which resumes whatever
 *   occurrence a live pointer already tracks instead of re-deriving an id).
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
  performedLocalDate?: string;
  preparation?: WorkoutExecutionStartPreparation;
}): Promise<PersistedWorkoutExecution> {
  const serviceStartedAtMs = Date.now();
  const { uid, program, sessionIndex, scheduledLocalDate, preparation } = input;
  const performedLocalDate = input.performedLocalDate ?? scheduledLocalDate;
  const session = program.sessions[sessionIndex];
  if (!session) throw new Error('SESSION_INDEX_OUT_OF_RANGE');
  const executionScopeId = program.programInstanceId ?? program.programId;
  // `flexible` schedules let the same sessionIndex legitimately recur on the
  // same scheduledLocalDate (agenda-livre multiple-sessions-per-day) — the
  // base (occurrence-1) id alone is then not a unique execution identity.
  // `fixed` schedules never need more than the base id (a given (sessionIndex,
  // date) pair only ever occurs once in a fixed rotation), so every branch
  // below that doesn't explicitly mention `flexible` is byte-for-byte the
  // pre-existing behavior.
  const scheduleMode = program.scheduleMode ?? 'fixed';
  const baseExecutionId = workoutExecutionId(executionScopeId, sessionIndex, scheduledLocalDate);
  const baseRef = executionRef(uid, baseExecutionId);
  const stateRef = executionStateRef(uid);
  const occurrenceCounterRef = doc(db, USERS, uid, WORKOUT_EXECUTION_OCCURRENCE_COUNTERS, baseExecutionId);

  // Legacy compatibility snapshot (outside the transaction because client
  // transactions cannot query). New-protocol writes are mutexed; old clients
  // remain a known race until remote Rules hardening rejects their writes.
  const legacyCheckStartedAtMs = Date.now();
  const legacyExecutionIds = preparation?.legacyInProgressExecutionIds
    ? [...preparation.legacyInProgressExecutionIds]
    : await loadInProgressWorkoutExecutionIds(uid);
  logInfo('workout_execution', 'start_legacy_check_completed', {
    durationMs: Date.now() - legacyCheckStartedAtMs,
    resultCount: legacyExecutionIds.length,
    source: preparation?.legacyInProgressExecutionIds ? 'prefetch' : 'confirm-fallback',
  });
  const resolvedExercises = await resolveExercisesForNewExecution(uid, program, session, preparation);

  const base = {
    programId: program.programId,
    ...(program.programInstanceId ? { programInstanceId: program.programInstanceId } : {}),
    templateId: program.templateId,
    sessionIndex,
    sessionName: session.name,
    scheduledLocalDate,
    performedLocalDate,
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
  const pointerFor = (targetExecutionId: string) => ({
    executionId: targetExecutionId,
    programId: program.programId,
    programInstanceId: program.programInstanceId ?? null,
    sessionIndex,
    scheduledLocalDate,
    status: 'IN_PROGRESS' as const,
    schemaVersion: WORKOUT_EXECUTION_STATE_SCHEMA_VERSION,
  });

  const transactionStartedAtMs = Date.now();
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    logInfo('workout_performance', 'transaction_start', {
      timestampMs: transactionStartedAtMs,
    });
  }
  type TransactionResult =
    | { kind: 'existing'; execution: PersistedWorkoutExecution }
    | { kind: 'created'; executionId: string; occurrence: number }
    | { kind: 'restarted'; executionId: string; occurrence: number; createdAt: Timestamp };
  let transactionResult: TransactionResult | null = null;
  let transactionCallbackRun = 0;
  try {
    transactionResult = await runTransaction(db, async (transaction): Promise<TransactionResult> => {
      transactionCallbackRun += 1;
      const stateSnapshot = await transaction.get(stateRef);
      const tracked = stateSnapshot.exists() ? stateSnapshot.data() : null;
      const trackedExecutionId = tracked ? tracked.executionId as string : null;
      // Whatever occurrence is currently tracked (if any) for THIS exact
      // target, compared by the pointer's own tuple fields — never by
      // guessing/re-deriving an id, since a tracked occurrence >= 2 has no id
      // this function could recompute without re-reading the counter. A
      // match here is authoritative proof this is a retry/resume of one live
      // attempt, regardless of which occurrence number it is.
      const trackedMatchesThisTarget = tracked !== null
        && tracked.sessionIndex === sessionIndex
        && tracked.scheduledLocalDate === scheduledLocalDate
        && (tracked.programInstanceId ?? null) === (program.programInstanceId ?? null);

      // A tracked execution must not conceal a second live execution written
      // by a legacy client. This comparison is made only after the mutex read
      // is authoritative, replacing the former non-transactional pointer peek.
      const representedLegacyId = trackedExecutionId ?? baseExecutionId;
      const untrackedLegacyIds = legacyExecutionIds.filter((id) => id !== representedLegacyId);
      if (untrackedLegacyIds.length > 0) {
        logWarn('workout_execution', 'legacy_in_progress_execution_detected', { count: untrackedLegacyIds.length });
        throw new WorkoutExecutionLegacyPendingError(untrackedLegacyIds);
      }

      if (tracked !== null && !trackedMatchesThisTarget) {
        throw new WorkoutExecutionConflictError({
          executionId: trackedExecutionId!,
          sessionIndex: tracked.sessionIndex as number,
          scheduledLocalDate: tracked.scheduledLocalDate as string,
        });
      }

      if (trackedMatchesThisTarget) {
        // A pointer without its execution (or pointing at a terminal one) is
        // inconsistent. Validate it inside the same authoritative read set;
        // the old post-transaction server read used to catch only the missing
        // document and added a full round trip to every healthy start.
        const trackedRef = executionRef(uid, trackedExecutionId!);
        const snapshot = await transaction.get(trackedRef);
        if (!snapshot.exists()) throw new Error('EXECUTION_WRITE_FAILED');
        const trackedExecution = fromDoc(trackedExecutionId!, snapshot.data());
        if (trackedExecution.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS');
        // Idempotent resume needs no write and can return the transaction's
        // already-authoritative snapshot directly.
        return { kind: 'existing', execution: trackedExecution };
      }

      // No live pointer tracks this target — resolve the base (occurrence 1)
      // doc, exactly as before this fix for every `fixed` schedule and every
      // `flexible` schedule's first same-day attempt.
      const snapshot = await transaction.get(baseRef);

      if (snapshot.exists()) {
        const status = snapshot.data().status as WorkoutExecutionStatus;
        if (status === 'IN_PROGRESS') {
          // Legacy execution predating the mutex, matching exactly the id
          // being started, with no `current` pointer yet — safe, deterministic
          // adoption: only the pointer is created, execution data untouched.
          transaction.set(stateRef, { ...pointerFor(baseExecutionId), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          return { kind: 'existing', execution: fromDoc(baseExecutionId, snapshot.data()) };
        }
        if (status === 'ABANDONED') {
          // Restart after abandon: the abandoned attempt's logged sets are
          // discarded — nothing was counted from it. `startedAt` is renewed
          // (docs §13) since this is a genuinely new attempt; `createdAt` stays put.
          const previousCreatedAt = snapshot.data().createdAt as Timestamp;
          // `performedLocalDate` is immutable once this deterministic
          // opportunity document exists. Restarting an abandoned attempt keeps
          // the first attempt's real date (or keeps the field absent for a
          // legacy document) while renewing only the attempt timestamp/data.
          const restartBase = 'performedLocalDate' in snapshot.data()
            ? { ...base, performedLocalDate: snapshot.data().performedLocalDate }
            : Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'performedLocalDate'));
          transaction.update(baseRef, { ...restartBase, occurrence: 1, startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          transaction.set(stateRef, { ...pointerFor(baseExecutionId), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          return { kind: 'restarted', executionId: baseExecutionId, occurrence: 1, createdAt: previousCreatedAt };
        }
        // Terminal (COMPLETED/PARTIALLY_COMPLETED): this exact occurrence is
        // done. `fixed` keeps the historical hard stop — it never
        // legitimately re-offers this (sessionIndex, date) pair. `flexible`
        // explicitly allows the SAME session to recur same-day, so a
        // genuinely new occurrence is allocated instead of blocking. (An
        // abandoned occurrence 2+ is intentionally not resumed here — abandon
        // is an explicit user action, not a retry, and always allocating a
        // fresh occurrence after one keeps this allocator's only required
        // guarantee — concurrent starts of ONE attempt never fork into two
        // occurrences — without also having to re-locate a specific
        // abandoned non-base doc.)
        if (scheduleMode !== 'flexible') {
          throw new Error('SESSION_ALREADY_FINISHED');
        }
        const occurrenceSnapshot = await transaction.get(occurrenceCounterRef);
        // Occurrence 1 is always the base doc itself and is never counted
        // here — the counter only ever tracks occurrences 2+, so its absence
        // means exactly one prior occurrence (the base doc) exists.
        const nextOccurrence = occurrenceSnapshot.exists()
          && Number.isInteger(occurrenceSnapshot.data()?.nextOccurrence)
          ? occurrenceSnapshot.data()!.nextOccurrence as number
          : 2;
        const newExecutionId = workoutExecutionId(executionScopeId, sessionIndex, scheduledLocalDate, nextOccurrence);
        const newRef = executionRef(uid, newExecutionId);
        const newSnapshot = await transaction.get(newRef);
        if (newSnapshot.exists()) {
          // Should be unreachable — the counter is the sole allocator of this
          // id, read-then-incremented in this same transaction. Fails closed
          // rather than silently overwriting a real execution.
          throw new Error('EXECUTION_OCCURRENCE_COLLISION');
        }
        transaction.set(occurrenceCounterRef, { nextOccurrence: nextOccurrence + 1, updatedAt: serverTimestamp() });
        transaction.set(newRef, {
          ...base, occurrence: nextOccurrence, startedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(stateRef, { ...pointerFor(newExecutionId), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        return { kind: 'created', executionId: newExecutionId, occurrence: nextOccurrence };
      }

      transaction.set(baseRef, { ...base, occurrence: 1, startedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(stateRef, { ...pointerFor(baseExecutionId), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return { kind: 'created', executionId: baseExecutionId, occurrence: 1 };
    });
    logInfo('workout_execution', 'start_transaction_completed', {
      durationMs: Date.now() - transactionStartedAtMs,
      outcome: transactionResult.kind,
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      logInfo('workout_performance', 'transaction_end', {
        timestampMs: Date.now(),
        durationMs: Date.now() - transactionStartedAtMs,
        outcome: transactionResult.kind,
        success: true,
        callbackRuns: transactionCallbackRun,
      });
    }
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
      firestoreErrorCode: errorCode(error),
      errorClass: errorClass(error),
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      logInfo('workout_performance', 'transaction_end', {
        timestampMs: Date.now(),
        durationMs: Date.now() - transactionStartedAtMs,
        success: false,
        callbackRuns: transactionCallbackRun,
        firestoreErrorCode: errorCode(error),
        errorClass: errorClass(error),
      });
    }
    throw error;
  }

  if (transactionResult?.kind === 'existing') {
    logInfo('workout_execution', 'start_service_succeeded', {
      durationMs: Date.now() - serviceStartedAtMs,
      materialization: 'transaction',
    });
    return transactionResult.execution;
  }

  // The transaction commit is the durable authority. Its exact write payload
  // is sufficient to enable mutations safely; only server timestamps remain
  // unresolved. Project those timestamps locally for UI and reconcile the
  // canonical values in the hook without blocking WorkoutScreen.
  const projectedAt = Timestamp.fromMillis(serviceStartedAtMs);
  const result: PersistedWorkoutExecution = {
    executionId: transactionResult.executionId,
    ...base,
    occurrence: transactionResult.occurrence,
    startedAt: projectedAt,
    createdAt: transactionResult.kind === 'restarted' ? transactionResult.createdAt : projectedAt,
    updatedAt: projectedAt,
    timestampAuthority: 'LOCAL_UI_PROJECTION',
  };
  logInfo('workout_execution', 'start_materialization_completed', {
    durationMs: 0,
    source: 'committed-write-projection',
  });
  logInfo('workout_execution', 'start_service_succeeded', {
    durationMs: Date.now() - serviceStartedAtMs,
    materialization: 'committed-write-projection',
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

/**
 * Edits the actual facts of an already-COMPLETED set in the same authoritative
 * execution array. The surrounding execution must still be IN_PROGRESS and
 * the selected set must still be COMPLETED when the transaction reads it.
 * A partial patch lets a reps-only edit preserve a concurrently-updated load
 * (and vice versa); Firestore retries the transaction against the latest
 * document snapshot on contention.
 */
export async function editCompletedSetExecution(input: {
  uid: string;
  executionId: string;
  exerciseIndex: number;
  setIndex: number;
  patch: CompletedSetEditPatch;
}): Promise<SetExecution> {
  const ref = executionRef(input.uid, input.executionId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('EXECUTION_NOT_FOUND');
    const data = snapshot.data();
    if (data.status !== 'IN_PROGRESS') throw new Error('EXECUTION_NOT_IN_PROGRESS');
    const edited = applyCompletedSetEdit(
      data.exercises as ExerciseExecution[],
      input.exerciseIndex,
      input.setIndex,
      input.patch,
    );
    transaction.update(ref, { exercises: edited.exercises, updatedAt: serverTimestamp() });
    return edited.set;
  });
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
  // Temporary local performance trace (2026-09-11 latency audit). Technical
  // timing only; deliberately excludes uid, executionId and workout data.
  logInfo('workout_performance', 'cardio_callable_start', { timestampMs: startedAtMs });
  try {
    const result = await completeCardioTransport({ executionId, actualDurationSeconds });
    logInfo('workout_performance', 'cardio_callable_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - startedAtMs,
      success: true,
    });
    logInfo('workout_execution', 'cardio_persist_completed', {
      executionId,
      durationMs: Date.now() - startedAtMs,
    });
    return result;
  } catch (error) {
    logInfo('workout_performance', 'cardio_callable_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - startedAtMs,
      success: false,
    });
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
  const preflightStartedAtMs = Date.now();
  logInfo('workout_performance', 'finish_preflight_read_start', { timestampMs: preflightStartedAtMs });
  let existing;
  try {
    existing = await getDoc(ref);
    logInfo('workout_performance', 'finish_preflight_read_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - preflightStartedAtMs,
      success: true,
    });
  } catch (error) {
    logInfo('workout_performance', 'finish_preflight_read_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - preflightStartedAtMs,
      success: false,
    });
    throw error;
  }
  if (existing.exists() && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(existing.data().status)) {
    return { status: existing.data().status as 'COMPLETED' | 'PARTIALLY_COMPLETED' };
  }
  const requiresV2Authority = typeof existing.data()?.programInstanceId === 'string';
  if (requiresV2Authority) {
    const authorizationStartedAtMs = Date.now();
    logInfo('workout_performance', 'finish_authorization_start', { timestampMs: authorizationStartedAtMs });
    try {
      await authorizeWorkoutLifecycleMutation({ operation: 'FINISH_EXECUTION', executionId });
      logInfo('workout_performance', 'finish_authorization_end', {
        timestampMs: Date.now(),
        durationMs: Date.now() - authorizationStartedAtMs,
        success: true,
      });
    } catch (error) {
      logInfo('workout_performance', 'finish_authorization_end', {
        timestampMs: Date.now(),
        durationMs: Date.now() - authorizationStartedAtMs,
        success: false,
      });
      throw error;
    }
  }
  const grantRef = doc(db, USERS, uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID);
  const transactionStartedAtMs = Date.now();
  logInfo('workout_performance', 'finish_transaction_start', { timestampMs: transactionStartedAtMs });
  try {
    const result = await runTransaction(db, async (transaction) => {
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
    logInfo('workout_performance', 'finish_transaction_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - transactionStartedAtMs,
      success: true,
    });
    return result;
  } catch (error) {
    logInfo('workout_performance', 'finish_transaction_end', {
      timestampMs: Date.now(),
      durationMs: Date.now() - transactionStartedAtMs,
      success: false,
    });
    throw error;
  }
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
  return snapshot.docs
    .map((item) => fromDoc(item.id, item.data()))
    .sort((a, b) => (b.performedLocalDate ?? b.scheduledLocalDate)
      .localeCompare(a.performedLocalDate ?? a.scheduledLocalDate));
}

/**
 * Recovery source for health-workout export. `finishedAt` is written only by
 * the authoritative backend terminalization (or the explicit abandon path),
 * so this bounded-field query can discover a completion whose callable
 * response/process-local enqueue was lost. Status and the deterministic
 * Schedule event are still checked by the export orchestrator before any
 * native write; an ABANDONED document returned here is never exportable.
 *
 * Pagination is deliberate: a device can remain offline for a long time and
 * must not permanently strand records after an arbitrary first-page cap.
 * This uses only one range/order field and therefore needs no composite index.
 */
export async function listWorkoutExecutionsFinishedSince(
  uid: string,
  since: Date,
): Promise<PersistedWorkoutExecution[]> {
  const results: PersistedWorkoutExecution[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  const pageSize = 100;
  for (;;) {
    const pageQuery: Query<DocumentData> = cursor
      ? query(
          executionsCollection(uid),
          where('finishedAt', '>=', Timestamp.fromDate(since)),
          orderBy('finishedAt', 'asc'),
          startAfter(cursor),
          fsLimit(pageSize),
        )
      : query(
          executionsCollection(uid),
          where('finishedAt', '>=', Timestamp.fromDate(since)),
          orderBy('finishedAt', 'asc'),
          fsLimit(pageSize),
        );
    countFirestoreRead('workout_executions.health_export_recovery');
    const snapshot: QuerySnapshot<DocumentData> = await getDocs(pageQuery);
    snapshot.docs.forEach((item: QueryDocumentSnapshot<DocumentData>) => results.push(fromDoc(item.id, item.data())));
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs.at(-1) ?? null;
    if (!cursor) break;
  }
  return results;
}

/**
 * Real source for Evolução > Cargas. It intentionally spans program changes
 * and includes the current IN_PROGRESS execution, because a confirmed set
 * must appear immediately. The high safety cap bounds reads while retaining
 * several years of normal training history for the practical PR baseline.
 */
export async function listWorkoutExecutionsForLoadProgress(
  uid: string,
): Promise<PersistedWorkoutExecution[]> {
  const q = query(
    executionsCollection(uid),
    orderBy('scheduledLocalDate', 'desc'),
    fsLimit(2000),
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
  countFirestoreRead('workout_executions.program_instance');
  const snapshot = await getDocs(q);
  return snapshot.docs.map((item) => fromDoc(item.id, item.data()));
}

/**
 * Distinct real activity dates (`performedLocalDate ?? scheduledLocalDate`)
 * with a COMPLETED or
 * PARTIALLY_COMPLETED execution within `[fromLocalDate, toLocalDate]`
 * (inclusive) — the Home screen's weekly overview and frequency heatmap
 * share this single bounded read instead of one query per day/week (docs
 * §41/§45: history is derived entirely from `workoutExecutions`, unscoped by
 * program, so a since-superseded program's completions still count). Status
 * is filtered client-side. V1 only permits an advanced execution one local
 * day ahead, so extending the scheduled-date upper bound by one day keeps
 * this a single bounded query while including a workout performed at the
 * end of the requested range for tomorrow's opportunity.
 */
export interface CompletedWorkoutActivityDates {
  /** Real activity dates for history/heatmaps/week visuals. */
  performedDates: string[];
  /** Prescribed opportunities fulfilled by those executions. */
  scheduledDates: string[];
}

export async function listCompletedWorkoutActivityDatesInRange(
  uid: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<CompletedWorkoutActivityDates> {
  const q = query(
    executionsCollection(uid),
    where('scheduledLocalDate', '>=', fromLocalDate),
    where('scheduledLocalDate', '<=', addDaysLocal(toLocalDate, 1)),
  );
  countFirestoreRead('workout_executions.range_query');
  const snapshot = await getDocs(q);
  const performedDates = new Set<string>();
  const scheduledDates = new Set<string>();
  const scheduledUpperBound = addDaysLocal(toLocalDate, 1);
  snapshot.docs.forEach((item) => {
    const data = item.data();
    const status = data.status as WorkoutExecutionStatus;
    if (status === 'COMPLETED' || status === 'PARTIALLY_COMPLETED') {
      const performedLocalDate = typeof data.performedLocalDate === 'string'
        ? data.performedLocalDate
        : data.scheduledLocalDate as string;
      if (performedLocalDate >= fromLocalDate && performedLocalDate <= toLocalDate) {
        performedDates.add(performedLocalDate);
      }
      if (data.scheduledLocalDate >= fromLocalDate && data.scheduledLocalDate <= scheduledUpperBound) {
        scheduledDates.add(data.scheduledLocalDate as string);
      }
    }
  });
  return { performedDates: Array.from(performedDates), scheduledDates: Array.from(scheduledDates) };
}

export async function listCompletedWorkoutDatesInRange(
  uid: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<string[]> {
  return (await listCompletedWorkoutActivityDatesInRange(uid, fromLocalDate, toLocalDate)).performedDates;
}

export type { PersistedWorkoutExecution };
