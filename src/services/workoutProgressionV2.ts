import { countEarnedIntermediateCycles } from '../progressionEngineV2/earnedCycles';
import {
  computeCycleProgression,
  type CycleInstanceProgressionWindow,
} from '../progressionEngineV2/cycleProgression';
import { evaluateProgressionV2 } from '../progressionEngineV2/resolver';
import { PROGRESSION_V2_CONFIG, resolveProgressionV2Config } from '../progressionEngineV2/config';
import type { ProgressionDecision, ProgressionSnapshotV2 } from '../progressionEngineV2/types';
import { localDateInTimezone, progressionTimezone } from '../scheduleEngine/localDate';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logWarn } from '../lib/logger';
import {
  countFirestoreRead,
  perfNowMsSinceAppEpoch,
  recordPerfTrace,
  startPerfTimer,
} from '../lib/perf';
import { listExecutionsForProgramInstances } from './workoutExecutions';
import { listScheduleEventsForCycle, loadScheduleConfig } from './workoutSchedule';
import {
  listProgramInstancesForCycle,
  listRecentIntermediateTrainingCycles,
  loadWorkoutLifecycleDeduped,
  type PersistedWorkoutLifecycleBundle,
} from './workoutLifecycle';
import type { ProgramInstance } from '../workoutLifecycle/types';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';
import { resolveWorkoutLifecycleProgressionPolicy } from '../workoutLifecycle/qaPolicy';

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
  // Same degradation chain every other reader uses
  // (`src/scheduleEngine/useWorkoutSchedule.ts`): the sealed
  // `prescribedTrainingFrequency`, then the legacy `prescribedStructuredDays`,
  // then the session count. Without the last step a pre-field legacy program
  // would have no reconstructable weekly goal, and an account would silently
  // lose the ability to earn rather than merely losing a nudge.
  const prescribedTrainingFrequency = Number.isInteger(data.prescribedTrainingFrequency)
    ? data.prescribedTrainingFrequency
    : Number.isInteger(data.prescribedStructuredDays)
      ? data.prescribedStructuredDays
      : result.length;
  return { sessions: result, prescribedTrainingFrequency };
}

/**
 * Hard ceiling on ProgramInstances per TrainingCycle for one progression read.
 * A cycle is one Beginner/Intermediate/Advanced window; even a user who
 * re-adapts their routine monthly stays far below this. Exceeding it is
 * reported, never silently truncated.
 */
const MAXIMUM_CYCLE_PROGRAM_INSTANCES = 40;

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

/**
 * The cycle's real progression window: every ProgramInstance that belonged to
 * it, each paired with its own sealed prescription and weekly goal.
 *
 * A Program Adaptation supersedes one instance and activates another inside
 * the SAME TrainingCycle, so the window is the union of those instances — not
 * the active one. The active instance is always included even when the cycle
 * query returns nothing usable (legacy accounts whose instances predate
 * `cycleId`, an offline read), which is what makes this degrade to exactly
 * the old single-instance behaviour instead of to no progress at all.
 */
interface ResolvedCycleInstance {
  instance: ProgramInstance<Timestamp>;
  contentIdentity: string;
  prescribedTrainingFrequency: number;
  prescribedSessions: readonly { exercises: readonly { exerciseId: string; setCount: number }[] }[];
}

/**
 * Fetches the cycle's ProgramInstances and their sealed programs.
 *
 * Needs ONLY `cycleId`, which the lifecycle bundle already provides — not the
 * timezone. That is what lets this run in the SAME parallel wave as the
 * schedule config instead of a sequential one after it; the conversion of the
 * activation instants into local dates is pure and happens afterwards.
 */
async function loadCycleInstances(
  uid: string,
  bundle: PersistedWorkoutLifecycleBundle,
): Promise<{ resolved: ResolvedCycleInstance[]; truncated: boolean; unreadableInstances: number }> {
  const { instances, truncated } = await listProgramInstancesForCycle(
    uid, bundle.cycle.cycleId, MAXIMUM_CYCLE_PROGRAM_INSTANCES,
  ).catch(() => ({ instances: [], truncated: false }));
  if (truncated) return { resolved: [], truncated: true, unreadableInstances: 0 };
  const relevant = instances.some((item) =>
    item.programInstanceId === bundle.programInstance.programInstanceId)
    ? instances
    : [...instances, bundle.programInstance];

  const loaded = await Promise.all(relevant.map(async (instance) => {
    const program = instance.contentIdentity === bundle.lifecycle.activeContentIdentity
      ? await loadAuthoritativePrescribedSessions(uid, bundle.lifecycle.activeContentIdentity)
      : await loadAuthoritativePrescribedSessions(uid, instance.contentIdentity).catch(() => null);
    if (!program) return null;
    return {
      instance,
      contentIdentity: instance.contentIdentity,
      prescribedTrainingFrequency: program.prescribedTrainingFrequency,
      prescribedSessions: program.sessions,
    } satisfies ResolvedCycleInstance;
  }));
  const resolved = loaded.filter((item): item is NonNullable<typeof item> => item !== null);
  return { resolved, truncated: false, unreadableInstances: loaded.length - resolved.length };
}

/** Pure: turns the fetched instances into progression windows for a timezone. */
function toCycleProgressionWindows(
  resolved: readonly ResolvedCycleInstance[],
  timezone: string,
): {
  windows: CycleInstanceProgressionWindow[];
  contentWindows: { contentIdentity: string; programInstanceId: string }[];
} {
  const windows = resolved.map((item) => ({
    programInstanceId: item.instance.programInstanceId,
    activatedAtLocalDate: localDateInTimezone(item.instance.activatedAt.toDate(), timezone),
    // Inclusive, matching `weeklyGoalForWeek`'s window contract: the day an
    // instance was superseded is still a day it covered.
    supersededAtLocalDate: item.instance.supersededAt
      ? localDateInTimezone(item.instance.supersededAt.toDate(), timezone)
      : null,
    prescribedTrainingFrequency: item.prescribedTrainingFrequency,
    prescribedSessions: item.prescribedSessions,
  } satisfies CycleInstanceProgressionWindow));
  return {
    windows,
    contentWindows: resolved.map((item) => ({
      contentIdentity: item.contentIdentity,
      programInstanceId: item.instance.programInstanceId,
    })),
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
    const [config, relevantCycles, authoritativeInputs, policyMode, cycleInstances] = await Promise.all([
      measureProgressionRead({
        label: 'evolution_progression.schedule_config', name: 'schedule_config',
        functionName: 'loadScheduleConfig', logicalPath: 'users/{uid}/workoutProgramState/scheduleConfig',
        operationType: 'getDoc', filters: 'fixed document id', orderBy: 'none', limit: '1 document',
        temporalWindow: 'current user preference', readCounterLabel: 'workout_schedule.config',
        batchStartedAtMs, completions, operation: () => loadScheduleConfig(uid),
        summarize: (result) => ({ docsReturned: result ? 1 : 0, docsUsed: result ? 1 : 0, docsDiscarded: 0, firestoreDispatches: 1 }),
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
        label: 'evolution_progression.policy', name: 'profile_policy',
        functionName: 'resolveWorkoutLifecycleProgressionPolicy', logicalPath: 'users/{uid}',
        operationType: 'transaction.get', filters: 'fixed user document', orderBy: 'none', limit: '1 document',
        temporalWindow: 'current QA progression policy', readCounterLabel: 'user_profile.document',
        batchStartedAtMs, completions, operation: () => resolveWorkoutLifecycleProgressionPolicy(uid),
        summarize: () => ({ docsReturned: 1, docsUsed: 1, docsDiscarded: 0, firestoreDispatches: 1 }),
      }),
      // In the SAME wave as everything above: it needs only `cycleId`, which
      // the lifecycle bundle already provided. Keeping it here is what holds
      // the evaluation at the same number of sequential round trips it had
      // before the window became cycle-scoped.
      measureProgressionRead({
        label: 'evolution_progression.cycle_instances', name: 'cycle_instances',
        functionName: 'loadCycleInstances',
        logicalPath: 'users/{uid}/programInstances where cycleId == currentCycleId + each referenced workoutPrograms/{contentIdentity}',
        operationType: 'query/getDocs + 1 getDoc per instance',
        filters: 'cycleId == currentCycleId', orderBy: 'activatedAt (client-side)',
        limit: `${MAXIMUM_CYCLE_PROGRAM_INSTANCES} instances`,
        temporalWindow: 'every ProgramInstance of the CURRENT TrainingCycle',
        readCounterLabel: 'workout_lifecycle.cycle_program_instances',
        batchStartedAtMs, completions,
        operation: () => loadCycleInstances(uid, bundle),
        summarize: (result) => ({
          docsReturned: result.resolved.length + result.unreadableInstances,
          docsUsed: result.resolved.length,
          docsDiscarded: result.unreadableInstances,
          firestoreDispatches: 1 + result.resolved.length + result.unreadableInstances,
        }),
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
    if (!authoritativeInputs) return null;

    // THE shared resolver — never the device timezone. A client evaluating in
    // its own zone while the authority evaluates in UTC shifts "today" by a
    // day and makes the two disagree about the same account.
    const timezone = progressionTimezone(config?.timezone);
    // FAIL-CLOSED on a truncated history. A `limit()` without `orderBy`
    // returns an ARBITRARY subset (Firestore orders by `__name__`), so the 40
    // kept could exclude the cycle's first instance and silently shift
    // `cycleStartLocalDate`. Computing an apparently-valid progress figure
    // from that is worse than showing none, and it is exactly the policy the
    // authority applies (`progression_cycle_history_too_large`), so the two
    // sides never disagree about availability either.
    if (cycleInstances.truncated) {
      logWarn('workout_lifecycle', 'cycle_progression_history_too_large', {
        cycleId: bundle.cycle.cycleId,
        maximumInstances: MAXIMUM_CYCLE_PROGRAM_INSTANCES,
      });
      return null;
    }
    if (cycleInstances.unreadableInstances > 0) {
      // Never silent: a dropped window changes both the goals and the credits
      // of the weeks it covered.
      logWarn('workout_lifecycle', 'cycle_progression_window_incomplete', {
        unreadableInstances: cycleInstances.unreadableInstances,
        usableWindows: cycleInstances.resolved.length,
      });
    }
    const cycleWindow = toCycleProgressionWindows(cycleInstances.resolved, timezone);
    if (cycleWindow.windows.length === 0) return null;

    const historyStartedAtMs = perfNowMsSinceAppEpoch();
    const instanceIds = cycleWindow.windows.map((window) => window.programInstanceId);
    const [executions, scheduleEvents] = await Promise.all([
      measureProgressionRead({
        label: 'evolution_progression.executions', name: 'executions',
        functionName: 'listExecutionsForProgramInstances', logicalPath: 'users/{uid}/workoutExecutions',
        operationType: 'query/getDocs', filters: 'programInstanceId in cycleProgramInstanceIds',
        orderBy: 'none', limit: 'none', temporalWindow: 'all executions of the current TrainingCycle',
        readCounterLabel: 'workout_executions.program_instance',
        batchStartedAtMs: historyStartedAtMs,
        operation: () => listExecutionsForProgramInstances(uid, instanceIds),
        summarize: (result) => ({
          docsReturned: result.length, docsUsed: result.length, docsDiscarded: 0,
          firestoreDispatches: Math.ceil(instanceIds.length / 30),
        }),
      }),
      measureProgressionRead({
        label: 'evolution_progression.schedule_events', name: 'schedule_events',
        functionName: 'listScheduleEventsForCycle',
        logicalPath: 'users/{uid}/workoutPrograms/{contentIdentity}/scheduleEvents, one per cycle instance',
        operationType: 'query/getDocs', filters: 'programInstanceId == each cycle instance', orderBy: 'none', limit: 'none',
        temporalWindow: 'entire event ledger of the current TrainingCycle',
        readCounterLabel: 'workout_schedule.events',
        batchStartedAtMs: historyStartedAtMs,
        operation: () => listScheduleEventsForCycle(uid, cycleWindow.contentWindows),
        summarize: (result) => {
          const ownInstances = new Set(instanceIds);
          const used = result.filter((event) =>
            typeof event.programInstanceId === 'string' && ownInstances.has(event.programInstanceId)
            && (event.type === 'COMPLETED' || event.type === 'SKIPPED')).length;
          return {
            docsReturned: result.length, docsUsed: used, docsDiscarded: result.length - used,
            firestoreDispatches: cycleWindow.contentWindows.length,
          };
        },
      }),
    ]);

    const stopLocal = startPerfTimer('evolution_progression.local_calculations');
    try {
  const todayLocalDate = localDateInTimezone(now, timezone);
  const progressionConfig = resolveProgressionV2Config(policyMode);
  // ONE rule for every account — distinct local days trained over the weekly
  // goal in force that week — computed across every ProgramInstance of the
  // current TrainingCycle, so an ADAPT changes the routine without resetting
  // the progress already earned. No fixed/flexible/pilot branch exists here:
  // recommended weekdays are recommendations and are not an input.
  const cycleProgression = computeCycleProgression({
    windows: cycleWindow.windows,
    todayLocalDate,
    executions,
    scheduleEvents,
  }, progressionConfig);
  if (!cycleProgression) return null;
  const { activeTime, adherence, expectedSessions, validSessionCount } = cycleProgression;

  const earnedIntermediateCycleCount =
    bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE' ? countEarnedIntermediateCycles(relevantCycles) : 0;

  const snapshot: ProgressionSnapshotV2 = {
    level: bundle.lifecycle.currentTrainingLevel,
    activeTime,
    adherence,
    earnedIntermediateCycleCount,
    // Scoped to the ACTIVE instance even though the counting window is the
    // whole cycle: only a session of the active program can be running, and
    // superseding an instance never terminalizes its executions — a
    // cycle-wide check would let one stale IN_PROGRESS document block
    // progression forever. Mirrors the authority's own scope.
    hasInProgressExecution: executions.some((execution) =>
      execution.status === 'IN_PROGRESS'
      && execution.programInstanceId === bundle.programInstance.programInstanceId),
    validSessionCount,
  };

  const decision = evaluateProgressionV2(snapshot, progressionConfig);
  return { decision, snapshot, expectedSessions, cycleNumber: bundle.cycle.cycleNumber, policyMode };
    } finally {
      stopLocal();
    }
  } finally {
    stopTotal();
  }
}
