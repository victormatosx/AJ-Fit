import { createHash } from 'node:crypto';

import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import { PROGRESSION_V2_CONFIG } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/config';
import { computeCycleProgression } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/cycleProgression';
import { loadCycleProgressionWindow } from '../workoutLifecycle/cycleProgressionWindow';
import { evaluateProgressionV2 } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/resolver';
import type { ProgressionSnapshotV2 } from '../workoutLifecycle/prescriptionEngine/progressionEngineV2/types';
import { canonicalIanaTimezone } from '../workoutLifecycle/prescriptionEngine/scheduleEngine/localDate';
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
    const scheduleMode = programData?.scheduleMode === 'flexible' ? 'flexible' : 'fixed';
    const programTrainingDays = Array.isArray(programData?.weeklySchedule)
      ? programData.weeklySchedule.flatMap((day: DocumentData) =>
        day?.state === 'TRAINING' && typeof day.weekday === 'string' ? [day.weekday] : [])
      : [];
    const legacySnapshotDays = Array.isArray(instanceData?.prescriptionInputSnapshot?.inputs?.trainingDays)
      ? instanceData.prescriptionInputSnapshot.inputs.trainingDays
      : [];
    // New fixed plans use the actual TRAINING subset sealed in the program.
    // Older snapshots had no weeklySchedule, so retain their former
    // questionnaire-day semantics instead of changing existing users.
    const trainingDays = scheduleMode === 'fixed'
      ? (programTrainingDays.length > 0 ? programTrainingDays : legacySnapshotDays)
      : [];
    if (!instanceData || !programData || cycle.data()?.status !== 'ACTIVE'
      || cycle.data()?.eligibleAt != null
      || instanceData.cycleId !== state.currentCycleId
      || instanceData.contentIdentity !== state.activeContentIdentity
      || instanceData.supersededAt !== null || programData.status !== 'active'
      || !(instanceData.activatedAt instanceof Timestamp)
      || (scheduleMode === 'fixed' && (!trainingDays.length
        || !trainingDays.every((day: unknown) => typeof day === 'string' && WEEKDAYS.has(day))))) {
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
    // The SAME cycle-scoped window the EARN authority reads, via the SAME
    // loader (`loadCycleProgressionWindow`). It used to read only the active
    // ProgramInstance, which after an ADAPT meant every execution belonged to
    // the superseded instance: the observer reported 0% adherence and denied
    // a user the authority was simultaneously promoting.
    const cycleWindow = await loadCycleProgressionWindow({
      reader: {
        root,
        readDoc: (ref) => tx.get(ref),
        readQuery: (query) => tx.get(query),
      },
      currentCycleId: state.currentCycleId,
      activeProgramInstanceId: state.activeProgramInstanceId,
      activeContentIdentity: state.activeContentIdentity,
      activeInstance: instanceData,
      activeProgram: programData,
      timezone: clock.timezone,
    });
    if (cycleWindow.status === 'TOO_LARGE' || cycleWindow.status === 'HISTORY_LIMIT') {
      return deny('HISTORY_LIMIT');
    }
    if (cycleWindow.status === 'UNAVAILABLE') return deny('PROGRAM_UNAVAILABLE');
    const executionData = cycleWindow.executions;
    if (executionData.some((execution) => !Array.isArray(execution.exercises)
      || typeof execution.scheduledLocalDate !== 'string'
      || execution.exercises.some((exercise: DocumentData) => !exercise || !Array.isArray(exercise.sets)))) {
      return deny('HISTORY_UNAVAILABLE');
    }
    const progression = computeCycleProgression({
      windows: cycleWindow.windows,
      todayLocalDate: clock.localDate,
      executions: executionData as unknown as Parameters<typeof computeCycleProgression>[0]['executions'],
      scheduleEvents: cycleWindow.scheduleEvents as unknown as Parameters<typeof computeCycleProgression>[0]['scheduleEvents'],
    });
    if (!progression) return deny('PROGRAM_UNAVAILABLE');
    const reason = approachingReason({
      level: state.currentTrainingLevel,
      activeTime: progression.activeTime,
      adherence: progression.adherence,
      // At the approaching gate the current cycle is never earned. The number
      // of older earned cycles cannot change PROGRESS_CONTINUES; no history scan.
      earnedIntermediateCycleCount: 0,
      hasInProgressExecution: executionData.some((execution) => execution.status === 'IN_PROGRESS'),
      validSessionCount: progression.validSessionCount,
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
