import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import type { WorkoutProgramSnapshot } from './workoutPrograms';
import {
  authorizeWorkoutLifecycleMutation,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../workoutLifecycle/authorityProvider';
import {
  WORKOUT_EXECUTION_SCHEMA_VERSION,
  WORKOUT_EXECUTION_LIFECYCLE_SCHEMA_VERSION,
  buildInitialExerciseExecutions,
  deriveFinishStatus,
  sweepPendingSetsToSkipped,
  workoutExecutionId,
  type ExerciseExecution,
  type SetExecution,
  type WorkoutExecution,
  type WorkoutExecutionStatus,
} from '../workoutExecution/types';

const USERS = 'users';
const WORKOUT_EXECUTIONS = 'workoutExecutions';

function executionsCollection(uid: string) {
  return collection(db, USERS, uid, WORKOUT_EXECUTIONS);
}

function executionRef(uid: string, executionId: string) {
  return doc(db, USERS, uid, WORKOUT_EXECUTIONS, executionId);
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
    executionSchemaVersion: data.executionSchemaVersion as number,
    createdAt: data.createdAt as Timestamp,
    updatedAt: data.updatedAt as Timestamp,
  };
}

/**
 * Starts a new execution for `sessionIndex`, or resumes/restarts the one
 * already at the deterministic doc id for (programId, sessionIndex,
 * scheduledLocalDate) — never creates a duplicate for a double tap, a
 * network retry, or a cold start reopening the app (docs §22–25).
 *
 * - `IN_PROGRESS` → returned as-is (resume with prior data intact).
 * - `ABANDONED` → restarted fresh (the abandoned attempt's logged sets are
 *   discarded; nothing counted from it anyway).
 * - `COMPLETED`/`PARTIALLY_COMPLETED` → this session is already done; throws
 *   rather than silently reopening a finished, immutable record.
 */
export async function startOrResumeWorkoutExecution(input: {
  uid: string;
  program: WorkoutProgramSnapshot;
  sessionIndex: number;
  scheduledLocalDate: string;
}): Promise<PersistedWorkoutExecution> {
  const { uid, program, sessionIndex, scheduledLocalDate } = input;
  const session = program.sessions[sessionIndex];
  if (!session) throw new Error('SESSION_INDEX_OUT_OF_RANGE');
  const executionScopeId = program.programInstanceId ?? program.programId;
  const executionId = workoutExecutionId(executionScopeId, sessionIndex, scheduledLocalDate);
  const ref = executionRef(uid, executionId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const status = snapshot.data().status as WorkoutExecutionStatus;
      if (status === 'IN_PROGRESS') return; // resume as-is, nothing to write.
      if (status !== 'ABANDONED') throw new Error('SESSION_ALREADY_FINISHED');
    }

    const base = {
      programId: program.programId,
      ...(program.programInstanceId ? { programInstanceId: program.programInstanceId } : {}),
      templateId: program.templateId,
      sessionIndex,
      sessionName: session.name,
      scheduledLocalDate,
      status: 'IN_PROGRESS' as const,
      exercises: buildInitialExerciseExecutions(session),
      executionSchemaVersion: program.programInstanceId
        ? WORKOUT_EXECUTION_LIFECYCLE_SCHEMA_VERSION
        : WORKOUT_EXECUTION_SCHEMA_VERSION,
      finishedAt: null,
    };

    if (snapshot.exists()) {
      // Restart after abandon: the abandoned attempt's logged sets are
      // discarded — nothing was counted from it. `startedAt`/`createdAt`
      // stay put; only the fresh attempt's data changes.
      transaction.update(ref, { ...base, updatedAt: serverTimestamp() });
    } else {
      transaction.set(ref, { ...base, startedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  });

  const result = await loadWorkoutExecution(uid, executionId);
  if (!result) throw new Error('EXECUTION_WRITE_FAILED');
  return result;
}

/** Loads an execution by id, or null if it doesn't exist. */
export async function loadWorkoutExecution(uid: string, executionId: string): Promise<PersistedWorkoutExecution | null> {
  const snapshot = await getDoc(executionRef(uid, executionId));
  if (!snapshot.exists()) return null;
  return fromDoc(executionId, snapshot.data());
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
    const snapshot = await transaction.get(ref);
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
    if (requiresV2Authority) transaction.delete(grantRef);
    return { status };
  });
}

/**
 * Abandons an IN_PROGRESS execution — deliberately distinct from finishing:
 * the Schedule Engine must never advance because of this (docs §36). No-op
 * if the execution is already in a terminal state (idempotent retry).
 */
export async function abandonWorkoutExecution(uid: string, executionId: string): Promise<void> {
  const ref = executionRef(uid, executionId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (data.status !== 'IN_PROGRESS') return;
    transaction.update(ref, { status: 'ABANDONED', finishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
