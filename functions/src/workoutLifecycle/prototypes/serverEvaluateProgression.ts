import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../../lib/firebaseAdmin';
import { requireAuth } from '../../lib/auth';
import { resolveWorkoutLifecycleQaMode, progressionPolicyModeFor } from '../qaPolicy';
import { computeActiveTimeTrace } from '../prescriptionEngine/progressionEngineV2/activeTime';
import { computeAdherence } from '../prescriptionEngine/progressionEngineV2/adherence';
import { countEarnedIntermediateCycles } from '../prescriptionEngine/progressionEngineV2/earnedCycles';
import {
  buildPrescribedOpportunities,
  countFulfilledPrescribedOpportunities,
} from '../prescriptionEngine/progressionEngineV2/prescribedOpportunities';
import { evaluateProgressionV2 } from '../prescriptionEngine/progressionEngineV2/resolver';
import { resolveProgressionV2Config, PROGRESSION_V2_CONFIG } from '../prescriptionEngine/progressionEngineV2/config';
import type { ProgressionSnapshotV2 } from '../prescriptionEngine/progressionEngineV2/types';
import { localDateInTimezone } from '../prescriptionEngine/scheduleEngine/localDate';
import type { Weekday } from '../prescriptionEngine/state/AppState';

/**
 * Fase 5.0 (docs/33_fase5_0_estudo_latencia_server_side.md) — READ-ONLY
 * structural prototype. NOT wired into `functions/src/index.ts`: it is not
 * a deployable Cloud Function, only a handler exercised directly by its own
 * integration test against the Firestore Emulator. It exists to answer one
 * question — can the client's 3-network-wave `evaluateProgressionV2ForUserFull`
 * orchestration (`src/services/workoutProgressionV2.ts`) collapse into a
 * single server round trip using the SAME pure decision engine, with no new
 * business rules and no writes?
 *
 * Reuses the ADR-016-synced pure engine verbatim
 * (`functions/src/workoutLifecycle/prescriptionEngine/progressionEngineV2/*`,
 * generated from `src/progressionEngineV2/*` by
 * `scripts/syncPrescriptionEngineToFunctions.cjs`) — this file only
 * reimplements the FETCH/ORCHESTRATION step via the Admin SDK, mirroring
 * `evaluateProgressionV2ForUserFull`'s client-SDK fetch step
 * document-for-document. It never reimplements a decision rule.
 *
 * Security posture mirrors `installActiveWorkoutProgram.ts` (the reference
 * pattern named in the Fase 5.0 brief): `request.auth.uid` is the only
 * identity source, `request.data` is validated to carry no fields at all
 * (a forged `uid` field is rejected, not silently ignored), and every read
 * is authoritative Admin SDK data — nothing here trusts a client snapshot.
 *
 * SCOPE LIMITATIONS (deliberate, not oversights — a full production
 * Option A would need to close these, this prototype exists to measure
 * structural/latency shape, not to replace the client path):
 *   - FIXED schedule mode only. A `workoutPrograms/{id}.scheduleMode ===
 *     'flexible'` ProgramInstance throws `unimplemented` rather than
 *     silently computing a wrong adherence figure.
 *   - Requires an embedded `programInstances/{id}.prescriptionInputSnapshot
 *     .inputs.trainingDays` — the legacy per-account
 *     `questionnaires/{id}`-fallback path (`loadAuthoritativePrescriptionInputs`)
 *     is not ported.
 *   - QA_TRANSITION is not specially handled (the client resolver itself has
 *     no such branch either — that bypass lives only in
 *     `authorizeMutation.ts`'s write-authorization path, out of scope here).
 */

export interface ServerEvaluateProgressionResult {
  progressionDecision: string | null;
  level: string | null;
  computedAtEpochMs: number;
}

function hasAnyOwnKeys(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

/**
 * The fetch/build half of the orchestration, split out from
 * `serverEvaluateProgressionHandler` for exactly one reason: it lets the
 * equivalence test assert on the FULL `ProgressionSnapshotV2` this
 * orchestrator derives from real Firestore data (activeDays, adherence
 * ratio, etc.) against a hand-computed expected value — the public
 * handler's return payload is deliberately minimal (docs §J) and does not
 * expose those fields. `null` means "no lifecycle yet" (not an error).
 */
export async function buildProgressionSnapshotV2FromFirestore(
  uid: string,
  firestore: Firestore,
  now: Date,
): Promise<{ snapshot: ProgressionSnapshotV2; qaMode: Awaited<ReturnType<typeof resolveWorkoutLifecycleQaMode>> } | null> {
  const root = firestore.collection('users').doc(uid);
  const lifecycleSnapshot = await root.collection('workoutLifecycleState').doc('current').get();
  if (!lifecycleSnapshot.exists) {
    // Matches the client's own `evaluateProgressionV2ForUserFull` contract:
    // a never-onboarded account has nothing to evaluate — this is not an
    // error case.
    return null;
  }
  const lifecycle = lifecycleSnapshot.data()!;
  const currentTrainingLevel = lifecycle.currentTrainingLevel as ProgressionSnapshotV2['level'];
  const activeProgramInstanceId = lifecycle.activeProgramInstanceId as string;
  const activeContentIdentity = lifecycle.activeContentIdentity as string;
  const currentCycleId = lifecycle.currentCycleId as string;

  const [instanceSnapshot, cycleSnapshot] = await Promise.all([
    root.collection('programInstances').doc(activeProgramInstanceId).get(),
    root.collection('trainingCycles').doc(currentCycleId).get(),
  ]);
  if (!instanceSnapshot.exists || !cycleSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'workout_lifecycle_referent_missing');
  }
  const instance = instanceSnapshot.data()!;

  const programRef = root.collection('workoutPrograms').doc(activeContentIdentity);
  const [scheduleConfigSnapshot, executionsSnapshot, scheduleEventsSnapshot, programSnapshot, relevantCyclesSnapshot, qaMode] =
    await Promise.all([
      root.collection('workoutProgramState').doc('scheduleConfig').get(),
      root.collection('workoutExecutions').where('programInstanceId', '==', activeProgramInstanceId).get(),
      programRef.collection('scheduleEvents').where('programInstanceId', '==', activeProgramInstanceId).get(),
      programRef.get(),
      currentTrainingLevel === 'INTERMEDIATE'
        ? root.collection('trainingCycles')
          .where('level', '==', 'INTERMEDIATE')
          .orderBy('cycleNumber', 'desc')
          .limit(PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion)
          .get()
        : Promise.resolve(null),
      resolveWorkoutLifecycleQaMode(uid, firestore),
    ]);

  if (!programSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'workout_lifecycle_referent_missing');
  }
  const program = programSnapshot.data()!;
  if (program.scheduleMode === 'flexible') {
    throw new HttpsError('unimplemented', 'server_evaluate_progression_flexible_schedule_not_supported');
  }
  const prescriptionInputs = instance.prescriptionInputSnapshot?.inputs;
  if (!prescriptionInputs) {
    throw new HttpsError('unimplemented', 'server_evaluate_progression_legacy_prescription_inputs_not_supported');
  }

  const trainingDays: Weekday[] = Array.isArray(program.weeklySchedule) && program.weeklySchedule.length > 0
    ? program.weeklySchedule
      .filter((day: { state?: unknown; weekday?: unknown }) => day.state === 'TRAINING' && typeof day.weekday === 'string')
      .map((day: { weekday: string }) => day.weekday as Weekday)
    : Array.isArray(prescriptionInputs.trainingDays) ? prescriptionInputs.trainingDays as Weekday[] : [];

  // Mirrors `loadAuthoritativePrescribedSessions`
  // (`src/services/workoutProgressionV2.ts:33-60`): raw prescribed-session
  // documents store a per-exercise `sets` NUMBER, but
  // `isValidProgressionSessionAgainstPrescription` compares against a
  // `setCount` field — without this mapping every execution fails that
  // check (undefined !== recordedExercise.sets.length) and
  // `validSessionCount` is silently always 0, regardless of real adherence.
  const sessions: { exercises: { exerciseId: string; setCount: number }[] }[] = Array.isArray(program.sessions)
    ? program.sessions.map((session: { exercises?: unknown }) => ({
      exercises: Array.isArray(session?.exercises)
        ? session.exercises.map((exercise: { exerciseId?: unknown; sets?: unknown }) => ({
          exerciseId: typeof exercise?.exerciseId === 'string' ? exercise.exerciseId : '',
          setCount: Number.isInteger(exercise?.sets) ? (exercise.sets as number) : 1,
        }))
        : [],
    }))
    : [];
  const scheduleConfig = scheduleConfigSnapshot.data();
  const timezone = typeof scheduleConfig?.timezone === 'string' ? scheduleConfig.timezone : 'UTC';
  const todayLocalDate = localDateInTimezone(now, timezone);
  const activatedAt = instance.activatedAt.toDate();
  const progressionWindowStartLocalDate = localDateInTimezone(activatedAt, timezone);

  const executions = executionsSnapshot.docs.map((item) => item.data()) as {
    scheduledLocalDate: string;
    sessionIndex: number;
    status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'ABANDONED';
    exercises: readonly { exerciseIndex?: number; exerciseId?: string; sets: readonly { setIndex?: number; status: 'COMPLETED' | 'SKIPPED' | 'PENDING' }[] }[];
  }[];
  const scheduleEvents = scheduleEventsSnapshot.docs.map((item) => item.data()) as {
    type: 'COMPLETED' | 'SKIPPED' | 'MISS_RESOLVED';
    programInstanceId?: string;
    sessionIndex: number;
    scheduledDate: string;
  }[];

  const executionDates = new Set(executions.map((execution) => execution.scheduledLocalDate));
  const activeTrace = computeActiveTimeTrace({
    startDateInclusive: progressionWindowStartLocalDate,
    todayLocalDate,
    trainingDays,
    scheduleMode: 'fixed',
    executionDates,
  });
  const prescribedOpportunities = buildPrescribedOpportunities({
    programInstanceId: activeProgramInstanceId,
    trainingDays,
    countedActiveDates: activeTrace.countedDates,
  });
  const validSessionCount = countFulfilledPrescribedOpportunities({
    programInstanceId: activeProgramInstanceId,
    executions,
    scheduleEvents,
    prescribedOpportunities,
    prescribedSessions: sessions,
    trainingDays,
  });
  const expectedSessions = prescribedOpportunities.length;
  const adherence = computeAdherence(validSessionCount, expectedSessions);
  const earnedIntermediateCycleCount = currentTrainingLevel === 'INTERMEDIATE' && relevantCyclesSnapshot
    ? countEarnedIntermediateCycles(relevantCyclesSnapshot.docs.map((item) => item.data()) as never[])
    : 0;

  const snapshot: ProgressionSnapshotV2 = {
    level: currentTrainingLevel,
    activeTime: activeTrace.activeTime,
    adherence,
    earnedIntermediateCycleCount,
    hasInProgressExecution: executions.some((execution) => execution.status === 'IN_PROGRESS'),
    validSessionCount,
  };

  return { snapshot, qaMode };
}

export async function serverEvaluateProgressionHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
  now: Date = new Date(),
): Promise<ServerEvaluateProgressionResult> {
  const uid = requireAuth(request);

  // This callable takes no meaningful input — uid is implicit from the
  // verified token. Any field in `request.data` (including a forged `uid`)
  // is rejected outright rather than ignored, so a caller can never
  // convince itself the payload silently "worked" while being disregarded.
  if (hasAnyOwnKeys(request.data)) {
    throw new HttpsError('invalid-argument', 'server_evaluate_progression_unexpected_payload');
  }

  const built = await buildProgressionSnapshotV2FromFirestore(uid, firestore, now);
  if (!built) {
    return { progressionDecision: null, level: null, computedAtEpochMs: Date.now() };
  }

  const config = resolveProgressionV2Config(progressionPolicyModeFor(built.qaMode));
  const decision = evaluateProgressionV2(built.snapshot, config);
  const level = 'to' in decision ? decision.to : 'level' in decision ? decision.level : null;

  return { progressionDecision: decision.type, level, computedAtEpochMs: Date.now() };
}
