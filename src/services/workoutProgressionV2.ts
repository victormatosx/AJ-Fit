import { computeActiveTimeTrace } from '../progressionEngineV2/activeTime';
import { computeAdherence } from '../progressionEngineV2/adherence';
import { countEarnedIntermediateCycles } from '../progressionEngineV2/earnedCycles';
import {
  buildPrescribedOpportunities,
  buildFlexibleWeeklyTargets,
  countFulfilledFlexibleWeeklyTargets,
  countFulfilledPrescribedOpportunities,
} from '../progressionEngineV2/prescribedOpportunities';
import { evaluateProgressionV2 } from '../progressionEngineV2/resolver';
import { PROGRESSION_V2_CONFIG, resolveProgressionV2Config } from '../progressionEngineV2/config';
import type { ProgressionDecision, ProgressionSnapshotV2 } from '../progressionEngineV2/types';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  countFirestoreRead,
  perfNowMsSinceAppEpoch,
  recordPerfTrace,
  startPerfTimer,
} from '../lib/perf';
import { listExecutionsForProgramInstance, type PersistedWorkoutExecution } from './workoutExecutions';
import { listScheduleEventsForProgramInstance, loadScheduleConfig } from './workoutSchedule';
import {
  listRecentIntermediateTrainingCycles,
  loadWorkoutLifecycleDeduped,
  type PersistedWorkoutLifecycleBundle,
} from './workoutLifecycle';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';
import { resolveWorkoutLifecycleProgressionPolicy } from '../workoutLifecycle/qaPolicy';
import type { ScheduleMode, Weekday } from '../state/AppState';

async function loadAuthoritativePrescribedSessions(uid: string, contentIdentity: string) {
  countFirestoreRead('workout_programs.snapshot');
  const snapshot = await getDoc(doc(db, 'users', uid, 'workoutPrograms', contentIdentity));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const sessions = data.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const result: { exercises: { exerciseId: string; setCount: number }[] }[] = [];
  for (const session of sessions) {
    if (!session || !Array.isArray(session.exercises) || session.exercises.length === 0) return null;
    const exercises: { exerciseId: string; setCount: number }[] = [];
    for (const exercise of session.exercises) {
      const setCount = Number.isInteger(exercise?.sets) ? exercise.sets : 1;
      if (typeof exercise?.exerciseId !== 'string' || setCount < 1) return null;
      exercises.push({ exerciseId: exercise.exerciseId, setCount });
    }
    result.push({ exercises });
  }
  const scheduleMode: ScheduleMode = data.scheduleMode === 'flexible' ? 'flexible' : 'fixed';
  const trainingDays: Weekday[] = scheduleMode === 'fixed' && Array.isArray(data.weeklySchedule)
    ? data.weeklySchedule.flatMap((day: { state?: unknown; weekday?: unknown }) =>
      day.state === 'TRAINING' && typeof day.weekday === 'string' ? [day.weekday as Weekday] : [])
    : [];
  const prescribedTrainingFrequency = Number.isInteger(data.prescribedTrainingFrequency)
    ? data.prescribedTrainingFrequency
    : data.prescribedStructuredDays;
  return { sessions: result, scheduleMode, trainingDays, prescribedTrainingFrequency };
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface ProgressionReadSummary {
  docsReturned: number;
  docsUsed: number;
  docsDiscarded: number;
  firestoreDispatches: number;
}

interface ProgressionReadCompletion {
  name: string;
  endedAtBatchMs: number;
}

async function measureProgressionRead<T>(input: {
  label: string;
  name: string;
  functionName: string;
  logicalPath: string;
  operationType: string;
  filters: string;
  orderBy: string;
  limit: string;
  temporalWindow: string;
  readCounterLabel: string;
  batchStartedAtMs: number;
  completions?: ProgressionReadCompletion[];
  operation: () => Promise<T>;
  summarize: (result: T) => ProgressionReadSummary;
}): Promise<T> {
  const startedAtMs = perfNowMsSinceAppEpoch();
  const stop = startPerfTimer(input.label);
  try {
    const result = await input.operation();
    const endedAtMs = perfNowMsSinceAppEpoch();
    const summary = input.summarize(result);
    input.completions?.push({
      name: input.name,
      endedAtBatchMs: endedAtMs - input.batchStartedAtMs,
    });
    recordPerfTrace('evolution_progression.read', {
      name: input.name,
      functionName: input.functionName,
      logicalPath: input.logicalPath,
      operationType: input.operationType,
      filters: input.filters,
      orderBy: input.orderBy,
      limit: input.limit,
      temporalWindow: input.temporalWindow,
      readCounterLabel: input.readCounterLabel,
      startedAtBatchMs: startedAtMs - input.batchStartedAtMs,
      endedAtBatchMs: endedAtMs - input.batchStartedAtMs,
      durationMs: endedAtMs - startedAtMs,
      outcome: 'success',
      ...summary,
    });
    return result;
  } catch (error) {
    const endedAtMs = perfNowMsSinceAppEpoch();
    input.completions?.push({
      name: input.name,
      endedAtBatchMs: endedAtMs - input.batchStartedAtMs,
    });
    recordPerfTrace('evolution_progression.read', {
      name: input.name,
      functionName: input.functionName,
      logicalPath: input.logicalPath,
      operationType: input.operationType,
      filters: input.filters,
      orderBy: input.orderBy,
      limit: input.limit,
      temporalWindow: input.temporalWindow,
      readCounterLabel: input.readCounterLabel,
      startedAtBatchMs: startedAtMs - input.batchStartedAtMs,
      endedAtBatchMs: endedAtMs - input.batchStartedAtMs,
      durationMs: endedAtMs - startedAtMs,
      outcome: 'error',
    });
    throw error;
  } finally {
    stop();
  }
}

/** Program Adaptation starts a new progression window without inventing a new career cycle. */
async function loadCurrentProgressionWindowExecutions(
  uid: string,
  bundle: PersistedWorkoutLifecycleBundle,
): Promise<{ executions: PersistedWorkoutExecution[] }> {
  return {
    executions: await listExecutionsForProgramInstance(uid, bundle.programInstance.programInstanceId),
  };
}

/**
 * Gathers the real inputs (lifecycle, current cycle's Program Instances,
 * their executions, prescribed frequency, "now") and runs the pure V2
 * resolver. Read-only — never writes anything (docs §4/§43).
 *
 * Returns `null` when the account has no V2 lifecycle yet — there is nothing
 * to evaluate (this never happens once `loadActiveWorkoutProgram` has run at
 * least once, since that lazily bootstraps the V1 baseline).
 */
export async function evaluateProgressionV2ForUser(
  uid: string,
  now: Date = new Date(),
): Promise<ProgressionDecision | null> {
  const full = await evaluateProgressionV2ForUserFull(uid, now);
  return full?.decision ?? null;
}

/**
 * Same computation as `evaluateProgressionV2ForUser`, but also returns the
 * raw snapshot/cycle number/policy mode it was computed from — used by the
 * dev-only Workout Lifecycle QA readout (Settings > Developer, see
 * src/dev/workoutLifecycle/), which needs to *display* active days,
 * prescribed opportunities and adherence, not just the final decision.
 */
export async function evaluateProgressionV2ForUserFull(
  uid: string,
  now: Date = new Date(),
): Promise<{
  decision: ProgressionDecision;
  snapshot: ProgressionSnapshotV2;
  expectedSessions: number;
  cycleNumber: number;
  policyMode: Awaited<ReturnType<typeof resolveWorkoutLifecycleProgressionPolicy>>;
} | null> {
  const stopTotal = startPerfTimer('evolution_progression.total');
  try {
    const progressionStartedAtMs = perfNowMsSinceAppEpoch();
    const bundle = await measureProgressionRead({
      label: 'evolution_progression.lifecycle',
      name: 'lifecycle',
      functionName: 'loadWorkoutLifecycleDeduped',
      logicalPath: 'users/{uid}/workoutLifecycleState/current + referenced trainingCycles/{cycleId} + programInstances/{programInstanceId}',
      operationType: 'getDoc (1 pointer, then 2 parallel referents)',
      filters: 'fixed document ids from lifecycle pointer',
      orderBy: 'none',
      limit: '3 documents maximum',
      temporalWindow: 'current lifecycle only',
      readCounterLabel: 'workout_lifecycle.bundle',
      batchStartedAtMs: progressionStartedAtMs,
      operation: () => loadWorkoutLifecycleDeduped(uid),
      summarize: (result) => ({
        docsReturned: result ? 3 : 0,
        docsUsed: result ? 3 : 0,
        docsDiscarded: 0,
        firestoreDispatches: 1,
      }),
    });
    if (!bundle) return null;

    const batchStartedAtMs = perfNowMsSinceAppEpoch();
    const completions: ProgressionReadCompletion[] = [];
    const [config, { executions }, relevantCycles, scheduleEvents, authoritativeInputs, prescribedSessions, policyMode] = await Promise.all([
      measureProgressionRead({
        label: 'evolution_progression.schedule_config', name: 'schedule_config',
        functionName: 'loadScheduleConfig', logicalPath: 'users/{uid}/workoutProgramState/scheduleConfig',
        operationType: 'getDoc', filters: 'fixed document id', orderBy: 'none', limit: '1 document',
        temporalWindow: 'current user preference', readCounterLabel: 'workout_schedule.config',
        batchStartedAtMs, completions, operation: () => loadScheduleConfig(uid),
        summarize: (result) => ({ docsReturned: result ? 1 : 0, docsUsed: result ? 1 : 0, docsDiscarded: 0, firestoreDispatches: 1 }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.executions', name: 'executions',
        functionName: 'listExecutionsForProgramInstance', logicalPath: 'users/{uid}/workoutExecutions',
        operationType: 'query/getDocs', filters: 'programInstanceId == activeProgramInstanceId',
        orderBy: 'none', limit: 'none', temporalWindow: 'all executions for active ProgramInstance',
        readCounterLabel: 'workout_executions.program_instance', batchStartedAtMs, completions,
        operation: () => loadCurrentProgressionWindowExecutions(uid, bundle),
        summarize: (result) => ({ docsReturned: result.executions.length, docsUsed: result.executions.length, docsDiscarded: 0, firestoreDispatches: 1 }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.relevant_cycles', name: 'relevant_cycles',
        functionName: 'listRecentIntermediateTrainingCycles', logicalPath: 'users/{uid}/trainingCycles',
        operationType: bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE' ? 'query/getDocs' : 'not dispatched',
        filters: 'level == INTERMEDIATE', orderBy: 'cycleNumber desc',
        limit: String(PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion),
        temporalWindow: 'most recent Intermediate cycles', readCounterLabel: 'workout_lifecycle.intermediate_cycles',
        batchStartedAtMs, completions,
        operation: () => bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE'
          ? listRecentIntermediateTrainingCycles(uid, PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion)
          : Promise.resolve([]),
        summarize: (result) => ({
          docsReturned: result.length, docsUsed: result.length, docsDiscarded: 0,
          firestoreDispatches: bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE' ? 1 : 0,
        }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.schedule_events', name: 'schedule_events',
        functionName: 'listScheduleEventsForProgramInstance', logicalPath: 'users/{uid}/workoutPrograms/{activeContentIdentity}/scheduleEvents',
        operationType: 'query/getDocs', filters: 'programInstanceId == activeProgramInstanceId', orderBy: 'none', limit: 'none',
        temporalWindow: 'entire event ledger for active ProgramInstance', readCounterLabel: 'workout_schedule.events',
        batchStartedAtMs, completions,
        operation: () => listScheduleEventsForProgramInstance(
          uid,
          bundle.lifecycle.activeContentIdentity,
          bundle.programInstance.programInstanceId,
        ),
        summarize: (result) => {
          const used = result.filter((event) =>
            event.programInstanceId === bundle.programInstance.programInstanceId
            && (event.type === 'COMPLETED' || event.type === 'SKIPPED')).length;
          return { docsReturned: result.length, docsUsed: used, docsDiscarded: result.length - used, firestoreDispatches: 1 };
        },
      }),
      measureProgressionRead({
        label: 'evolution_progression.prescription_inputs', name: 'prescription_inputs',
        functionName: 'loadAuthoritativePrescriptionInputs',
        logicalPath: 'embedded ProgramInstance snapshot; legacy fallback users/{uid}/questionnaires/{questionnaireId}',
        operationType: bundle.programInstance.prescriptionInputSnapshot ? 'no remote read' : 'getDoc',
        filters: 'fixed legacy questionnaire id', orderBy: 'none', limit: '0 or 1 document',
        temporalWindow: 'immutable inputs for active ProgramInstance', readCounterLabel: 'questionnaire.by_id (legacy only)',
        batchStartedAtMs, completions, operation: () => loadAuthoritativePrescriptionInputs(uid, bundle),
        summarize: (result) => ({
          docsReturned: result?.usedLegacyFallback ? 1 : 0,
          docsUsed: result?.usedLegacyFallback ? 1 : 0,
          docsDiscarded: 0,
          firestoreDispatches: bundle.programInstance.prescriptionInputSnapshot ? 0 : 1,
        }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.prescribed_program', name: 'program',
        functionName: 'loadAuthoritativePrescribedSessions', logicalPath: 'users/{uid}/workoutPrograms/{activeContentIdentity}',
        operationType: 'getDoc', filters: 'fixed active content identity', orderBy: 'none', limit: '1 document',
        temporalWindow: 'active immutable program snapshot', readCounterLabel: 'workout_programs.snapshot',
        batchStartedAtMs, completions, operation: () => loadAuthoritativePrescribedSessions(uid, bundle.lifecycle.activeContentIdentity),
        summarize: (result) => ({ docsReturned: result ? 1 : 0, docsUsed: result ? 1 : 0, docsDiscarded: 0, firestoreDispatches: 1 }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.policy', name: 'profile_policy',
        functionName: 'resolveWorkoutLifecycleProgressionPolicy', logicalPath: 'users/{uid}',
        operationType: 'transaction.get', filters: 'fixed user document', orderBy: 'none', limit: '1 document',
        temporalWindow: 'current QA progression policy', readCounterLabel: 'user_profile.document',
        batchStartedAtMs, completions, operation: () => resolveWorkoutLifecycleProgressionPolicy(uid),
        summarize: () => ({ docsReturned: 1, docsUsed: 1, docsDiscarded: 0, firestoreDispatches: 1 }),
      }),
    ]);
    const lastCompletion = completions.reduce<ProgressionReadCompletion | null>(
      (latest, item) => !latest || item.endedAtBatchMs >= latest.endedAtBatchMs ? item : latest,
      null,
    );
    const firstCompletionMs = completions.length > 0
      ? Math.min(...completions.map((item) => item.endedAtBatchMs))
      : 0;
    recordPerfTrace('evolution_progression.parallel_batch', {
      durationMs: perfNowMsSinceAppEpoch() - batchStartedAtMs,
      completionSpreadMs: lastCompletion ? lastCompletion.endedAtBatchMs - firstCompletionMs : 0,
      lastResolved: lastCompletion?.name ?? 'none',
      completionOrder: completions.map((item) => item.name),
    });
    if (!authoritativeInputs || !prescribedSessions) return null;

    const stopLocal = startPerfTimer('evolution_progression.local_calculations');
    try {
  const timezone = config?.timezone ?? deviceTimezone();
  const todayLocalDate = localDateInTimezone(now, timezone);
  const progressionWindowStartLocalDate = localDateInTimezone(bundle.programInstance.activatedAt.toDate(), timezone);
  // The active program's TRAINING subset is the fixed-mode prescription.
  // Questionnaire availability may be broader and must never inflate the
  // adherence denominator. Legacy programs predate weeklySchedule, so only
  // those fall back to their immutable input snapshot/config. Flexible uses
  // a weekly numeric target instead.
  const scheduleMode = prescribedSessions.scheduleMode;
  const trainingDays = scheduleMode === 'fixed'
    ? prescribedSessions.trainingDays.length > 0
      ? prescribedSessions.trainingDays
      : authoritativeInputs.snapshot.inputs.trainingDays?.length
        ? authoritativeInputs.snapshot.inputs.trainingDays
        : config?.trainingDays ?? []
    : [];
  const executionDates = new Set(executions.map((execution) => execution.scheduledLocalDate));
  const activeTrace = computeActiveTimeTrace({
    startDateInclusive: progressionWindowStartLocalDate,
    todayLocalDate,
    trainingDays,
    scheduleMode,
    executionDates,
  });
  const activeTime = activeTrace.activeTime;
  const flexibleTargets = scheduleMode === 'flexible'
    ? buildFlexibleWeeklyTargets({
        countedActiveDates: activeTrace.countedDates,
        prescribedTrainingFrequency: prescribedSessions.prescribedTrainingFrequency,
      })
    : null;
  const prescribedOpportunities = scheduleMode === 'fixed'
    ? buildPrescribedOpportunities({
        programInstanceId: bundle.programInstance.programInstanceId,
        trainingDays,
        countedActiveDates: activeTrace.countedDates,
      })
    : [];
  const validSessionCount = flexibleTargets
    ? countFulfilledFlexibleWeeklyTargets({
        programInstanceId: bundle.programInstance.programInstanceId,
        executions,
        scheduleEvents,
        weeklyTargets: flexibleTargets,
        prescribedSessions: prescribedSessions.sessions,
      })
    : countFulfilledPrescribedOpportunities({
        programInstanceId: bundle.programInstance.programInstanceId,
        executions,
        scheduleEvents,
        prescribedOpportunities,
        prescribedSessions: prescribedSessions.sessions,
        trainingDays,
      });
  const expectedSessions = flexibleTargets
    ? [...flexibleTargets.values()].reduce((sum, count) => sum + count, 0)
    : prescribedOpportunities.length;
  const adherence = computeAdherence(validSessionCount, expectedSessions);

  const earnedIntermediateCycleCount =
    bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE' ? countEarnedIntermediateCycles(relevantCycles) : 0;

  const snapshot: ProgressionSnapshotV2 = {
    level: bundle.lifecycle.currentTrainingLevel,
    activeTime,
    adherence,
    earnedIntermediateCycleCount,
    hasInProgressExecution: executions.some((execution) => execution.status === 'IN_PROGRESS'),
    validSessionCount,
  };

  const decision = evaluateProgressionV2(snapshot, resolveProgressionV2Config(policyMode));
  return { decision, snapshot, expectedSessions, cycleNumber: bundle.cycle.cycleNumber, policyMode };
    } finally {
      stopLocal();
    }
  } finally {
    stopTotal();
  }
}
