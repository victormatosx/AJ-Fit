import { computeActiveTimeTrace } from '../progressionEngineV2/activeTime';
import { computeAdherence } from '../progressionEngineV2/adherence';
import { countEarnedIntermediateCycles } from '../progressionEngineV2/earnedCycles';
import {
  buildPrescribedOpportunities,
  countFulfilledPrescribedOpportunities,
} from '../progressionEngineV2/prescribedOpportunities';
import { evaluateProgressionV2 } from '../progressionEngineV2/resolver';
import type { ProgressionDecision, ProgressionSnapshotV2 } from '../progressionEngineV2/types';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { listExecutionsForProgramInstance, type PersistedWorkoutExecution } from './workoutExecutions';
import { listScheduleEvents, loadScheduleConfig } from './workoutSchedule';
import {
  listTrainingCycles,
  loadWorkoutLifecycle,
  type PersistedWorkoutLifecycleBundle,
} from './workoutLifecycle';
import { loadAuthoritativePrescriptionInputs } from './prescriptionInputs';

async function loadAuthoritativePrescribedSessions(uid: string, contentIdentity: string) {
  const snapshot = await getDoc(doc(db, 'users', uid, 'workoutPrograms', contentIdentity));
  if (!snapshot.exists()) return null;
  const sessions = snapshot.data().sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const result: Array<{ exercises: Array<{ exerciseId: string; setCount: number }> }> = [];
  for (const session of sessions) {
    if (!session || !Array.isArray(session.exercises) || session.exercises.length === 0) return null;
    const exercises: Array<{ exerciseId: string; setCount: number }> = [];
    for (const exercise of session.exercises) {
      const setCount = Number.isInteger(exercise?.sets) ? exercise.sets : 1;
      if (typeof exercise?.exerciseId !== 'string' || setCount < 1) return null;
      exercises.push({ exerciseId: exercise.exerciseId, setCount });
    }
    result.push({ exercises });
  }
  return result;
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
  const bundle = await loadWorkoutLifecycle(uid);
  if (!bundle) return null;

  const [config, { executions }, allCycles, scheduleEvents, authoritativeInputs, prescribedSessions] = await Promise.all([
    loadScheduleConfig(uid),
    loadCurrentProgressionWindowExecutions(uid, bundle),
    listTrainingCycles(uid),
    listScheduleEvents(uid, bundle.lifecycle.activeContentIdentity),
    loadAuthoritativePrescriptionInputs(uid, bundle),
    loadAuthoritativePrescribedSessions(uid, bundle.lifecycle.activeContentIdentity),
  ]);
  if (!authoritativeInputs || !prescribedSessions) return null;

  const timezone = config?.timezone ?? deviceTimezone();
  const todayLocalDate = localDateInTimezone(now, timezone);
  const progressionWindowStartLocalDate = localDateInTimezone(bundle.programInstance.activatedAt.toDate(), timezone);
  const trainingDays = authoritativeInputs.snapshot.inputs.trainingDays?.length
    ? authoritativeInputs.snapshot.inputs.trainingDays
    : config?.trainingDays ?? [];
  const executionDates = new Set(executions.map((execution) => execution.scheduledLocalDate));
  const activeTrace = computeActiveTimeTrace({
    startDateInclusive: progressionWindowStartLocalDate,
    todayLocalDate,
    trainingDays,
    executionDates,
  });
  const activeTime = activeTrace.activeTime;
  const prescribedOpportunities = buildPrescribedOpportunities({
    programInstanceId: bundle.programInstance.programInstanceId,
    trainingDays,
    countedActiveDates: activeTrace.countedDates,
  });
  const validSessionCount = countFulfilledPrescribedOpportunities({
    programInstanceId: bundle.programInstance.programInstanceId,
    executions,
    scheduleEvents,
    prescribedOpportunities,
    prescribedSessions,
    trainingDays,
  });
  const expectedSessions = prescribedOpportunities.length;
  const adherence = computeAdherence(validSessionCount, expectedSessions);

  const earnedIntermediateCycleCount =
    bundle.lifecycle.currentTrainingLevel === 'INTERMEDIATE' ? countEarnedIntermediateCycles(allCycles) : 0;

  const snapshot: ProgressionSnapshotV2 = {
    level: bundle.lifecycle.currentTrainingLevel,
    activeTime,
    adherence,
    earnedIntermediateCycleCount,
    hasInProgressExecution: executions.some((execution) => execution.status === 'IN_PROGRESS'),
    validSessionCount,
  };

  const decision = evaluateProgressionV2(snapshot);
  return decision;
}
