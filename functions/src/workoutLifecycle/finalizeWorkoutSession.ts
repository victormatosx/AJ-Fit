import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { logInfo, logWarn } from '../lib/logger';
import { buildScheduleAuthorityContext, prescribedExecutionCounts } from './finalizationAuthority';
import { validateMaterializedExecutionSubstitutions } from './exerciseSubstitution';
import { detectMissedSessionGap, resolveWorkoutSchedule } from './scheduleEngine/resolver';
import { scheduleEventDocumentId } from './scheduleEngine/identities';
import { addDaysLocal } from './scheduleEngine/calendar';
import { localDateInTimezone } from './scheduleEngine/localDate';

export const MAX_CARDIO_ACTUAL_DURATION_SECONDS = 3 * 60 * 60;

export interface FinalizeWorkoutSessionRequest {
  executionId: string;
  cardio?: { actualDurationSeconds: number };
}

export interface FinalizeWorkoutSessionResult {
  status: 'COMPLETED';
  executionStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED';
  cardioStatus: 'NOT_APPLICABLE' | 'COMPLETED';
  scheduleStatus: 'COMPLETED';
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

function parseRequest(value: unknown): FinalizeWorkoutSessionRequest {
  if (!plainObject(value) || !boundedId(value.executionId)) {
    throw new HttpsError('invalid-argument', 'invalid_finalize_workout_session_request');
  }
  if (value.cardio !== undefined
    && (!plainObject(value.cardio) || !validDuration(value.cardio.actualDurationSeconds))) {
    throw new HttpsError('invalid-argument', 'invalid_cardio_duration');
  }
  const allowed = new Set(['executionId', 'cardio']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new HttpsError('invalid-argument', 'invalid_finalize_workout_session_request');
  }
  return value as unknown as FinalizeWorkoutSessionRequest;
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

function eventId(instanceId: string, sessionIndex: number, date: string): string {
  return `${instanceId}_completed_${sessionIndex}_${date}`;
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
      default: return error.code.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    }
  }
  return 'INTERNAL_ERROR';
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

  const root = firestore.collection('users').doc(uid);
  const executionRef = root.collection('workoutExecutions').doc(data.executionId);
  const preflight = await executionRef.get();
  if (!preflight.exists) throw new HttpsError('not-found', 'execution_not_found');
  const initialExecution = preflight.data()!;
  mark(startedAt, 'execution_loaded');
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
  if (!initialSession || prescribedExecutionCounts(
    initialExecution, initialSession, initialExecution.programInstanceId,
  ) === null) {
    throw new HttpsError('permission-denied', 'execution_does_not_match_authoritative_prescription');
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
  if (!hasCardio && data.cardio) throw new HttpsError('failed-precondition', 'session_has_no_cardio_finisher');
  if (hasCardio && !cardioCompleted && !data.cardio) {
    throw new HttpsError('failed-precondition', 'cardio_completion_required');
  }
  if (hasCardio && !cardioCompleted && initialExecution.status !== 'IN_PROGRESS') {
    throw new HttpsError('failed-precondition', 'terminal_execution_missing_cardio');
  }
  mark(startedAt, 'cardio_validation_end');

  const scheduleConfigRef = root.collection('workoutProgramState').doc('scheduleConfig');
  const activeProgramRef = root.collection('workoutProgramState').doc('active');
  const lifecycleStateRef = root.collection('workoutLifecycleState').doc('current');
  const scheduleStateRef = programRef.collection('scheduleState').doc(initialExecution.programInstanceId);
  const completionEventRef = programRef.collection('scheduleEvents').doc(eventId(
    initialExecution.programInstanceId,
    initialExecution.sessionIndex,
    initialExecution.scheduledLocalDate,
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
    if (!session || prescribedExecutionCounts(execution, session, execution.programInstanceId) === null) {
      throw new HttpsError('permission-denied', 'execution_does_not_match_authoritative_prescription');
    }
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
        ...(hasCardio && !cardioCompleted ? {
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
      cardioStatus: hasCardio ? 'COMPLETED' as const : 'NOT_APPLICABLE' as const,
      scheduleStatus: 'COMPLETED' as const,
    };
    });
  } catch (error) {
    mark(startedAt, 'transaction_end', { success: false, reasonCode: safeReasonCode(error) });
    throw error;
  }
  mark(startedAt, 'transaction_end', { success: true });
  return result;
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
