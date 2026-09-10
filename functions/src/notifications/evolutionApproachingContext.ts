import { createHash } from 'node:crypto';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { computeActiveTimeTrace } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/activeTime';
import { computeAdherence } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/adherence';
import { PROGRESSION_V2_CONFIG } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/config';
import {
  buildPrescribedOpportunities,
  countFulfilledPrescribedOpportunities,
} from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/prescribedOpportunities';
import { evaluateProgressionV2 } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/resolver';
import type { ProgressionSnapshotV2 } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/types';
import { canonicalIanaTimezone } from '../workoutLifecycle/prescriptionEngine/scheduleEngine/localDate';
import type { Weekday } from '../workoutLifecycle/prescriptionEngine/state/AppState';
import { dailyLocalClock } from './dailyTime';

export const APPROACHING_ACTIVE_DAYS = 3;
export const APPROACHING_HISTORY_LIMIT = 512;
const LIFECYCLE_HISTORY_LIMIT = 128;
const WEEKDAYS = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

export type ApproachingContext = {
  allowed: true;
  progressionWindowId: string;
  sourceIdentity: string;
  timezone: string;
  localDate: string;
} | { allowed: false; reason: string; timezone?: string; localDate?: string };

/** A notification policy over V2 outputs; never computes its own progress counter. */
export function approachingReason(snapshot: ProgressionSnapshotV2): string | null {
  const decision = evaluateProgressionV2(snapshot);
  if (decision.type !== 'PROGRESS_CONTINUES') return decision.type;
  if (snapshot.activeTime.pausedAt !== null) return 'ACTIVE_TIME_PAUSED';
  if (snapshot.adherence.ratio < PROGRESSION_V2_CONFIG.adherenceEarnedThresholdBp / 10_000) {
    return 'ADHERENCE_BELOW_THRESHOLD';
  }
  const minimum = snapshot.level === 'BEGINNER'
    ? PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays
    : PROGRESSION_V2_CONFIG.intermediateAdvancedMinimumActiveDays;
  const remaining = minimum - snapshot.activeTime.activeDays;
  return remaining > 0 && remaining <= APPROACHING_ACTIVE_DAYS ? null : 'OUTSIDE_APPROACHING_WINDOW';
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

/**
 * Bounded, consistent evaluation of the domain. A lighter dispatch preflight
 * re-checks the mutable unlock/cycle collision immediately before provider I/O.
 * No business documents are written. Legacy/incomplete/overflow histories
 * fail closed rather than inventing progress.
 */
export async function readApproachingContext(db: Firestore, uid: string, now: Timestamp): Promise<ApproachingContext> {
  return db.runTransaction(async (tx): Promise<ApproachingContext> => {
    const root = db.collection('users').doc(uid);
    const [user, lock, lifecycle, schedule, pending] = await tx.getAll(
      root,
      db.collection('accountDeletionLocks').doc(uid),
      root.collection('workoutLifecycleState').doc('current'),
      root.collection('workoutProgramState').doc('scheduleConfig'),
      root.collection('pendingEvolutions').doc('current'),
    );
    const deny = (reason: string): ApproachingContext => ({ allowed: false, reason });
    if (!user.exists) return deny('USER_NOT_FOUND');
    if (lock.exists) return deny('ACCOUNT_INACTIVE');
    // Never turn accelerated/forced QA transitions into product approaching facts.
    const metadata = user.data()?.metadata;
    if (metadata?.workoutLifecycleQaMode === 'ACCELERATED'
      || metadata?.workoutLifecycleQaMode === 'TRANSITION'
      || metadata?.workoutLifecycleQaAccelerated === true) return deny('QA_POLICY');
    const timezone = canonicalIanaTimezone(schedule.data()?.timezone);
    const clock = timezone ? dailyLocalClock(now.toDate(), timezone) : null;
    if (!clock) return deny('TIMEZONE_UNAVAILABLE');
    if (!clock.withinWindow) return { allowed: false, reason: 'OUTSIDE_LOCAL_WINDOW', ...clock };
    const state = lifecycle.data();
    if (!state || !id(state.currentCycleId) || !id(state.activeProgramInstanceId)
      || !id(state.activeContentIdentity)
      || !['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(state.currentTrainingLevel)) {
      return deny('PROGRAM_UNAVAILABLE');
    }
    if (pending.exists) {
      const pendingSource = pending.data()?.sourceProgramInstanceId;
      if (typeof pendingSource !== 'string' || pendingSource === state.activeProgramInstanceId) {
        return deny('PENDING_EVOLUTION');
      }
    }
    const [instance, cycle, program] = await tx.getAll(
      root.collection('programInstances').doc(state.activeProgramInstanceId),
      root.collection('trainingCycles').doc(state.currentCycleId),
      root.collection('workoutPrograms').doc(state.activeContentIdentity),
    );
    const instanceData = instance.data();
    const programData = program.data();
    const trainingDays = instanceData?.prescriptionInputSnapshot?.inputs?.trainingDays;
    if (!instanceData || !programData || cycle.data()?.status !== 'ACTIVE'
      || cycle.data()?.eligibleAt != null
      || instanceData.cycleId !== state.currentCycleId
      || instanceData.contentIdentity !== state.activeContentIdentity
      || instanceData.supersededAt !== null || programData.status !== 'active'
      || !(instanceData.activatedAt instanceof Timestamp)
      || !Array.isArray(trainingDays) || !trainingDays.length
      || !trainingDays.every((day: unknown) => typeof day === 'string' && WEEKDAYS.has(day))) {
      return deny('PROGRAM_UNAVAILABLE');
    }
    const startClock = dailyLocalClock(instanceData.activatedAt.toDate(), clock.timezone);
    if (!startClock || instanceData.activatedAt.toMillis() > now.toMillis()
      || now.toMillis() - instanceData.activatedAt.toMillis() > 3659 * 86_400_000) {
      return deny('HISTORY_UNAVAILABLE');
    }
    const lifecycleEvents = await tx.get(root.collection('workoutLifecycleEvents')
      .where('programInstanceId', '==', state.activeProgramInstanceId).limit(LIFECYCLE_HISTORY_LIMIT + 1));
    if (lifecycleEvents.size > LIFECYCLE_HISTORY_LIMIT) return deny('HISTORY_LIMIT');
    if (lifecycleEvents.docs.some((event) => [
      'EVOLUTION_EARNED', 'MOTIVATIONAL_RENEWAL_OFFERED',
    ].includes(event.data().type))) return deny('EVOLUTION_ALREADY_EARNED_OR_OFFERED');
    const executions = await tx.get(root.collection('workoutExecutions')
      .where('programInstanceId', '==', state.activeProgramInstanceId).limit(APPROACHING_HISTORY_LIMIT + 1));
    const events = await tx.get(root.collection('workoutPrograms').doc(state.activeContentIdentity)
      .collection('scheduleEvents').where('programInstanceId', '==', state.activeProgramInstanceId)
      .limit(APPROACHING_HISTORY_LIMIT + 1));
    if (executions.size > APPROACHING_HISTORY_LIMIT || events.size > APPROACHING_HISTORY_LIMIT) return deny('HISTORY_LIMIT');
    const executionData = executions.docs.map((document) => document.data());
    if (executionData.some((execution) => !Array.isArray(execution.exercises)
      || typeof execution.scheduledLocalDate !== 'string'
      || execution.exercises.some((exercise: DocumentData) => !exercise || !Array.isArray(exercise.sets)))) {
      return deny('HISTORY_UNAVAILABLE');
    }
    if (!Array.isArray(programData.sessions) || !programData.sessions.length
      || programData.sessions.some((session: DocumentData) => !session || !Array.isArray(session.exercises)
        || !session.exercises.length || session.exercises.some((exercise: DocumentData) => !exercise
          || typeof exercise.exerciseId !== 'string'
          || (Number.isInteger(exercise.sets) && exercise.sets < 1)))) return deny('PROGRAM_UNAVAILABLE');
    const trace = computeActiveTimeTrace({
      startDateInclusive: startClock.localDate,
      todayLocalDate: clock.localDate,
      trainingDays: trainingDays as Weekday[],
      executionDates: new Set(executionData.map((execution) => execution.scheduledLocalDate as string)),
    });
    const opportunities = buildPrescribedOpportunities({
      programInstanceId: state.activeProgramInstanceId,
      trainingDays: trainingDays as Weekday[],
      countedActiveDates: trace.countedDates,
    });
    const validSessionCount = countFulfilledPrescribedOpportunities({
      programInstanceId: state.activeProgramInstanceId,
      executions: executionData as unknown as Parameters<typeof countFulfilledPrescribedOpportunities>[0]['executions'],
      scheduleEvents: events.docs.map((event) => event.data()) as unknown as Parameters<typeof countFulfilledPrescribedOpportunities>[0]['scheduleEvents'],
      prescribedOpportunities: opportunities,
      prescribedSessions: programData.sessions.map((session: DocumentData) => ({
        exercises: session.exercises.map((exercise: DocumentData) => ({
          exerciseId: exercise.exerciseId,
          setCount: Number.isInteger(exercise.sets) ? exercise.sets : 1,
        })),
      })),
      trainingDays: trainingDays as Weekday[],
    });
    const reason = approachingReason({
      level: state.currentTrainingLevel,
      activeTime: trace.activeTime,
      adherence: computeAdherence(validSessionCount, opportunities.length),
      // At the approaching gate the current cycle is never earned. The number
      // of older earned cycles cannot change PROGRESS_CONTINUES; no history scan.
      earnedIntermediateCycleCount: 0,
      hasInProgressExecution: executionData.some((execution) => execution.status === 'IN_PROGRESS'),
      validSessionCount,
    });
    if (reason) return { allowed: false, reason, timezone: clock.timezone, localDate: clock.localDate };
    return {
      allowed: true,
      progressionWindowId: state.activeProgramInstanceId,
      sourceIdentity: `progressionWindow:${createHash('sha256').update(state.activeProgramInstanceId).digest('hex')}`,
      timezone: clock.timezone,
      localDate: clock.localDate,
    };
  });
}
