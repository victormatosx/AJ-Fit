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
import { listExecutionsForProgramInstance, type PersistedWorkoutExecution } from './workoutExecutions';
import { listScheduleEvents, loadScheduleConfig } from './workoutSchedule';
import {
  listRecentIntermediateTrainingCycles,
  loadWorkoutLifecycle,
  type PersistedWorkoutLifecycleBundle,
} from './workoutLifecycle';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';
import { resolveWorkoutLifecycleProgressionPolicy } from '../workoutLifecycle/qaPolicy';
import type { ScheduleMode, Weekday } from '../state/AppState';

async function loadAuthoritativePrescribedSessions(uid: string, contentIdentity: string) {
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
  const bundle = await loadWorkoutLifecycle(uid);
  if (!bundle) return null;

  const [config, { executions }, relevantCycles, scheduleEvents, authoritativeInputs, prescribedSessions, policyMode] = await Promise.all([
    loadScheduleConfig(uid),
    loadCurrentProgressionWindowExecutions(uid, bundle),
    bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE'
      ? listRecentIntermediateTrainingCycles(uid, PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion)
      : Promise.resolve([]),
    listScheduleEvents(uid, bundle.lifecycle.activeContentIdentity),
    loadAuthoritativePrescriptionInputs(uid, bundle),
    loadAuthoritativePrescribedSessions(uid, bundle.lifecycle.activeContentIdentity),
    resolveWorkoutLifecycleProgressionPolicy(uid),
  ]);
  if (!authoritativeInputs || !prescribedSessions) return null;

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
}
