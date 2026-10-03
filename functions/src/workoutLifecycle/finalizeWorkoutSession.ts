import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { logInfo, logWarn, type LogContext } from '../lib/logger';
import { buildScheduleAuthorityContext, prescribedExecutionCounts } from './finalizationAuthority';
import { validateMaterializedExecutionSubstitutions } from './exerciseSubstitution';
import { detectMissedSessionGap, resolveWorkoutSchedule } from './scheduleEngine/resolver';
import { scheduleEventDocumentId } from './scheduleEngine/identities';
import { addDaysLocal } from './scheduleEngine/calendar';
import { localDateInTimezone } from './scheduleEngine/localDate';
import type { ScheduleResolution } from './scheduleEngine/types';

export const MAX_CARDIO_ACTUAL_DURATION_SECONDS = 3 * 60 * 60;

export type WorkoutFinalizationMode = 'NORMAL' | 'EARLY';

export interface WorkoutCompletionResult {
  plannedSets: number;
  completedSets: number;
  percentageBasisPoints: number;
}

export interface FinalizeWorkoutSessionRequest {
  executionId: string;
  /** Omitted requests retain the pre-existing NORMAL behavior. */
  mode?: WorkoutFinalizationMode;
  cardio?: { actualDurationSeconds: number };
}

type ParsedFinalizeWorkoutSessionRequest = Omit<FinalizeWorkoutSessionRequest, 'mode'> & {
  mode: WorkoutFinalizationMode;
};

export interface FinalizeWorkoutSessionResult {
  status: 'COMPLETED';
  executionStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED';
  cardioStatus: 'NOT_APPLICABLE' | 'COMPLETED' | 'SKIPPED';
  scheduleStatus: 'COMPLETED';
  completion: WorkoutCompletionResult;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    && value >= 0 && value <= MAX_CARDIO_ACTUAL_DURATION_SECONDS;
}

export function completionFromCounts(counts: { completed: number; prescribed: number }): WorkoutCompletionResult {
  return {
    plannedSets: counts.prescribed,
    completedSets: counts.completed,
    percentageBasisPoints: Math.round((counts.completed / counts.prescribed) * 10_000),
  };
}

function parseRequest(value: unknown): ParsedFinalizeWorkoutSessionRequest {
  if (!plainObject(value) || !boundedId(value.executionId)) {
    throw new HttpsError('invalid-argument', 'invalid_finalize_workout_session_request');
  }
  if (value.cardio !== undefined
    && (!plainObject(value.cardio) || !validDuration(value.cardio.actualDurationSeconds))) {
    throw new HttpsError('invalid-argument', 'invalid_cardio_duration');
  }
  if (value.mode !== undefined && value.mode !== 'NORMAL' && value.mode !== 'EARLY') {
    throw new HttpsError('invalid-argument', 'invalid_finalize_workout_session_mode');
  }
  if (value.mode === 'EARLY' && value.cardio !== undefined) {
    throw new HttpsError('invalid-argument', 'early_finish_cannot_complete_cardio');
  }
  const allowed = new Set(['executionId', 'mode', 'cardio']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new HttpsError('invalid-argument', 'invalid_finalize_workout_session_request');
  }
  return {
    executionId: value.executionId,
    mode: value.mode === 'EARLY' ? 'EARLY' : 'NORMAL',
    ...(value.cardio === undefined ? {} : { cardio: value.cardio as { actualDurationSeconds: number } }),
  };
}

function executionShape(execution: DocumentData): string {
  return JSON.stringify({
    programId: execution.programId,
    programInstanceId: execution.programInstanceId,
    sessionIndex: execution.sessionIndex,
    scheduledLocalDate: execution.scheduledLocalDate,
    performedLocalDate: execution.performedLocalDate,
    exercises: Array.isArray(execution.exercises) ? execution.exercises.map((item: DocumentData) => ({
      exerciseIndex: item.exerciseIndex,
      prescribedExerciseId: item.prescribedExerciseId ?? item.exerciseId,
      exerciseId: item.exerciseId,
      substitution: item.substitution ?? null,
    })) : null,
  });
}

function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return addDaysLocal(value, 0) === value;
  } catch {
    return false;
  }
}

function sweepAndStatus(exercises: DocumentData[]): {
  exercises: DocumentData[];
  status: 'COMPLETED' | 'PARTIALLY_COMPLETED';
} {
  const swept = exercises.map((exercise) => ({
    ...exercise,
    sets: (exercise.sets as DocumentData[]).map((set) =>
      set.status === 'PENDING' ? { ...set, status: 'SKIPPED' } : set),
  }));
  const complete = swept.every((exercise) =>
    (exercise.sets as DocumentData[]).every((set) => set.status === 'COMPLETED'));
  return { exercises: swept, status: complete ? 'COMPLETED' : 'PARTIALLY_COMPLETED' };
}

/**
 * `occurrence` is read off the execution's own `occurrence` field, never
 * recomputed independently — the execution document is the single source of
 * truth for which occurrence it is (docs — `WorkoutExecution.occurrence`'s
 * doc comment). Omitted/`1` reproduces the original id byte-for-byte, so
 * every execution written before this field existed, and every `fixed`
 * schedule, keep their historical completion-event id with no migration.
 * Only a `flexible` schedule's genuine same-day repeat (`occurrence >= 2`,
 * which never existed before this field was introduced, so there is no prior
 * id to collide with) gets a distinguishing suffix — the same `_oN`
 * convention `workoutExecutionDocumentId` uses for the execution id itself.
 */
function eventId(instanceId: string, sessionIndex: number, date: string, occurrence: number): string {
  const base = `${instanceId}_completed_${sessionIndex}_${date}`;
  return occurrence > 1 ? `${base}_o${occurrence}` : base;
}

function mark(startedAt: number, message: string, extra?: Record<string, string | number | boolean | null>): void {
  logInfo('workout.finalize', message, { durationMs: Date.now() - startedAt, ...extra });
}

function safeReasonCode(error: unknown): string {
  if (error instanceof HttpsError) {
    switch (error.message) {
      case 'schedule_completion_session_not_expected': return 'SESSION_NOT_EXPECTED';
      case 'execution_program_not_active': return 'PROGRAM_NOT_ACTIVE';
      case 'program_instance_mismatch': return 'PROGRAM_INSTANCE_MISMATCH';
      case 'schedule_not_configured': return 'SCHEDULE_NOT_CONFIGURED';
      case 'advanced_workout_not_next_opportunity': return 'ADVANCE_NOT_NEXT_OPPORTUNITY';
      case 'invalid_execution_performed_date': return 'INVALID_PERFORMED_DATE';
      case 'execution_does_not_match_authoritative_prescription': return 'PRESCRIPTION_MISMATCH';
      // Diagnostic-only labels below — purely for log readability; they were
      // previously indistinguishable under the generic `error.code` fallback
      // (all surface as the same `failed-precondition` HTTP status). Adding
      // them here never changes what's thrown to the client, only what this
      // function reports to Cloud Logging.
      case 'execution_prescription_referent_missing': return 'PRESCRIPTION_REFERENT_MISSING';
      case 'execution_not_finishable': return 'EXECUTION_NOT_FINISHABLE';
      case 'execution_changed_during_finalization': return 'EXECUTION_CHANGED_DURING_FINALIZATION';
      case 'program_instance_activation_missing': return 'PROGRAM_INSTANCE_ACTIVATION_MISSING';
      case 'session_has_no_cardio_finisher': return 'CARDIO_NOT_EXPECTED';
      case 'cardio_completion_required': return 'CARDIO_COMPLETION_REQUIRED';
      case 'terminal_execution_missing_cardio': return 'TERMINAL_EXECUTION_MISSING_CARDIO';
      case 'early_finish_requires_completed_set': return 'EARLY_FINISH_REQUIRES_COMPLETED_SET';
      case 'execution_substitution_not_authoritative': return 'SUBSTITUTION_NOT_AUTHORITATIVE';
      case 'execution_not_found': return 'EXECUTION_NOT_FOUND';
      default: return error.code.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    }
  }
  return 'INTERNAL_ERROR';
}

/** Diagnostic-only: mirrors the client's `workoutFinalizationFailureStage` so server logs and client logs agree on which boundary rejected the attempt. */
function safeStage(error: unknown): 'EXECUTION' | 'SCHEDULE' {
  if (error instanceof HttpsError && error.details && typeof error.details === 'object'
    && 'stage' in error.details && (error.details as { stage?: unknown }).stage === 'SCHEDULE') {
    return 'SCHEDULE';
  }
  return 'EXECUTION';
}

/** Diagnostic-only: flattens the union into log-safe scalars (LogContext has no nested-object support, by design — see lib/logger.ts). */
function resolutionLogFields(resolution: ScheduleResolution): LogContext {
  switch (resolution.status) {
    case 'SESSION_READY':
      return { resolutionStatus: resolution.status, resolutionSessionIndex: resolution.sessionIndex };
    case 'REST_DAY':
    case 'ACTIVE_RECOVERY_DAY':
    case 'TODAY_COMPLETED':
      return {
        resolutionStatus: resolution.status,
        resolutionNextWorkoutDate: resolution.nextWorkoutDate,
        resolutionNextSessionIndex: resolution.nextSessionIndex,
      };
    case 'MISSED_SESSION_DECISION_REQUIRED':
      return {
        resolutionStatus: resolution.status,
        resolutionMissedSessionIndex: resolution.missedSessionIndex,
        resolutionCalendarSessionIndex: resolution.calendarSessionIndex,
        resolutionMissedScheduledDate: resolution.missedScheduledDate,
      };
    default:
      return { resolutionStatus: resolution.status };
  }
}

/**
 * One authenticated, attested server-authoritative durable boundary for a
 * workout. All mutable completion facts are committed in one transaction;
 * lifecycle/projections deliberately remain client-side follow-up work.
 */
async function finalizeWorkoutSessionCore(
  request: CallableRequest,
  firestore: Firestore,
  startedAt: number,
): Promise<FinalizeWorkoutSessionResult> {
  const uid = requireAuth(request);
  const data = parseRequest(request.data);
  mark(startedAt, 'auth_validation_end');

  // Diagnostic-only correlation record (docs Etapa 8 — observability gap):
  // filled in as each value becomes known, logged once in the catch below
  // whenever this attempt fails. `executionId`/`programInstanceId` are
  // internal opaque ids (`wpi_..._n_YYYY-MM-DD` / `wpg_...`), never PII;
  // `uid` is masked the same way every other `logInfo`/`logWarn` call in
  // this codebase already masks it (see lib/logger.ts's `maskIdentifier`).
  // Never used for any business decision — read-only bookkeeping.
  const diag: LogContext = { executionId: data.executionId, uid };

  try {
    const root = firestore.collection('users').doc(uid);
    const executionRef = root.collection('workoutExecutions').doc(data.executionId);
    const preflight = await executionRef.get();
    if (!preflight.exists) throw new HttpsError('not-found', 'execution_not_found');
    const initialExecution = preflight.data()!;
    mark(startedAt, 'execution_loaded');
    diag.programInstanceId = typeof initialExecution.programInstanceId === 'string' ? initialExecution.programInstanceId : null;
    diag.sessionIndex = Number.isInteger(initialExecution.sessionIndex) ? initialExecution.sessionIndex : null;
    diag.executionStatus = typeof initialExecution.status === 'string' ? initialExecution.status : null;
  if (!boundedId(initialExecution.programInstanceId)) {
    throw new HttpsError('failed-precondition', 'program_instance_mismatch');
  }
  if (!boundedId(initialExecution.programId)
    || !Number.isInteger(initialExecution.sessionIndex)
    || typeof initialExecution.scheduledLocalDate !== 'string') {
    throw new HttpsError('failed-precondition', 'execution_prescription_referent_missing');
  }
  if (!['IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(initialExecution.status)) {
    throw new HttpsError('failed-precondition', 'execution_not_finishable');
  }

  const instanceRef = root.collection('programInstances').doc(initialExecution.programInstanceId);
  const programRef = root.collection('workoutPrograms').doc(initialExecution.programId);
  const [instancePreflight, programPreflight] = await Promise.all([instanceRef.get(), programRef.get()]);
  if (!instancePreflight.exists || !programPreflight.exists
    || instancePreflight.data()?.contentIdentity !== initialExecution.programId) {
    throw new HttpsError('failed-precondition', 'execution_prescription_referent_missing');
  }
  const initialProgram = programPreflight.data()!;
  const initialSession = Array.isArray(initialProgram.sessions)
    ? initialProgram.sessions[initialExecution.sessionIndex] : null;
  const initialCounts = initialSession ? prescribedExecutionCounts(
    initialExecution, initialSession, initialExecution.programInstanceId,
  ) : null;
  if (!initialSession || initialCounts === null) {
    throw new HttpsError('permission-denied', 'execution_does_not_match_authoritative_prescription');
  }
  if (data.mode === 'EARLY' && initialCounts.completed === 0) {
    throw new HttpsError('failed-precondition', 'early_finish_requires_completed_set');
  }
  const substitution = await validateMaterializedExecutionSubstitutions(uid, initialExecution, firestore);
  if (!substitution.valid) {
    logWarn('workout.finalize', 'execution_substitution_not_authoritative', { reason: substitution.reason });
    throw new HttpsError('permission-denied', 'execution_substitution_not_authoritative', { reason: substitution.reason });
  }
  mark(startedAt, 'execution_validation_end');

  const hasCardio = plainObject(initialSession.cardioFinisher);
  const cardioCompleted = plainObject(initialExecution.cardio)
    && initialExecution.cardio.status === 'COMPLETED'
    && validDuration(initialExecution.cardio.actualDurationSeconds);
  const cardioSkipped = plainObject(initialExecution.cardio)
    && initialExecution.cardio.status === 'SKIPPED'
    && initialExecution.cardio.reason === 'EARLY_FINISH';
  if (!hasCardio && data.cardio) throw new HttpsError('failed-precondition', 'session_has_no_cardio_finisher');
  if (data.mode === 'NORMAL' && hasCardio && !cardioCompleted && !cardioSkipped && !data.cardio) {
    throw new HttpsError('failed-precondition', 'cardio_completion_required');
  }
  if (data.mode === 'NORMAL' && hasCardio && !cardioCompleted && !cardioSkipped
    && initialExecution.status !== 'IN_PROGRESS') {
    throw new HttpsError('failed-precondition', 'terminal_execution_missing_cardio');
  }
  mark(startedAt, 'cardio_validation_end');

  const scheduleConfigRef = root.collection('workoutProgramState').doc('scheduleConfig');
  const activeProgramRef = root.collection('workoutProgramState').doc('active');
  const lifecycleStateRef = root.collection('workoutLifecycleState').doc('current');
  const scheduleStateRef = programRef.collection('scheduleState').doc(initialExecution.programInstanceId);
  // Immutable once the execution exists — safe to read off the preflight
  // snapshot, same as the other identity fields `eventId` already uses here.
  const occurrence = Number.isInteger(initialExecution.occurrence) && initialExecution.occurrence > 0
    ? initialExecution.occurrence : 1;
  const completionEventRef = programRef.collection('scheduleEvents').doc(eventId(
    initialExecution.programInstanceId,
    initialExecution.sessionIndex,
    initialExecution.scheduledLocalDate,
    occurrence,
  ));
  const currentRef = root.collection('workoutExecutionState').doc('current');
  const validatedShape = executionShape(initialExecution);

  mark(startedAt, 'transaction_start');
  let result: FinalizeWorkoutSessionResult;
  try {
    result = await firestore.runTransaction(async (transaction) => {
    const [executionSnapshot, instanceSnapshot, programSnapshot, configSnapshot, stateSnapshot, eventSnapshot,
      currentSnapshot, activeProgramSnapshot, lifecycleStateSnapshot]
      = await Promise.all([
        transaction.get(executionRef), transaction.get(instanceRef), transaction.get(programRef),
        transaction.get(scheduleConfigRef), transaction.get(scheduleStateRef),
        transaction.get(completionEventRef), transaction.get(currentRef), transaction.get(activeProgramRef),
        transaction.get(lifecycleStateRef),
      ]);
    if (!executionSnapshot.exists || !instanceSnapshot.exists || !programSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'execution_prescription_referent_missing');
    }
    const execution = executionSnapshot.data()!;
    const instance = instanceSnapshot.data()!;
    const program = programSnapshot.data()!;
    if (executionShape(execution) !== validatedShape) {
      throw new HttpsError('aborted', 'execution_changed_during_finalization');
    }
    if (instance.contentIdentity !== execution.programId
      || execution.programInstanceId !== initialExecution.programInstanceId) {
      throw new HttpsError('failed-precondition', 'program_instance_mismatch');
    }
    const session = Array.isArray(program.sessions) ? program.sessions[execution.sessionIndex] : null;
    const freshCounts = session
      ? prescribedExecutionCounts(execution, session, execution.programInstanceId)
      : null;
    if (!session || freshCounts === null) {
      throw new HttpsError('permission-denied', 'execution_does_not_match_authoritative_prescription');
    }
    if (data.mode === 'EARLY' && freshCounts.completed === 0) {
      throw new HttpsError('failed-precondition', 'early_finish_requires_completed_set');
    }
    const completion = completionFromCounts(freshCounts);
    const freshHasCardio = plainObject(session.cardioFinisher);
    const freshCardioCompleted = plainObject(execution.cardio)
      && execution.cardio.status === 'COMPLETED'
      && validDuration(execution.cardio.actualDurationSeconds);
    const freshCardioSkipped = plainObject(execution.cardio)
      && execution.cardio.status === 'SKIPPED'
      && execution.cardio.reason === 'EARLY_FINISH';
    const context = buildScheduleAuthorityContext({
      scheduleConfigData: configSnapshot.data() ?? {},
      stateData: stateSnapshot.exists ? stateSnapshot.data()! : null,
      instance,
      program,
    });
    if (context.sessionCount <= 0
      || ((context.config.scheduleMode ?? 'fixed') === 'fixed' && context.config.trainingDays.length === 0)) {
      throw new HttpsError('failed-precondition', 'schedule_not_configured', { stage: 'SCHEDULE' });
    }
    if (!eventSnapshot.exists) {
      // A gap that's already been decided (docs §Decisão idempotente) must
      // not re-trip the guard below — mirrors the same lookup the client
      // does before reading the schedule (`src/services/workoutSchedule.ts`).
      // Without it, any session completed after a resolved missed-day
      // decision is rejected as SCHEDULE-stage `permission-denied` forever,
      // since `resolveWorkoutSchedule` alone has no way to know the gap it
      // sees was already resolved.
      const gap = detectMissedSessionGap({
        hasActiveProgram: true,
        sessionCount: context.sessionCount,
        config: context.config,
        state: context.state,
        activatedAtLocalDate: context.activatedAtLocalDate,
        todayLocalDate: execution.scheduledLocalDate,
      });
      let resolvedMissScheduledDate: string | null = null;
      if (gap) {
        const missResolvedRef = programRef.collection('scheduleEvents').doc(scheduleEventDocumentId({
          type: 'MISS_RESOLVED',
          sessionIndex: gap.missedSessionIndex,
          scheduledDate: gap.missedScheduledDate,
          programInstanceId: execution.programInstanceId,
        }));
        const missResolvedSnapshot = await transaction.get(missResolvedRef);
        const missResolvedData = missResolvedSnapshot.data();
        // Firestore rules gate *what content* a MISS_RESOLVED event may hold
        // (it must match a real, server-issued RESOLVE_MISSED_SESSION grant)
        // but never bind the deterministic id itself to that content — an
        // owner can legally write grant-matched content under a document id
        // of their own choosing. Re-checking the fields (same as
        // `dailyWorkoutNotifications.ts`) closes that gap: existence at the
        // expected id is necessary but not sufficient.
        if (
          missResolvedSnapshot.exists
          && missResolvedData?.type === 'MISS_RESOLVED'
          && missResolvedData.programInstanceId === execution.programInstanceId
          && missResolvedData.sessionIndex === gap.missedSessionIndex
          && missResolvedData.scheduledDate === gap.missedScheduledDate
        ) {
          resolvedMissScheduledDate = gap.missedScheduledDate;
        }
      }
      if (program.status !== 'active'
        || instance.supersededAt !== null
        || activeProgramSnapshot.data()?.programId !== execution.programId
        || lifecycleStateSnapshot.data()?.activeProgramInstanceId !== execution.programInstanceId) {
        throw new HttpsError('failed-precondition', 'execution_program_not_active', { stage: 'SCHEDULE' });
      }
      const performedLocalDate = typeof execution.performedLocalDate === 'string'
        ? execution.performedLocalDate
        : execution.scheduledLocalDate;
      if (!validLocalDate(execution.scheduledLocalDate)
        || !validLocalDate(performedLocalDate)
        || performedLocalDate > execution.scheduledLocalDate
        || !(execution.createdAt instanceof Timestamp)
        || localDateInTimezone(execution.createdAt.toDate(), context.config.timezone) !== performedLocalDate) {
        throw new HttpsError('permission-denied', 'invalid_execution_performed_date', { stage: 'SCHEDULE' });
      }
      if (performedLocalDate < execution.scheduledLocalDate) {
        const performedResolution = resolveWorkoutSchedule({
          hasActiveProgram: true,
          sessionCount: context.sessionCount,
          scheduleMode: context.config.scheduleMode ?? 'fixed',
          config: context.config,
          state: context.state,
          activatedAtLocalDate: context.activatedAtLocalDate,
          todayLocalDate: performedLocalDate,
        });
        if ((context.config.scheduleMode ?? 'fixed') !== 'fixed'
          || addDaysLocal(performedLocalDate, 1) !== execution.scheduledLocalDate
          || performedResolution.status !== 'REST_DAY'
          || performedResolution.nextWorkoutDate !== execution.scheduledLocalDate
          || performedResolution.nextSessionIndex !== execution.sessionIndex) {
          throw new HttpsError('permission-denied', 'advanced_workout_not_next_opportunity', { stage: 'SCHEDULE' });
        }
      }
      const resolution = resolveWorkoutSchedule({
        hasActiveProgram: true,
        sessionCount: context.sessionCount,
        scheduleMode: context.config.scheduleMode ?? 'fixed',
        config: context.config,
        state: context.state,
        activatedAtLocalDate: context.activatedAtLocalDate,
        todayLocalDate: execution.scheduledLocalDate,
        resolvedMissScheduledDate,
      });
      if (resolution.status !== 'SESSION_READY' || resolution.sessionIndex !== execution.sessionIndex) {
        // Diagnostic-only breadcrumb (docs Etapa 8): logged only on the path
        // that's about to reject the finalize as SESSION_NOT_EXPECTED, right
        // before the throw — captures exactly the inputs/output of the one
        // comparison that decided this, so a production occurrence can be
        // explained without guessing. Never changes what's thrown, never
        // reads anything not already read above, never writes anything.
        logWarn('workout.finalize', 'session_not_expected_diagnostic', {
          ...diag,
          executionSessionIndex: execution.sessionIndex,
          executionScheduledLocalDate: execution.scheduledLocalDate,
          ...resolutionLogFields(resolution),
          stateNextSessionIndex: context.state?.nextSessionIndex ?? null,
          stateCursorDate: context.state?.cursorDate ?? null,
          stateLastCompletedAt: context.state?.lastCompletedAt ?? null,
          statePendingMissDecision: context.state?.pendingMissDecision != null,
          hasScheduleState: context.state !== null,
          gapDetected: gap !== null,
          gapMissedSessionIndex: gap?.missedSessionIndex ?? null,
          gapMissedScheduledDate: gap?.missedScheduledDate ?? null,
          gapCalendarSessionIndex: gap?.calendarSessionIndex ?? null,
          resolvedMissScheduledDate,
        });
        throw new HttpsError('permission-denied', 'schedule_completion_session_not_expected', { stage: 'SCHEDULE' });
      }
    }
    mark(startedAt, 'schedule_validation_end', { scheduleAlreadyCompleted: eventSnapshot.exists });

    let executionStatus = execution.status as 'COMPLETED' | 'PARTIALLY_COMPLETED';
    if (execution.status === 'IN_PROGRESS') {
      const terminal = sweepAndStatus(execution.exercises as DocumentData[]);
      executionStatus = terminal.status;
      transaction.update(executionRef, {
        exercises: terminal.exercises,
        status: terminal.status,
        completion,
        // Persisted explicitly so `PARTIALLY_COMPLETED` is never conflated
        // with "the user chose to finish early" — a plain NORMAL finish can
        // also land on PARTIALLY_COMPLETED if sets were skipped along the
        // way (docs — `WorkoutExecution.finalizationMode`'s doc comment).
        finalizationMode: data.mode,
        ...(data.mode === 'EARLY' && freshHasCardio && !freshCardioCompleted ? {
          cardio: {
            status: 'SKIPPED',
            reason: 'EARLY_FINISH',
            skippedAt: FieldValue.serverTimestamp(),
          },
        } : {}),
        ...(data.mode === 'NORMAL' && freshHasCardio && !freshCardioCompleted && data.cardio ? {
          cardio: {
            status: 'COMPLETED',
            actualDurationSeconds: data.cardio!.actualDurationSeconds,
            completedAt: FieldValue.serverTimestamp(),
          },
        } : {}),
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (currentSnapshot.exists && currentSnapshot.data()?.executionId === data.executionId) {
      transaction.delete(currentRef);
    }
    if (!eventSnapshot.exists) {
      transaction.set(completionEventRef, {
        type: 'COMPLETED',
        programInstanceId: execution.programInstanceId,
        sessionIndex: execution.sessionIndex,
        scheduledDate: execution.scheduledLocalDate,
        performedLocalDate: typeof execution.performedLocalDate === 'string'
          ? execution.performedLocalDate
          : execution.scheduledLocalDate,
        occurredAt: FieldValue.serverTimestamp(),
      });
      transaction.set(scheduleStateRef, {
        programId: execution.programId,
        programInstanceId: execution.programInstanceId,
        nextSessionIndex: (execution.sessionIndex + 1) % context.sessionCount,
        cursorDate: execution.scheduledLocalDate,
        lastCompletedAt: execution.scheduledLocalDate,
        pendingMissDecision: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      status: 'COMPLETED' as const,
      executionStatus,
      cardioStatus: !freshHasCardio
        ? 'NOT_APPLICABLE' as const
        : freshCardioCompleted || (execution.status === 'IN_PROGRESS' && data.mode === 'NORMAL' && !!data.cardio)
          ? 'COMPLETED' as const
          : freshCardioSkipped || data.mode === 'EARLY'
            ? 'SKIPPED' as const
            : 'NOT_APPLICABLE' as const,
      scheduleStatus: 'COMPLETED' as const,
      completion,
    };
    });
  } catch (error) {
    mark(startedAt, 'transaction_end', { success: false, reasonCode: safeReasonCode(error) });
    throw error;
  }
  mark(startedAt, 'transaction_end', { success: true });
  // Diagnostic-only: mirrors the failure-path `finalize_correlation` below so
  // a retry that fails and then succeeds can be joined on `executionId` alone
  // — previously only failures carried this id, so a success immediately
  // after a failure was unprovable from logs. Never a new read: `result` and
  // `diag` are already in scope from the work above.
  logInfo('workout.finalize', 'finalize_correlation', {
    ...diag,
    finalExecutionStatus: result.executionStatus,
    success: true,
    stage: 'COMPLETED',
    durationMs: Date.now() - startedAt,
  });
  return result;
  } catch (error) {
    // Diagnostic-only: never rethrows a different error, never mutates
    // anything — this is exactly the correlation line that was missing to
    // tie a production failure back to the exact Firestore documents
    // involved (docs Etapa 8). `diag` accumulates whatever was resolved
    // before the throw (executionId is always present; the rest is filled
    // in progressively once loaded). See `resolutionLogFields`/the
    // SESSION_NOT_EXPECTED pre-throw log above for the richer
    // schedule-specific breadcrumb.
    logWarn('workout.finalize', 'finalize_correlation', {
      ...diag,
      reasonCode: safeReasonCode(error),
      stage: safeStage(error),
      success: false,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function finalizeWorkoutSessionHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<FinalizeWorkoutSessionResult> {
  const startedAt = Date.now();
  mark(startedAt, 'finalize_handler_start');
  try {
    const result = await finalizeWorkoutSessionCore(request, firestore, startedAt);
    mark(startedAt, 'finalize_handler_end', { success: true });
    return result;
  } catch (error) {
    mark(startedAt, 'finalize_handler_end', { success: false, reasonCode: safeReasonCode(error) });
    throw error;
  }
}
