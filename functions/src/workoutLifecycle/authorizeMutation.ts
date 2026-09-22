import { createHash } from 'node:crypto';

import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { detectMissedSessionGap, resolveWorkoutSchedule } from './scheduleEngine/resolver';
import type { ScheduleAuthorityContext } from './finalizationAuthority';
import { buildScheduleAuthorityContext, prescribedExecutionCounts } from './finalizationAuthority';
import type { FinalWorkoutPlan, QuestionnaireAnswers } from './prescriptionEngine/workoutPrescription/types';
import { EXERCISES_SEED } from './prescriptionEngine/data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from './prescriptionEngine/workoutPrescription/canonicalActivities';
import { mapQuestionnaireLimitations, type LimitationCatalogExercise } from './prescriptionEngine/workoutPrescription/limitationResolver';
import { equipmentContextFor } from './prescriptionEngine/workoutPrescription/equipment';
import { buildRecentSlotHistory, evolveCycle } from './prescriptionEngine/prescriptionEvolution/cycleEvolution';
import { PRESCRIPTION_EVOLUTION_CONFIG } from './prescriptionEngine/prescriptionEvolution/config';
import { countEarnedIntermediateCycles } from './prescriptionEngine/progressionEngineV2/earnedCycles';
import { PROGRESSION_V2_CONFIG, resolveProgressionV2Config } from './prescriptionEngine/progressionEngineV2/config';
import type { TrainingCycle, CurrentTrainingLevel } from './prescriptionEngine/workoutLifecycle/types';
import type { PrescriptionGenerationVersion } from './prescriptionEngine/workoutPrescription/generationVersion';
import {
  generateAuthoritativePlan,
  resolveAuthoritativeGenerationVersionForNewLifecycle,
  authoritativeGenerationVersionForActiveProgram,
} from './authoritativePrescription';
import { isOperationBlockedByCircuitBreaker, loadWorkoutLifecycleCircuitBreakerConfig } from './circuitBreaker';
import { progressionPolicyModeFor, resolveWorkoutLifecycleQaMode } from './qaPolicy';
import { logWarn } from '../lib/logger';
import { validateMaterializedExecutionSubstitutions } from './exerciseSubstitution';
import { buildPrescriptionInputSnapshot } from './prescriptionEngine/workoutLifecycle/prescriptionInputs';
import { WORKOUT_LIFECYCLE_SCHEMA_VERSION } from './prescriptionEngine/workoutLifecycle/types';

export const WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID = 'current';

const CANONICAL_ACTIVITY_IDS = new Set(CANONICAL_ACTIVITIES.map((activity) => activity.id));

const OPERATIONS = [
  'INITIALIZE', 'MIGRATE', 'RECOVER', 'EARN', 'PREPARE', 'DEFER',
  'ACTIVATE', 'ADAPT', 'FINISH_EXECUTION', 'COMPLETE_SCHEDULE', 'RESOLVE_MISSED_SESSION',
] as const;
type AuthorityOperation = typeof OPERATIONS[number];

interface AuthorityRequest {
  operation: AuthorityOperation;
  sourceProgramInstanceId?: string;
  sourceCycleId?: string;
  sourcePrescriptionInputSnapshotId?: string;
  targetProgramInstanceId?: string;
  targetCycleId?: string;
  targetContentIdentity?: string;
  targetPrescriptionIdentity?: string;
  targetTrainingLevel?: string;
  targetCycleNumber?: number;
  questionnaireId?: string;
  questionnaireVersion?: number;
  targetProgramSource?: string;
  targetTemplateVersion?: number;
  targetTemplateSourceVersion?: string;
  targetTemplateContentHash?: string;
  pendingEvolutionId?: string;
  eventId?: string;
  eventType?: string;
  idempotencyKey?: string;
  executionId?: string;
  scheduledLocalDate?: string;
  sessionIndex?: number;
  decision?: 'CONTINUE_SEQUENCE' | 'FOLLOW_SCHEDULE';
  expectedMissedSessionIndex?: number;
  expectedCalendarSessionIndex?: number;
  expectedMissedScheduledDate?: string;
  targetPlan?: Record<string, unknown>;
  targetPrescriptionInputSnapshot?: Record<string, unknown>;
  updatedFields?: Record<string, unknown>;
  earnedFact?: Record<string, unknown>;
}

interface LifecycleState {
  currentTrainingLevel: string;
  currentCycleId: string;
  currentCycleNumber: number;
  activeProgramInstanceId: string;
  activeContentIdentity: string;
  activePrescriptionIdentity: string;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

function parseRequest(value: unknown): AuthorityRequest {
  if (!plainObject(value) || !OPERATIONS.includes(value.operation as AuthorityOperation)) {
    throw new HttpsError('invalid-argument', 'invalid_lifecycle_authority_operation');
  }
  if (JSON.stringify(value).length > 900_000) {
    throw new HttpsError('invalid-argument', 'lifecycle_authority_request_too_large');
  }
  return value as unknown as AuthorityRequest;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function snapshotIdFor(source: string, inputs: Record<string, unknown>): string {
  let hash = 0x811c9dc5;
  const identity = canonical({ schemaVersion: 1, source, inputs });
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pis_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function lifecycleStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Root-cause fix (docs/workout-lifecycle/v2/qa/ — confirmed via a real
 * device): a React Native/Hermes Firestore client can deserialize
 * `plan.versions`, a Firestore map field, with a different (but
 * content-identical) key order than this Cloud Function's own read of the
 * same document — silently changing a plain `JSON.stringify`'s output and
 * therefore the hash, even though `lifecycleStableHash`/FNV-1a itself is
 * fully ECMAScript-spec-deterministic. Uses the EXISTING `canonical()`
 * helper (already defined above and already used by this file's own
 * plan-comparison checks) instead of raw `JSON.stringify`, so a value's
 * position in the object literal below is the only thing that can affect
 * the hash — never incidental key insertion order from any SDK/engine.
 * Mirrored exactly by the client's `contentIdentityPreimage`
 * (`src/services/workoutPrograms.ts`).
 */
export function canonicalContentIdentity(input: {
  questionnaireId: string;
  questionnaireVersion: number;
  plan: FinalWorkoutPlan;
  templateMetadata: { version: number; contentHash: string };
}): string {
  const identity = canonical({
    questionnaireId: input.questionnaireId,
    questionnaireVersion: input.questionnaireVersion,
    prescriptionId: input.plan.planId,
    templateId: input.plan.templateId,
    templateVersion: input.templateMetadata.version,
    templateContentHash: input.templateMetadata.contentHash,
    versions: input.plan.versions,
    limitationDatasetVersion: input.plan.limitationDatasetVersion,
    limitationDatasetHash: input.plan.limitationDatasetHash,
    adaptationStage: input.plan.adaptationStage ?? null,
  });
  return `wpg_${lifecycleStableHash(identity)}`;
}

function lifecycleEventId(type: string, idempotencyKey: string): string {
  return `wle_${lifecycleStableHash(`${type}:${idempotencyKey}`)}`;
}

function currentLevelInput(level: string): string {
  if (level === 'BEGINNER') return 'beginner';
  if (level === 'INTERMEDIATE') return 'intermediate';
  if (level === 'ADVANCED') return 'advanced';
  throw new HttpsError('failed-precondition', 'invalid_authoritative_training_level');
}

function assertSource(request: AuthorityRequest, state: LifecycleState): void {
  if (
    (request.sourceProgramInstanceId != null && request.sourceProgramInstanceId !== state.activeProgramInstanceId)
    || (request.sourceCycleId != null && request.sourceCycleId !== state.currentCycleId)
  ) throw new HttpsError('aborted', 'stale_lifecycle_authority_base');
}

async function activeBundle(uid: string, firestore: Firestore): Promise<{
  state: LifecycleState;
  instance: DocumentData;
  cycle: DocumentData;
  program: DocumentData;
}> {
  const root = firestore.collection('users').doc(uid);
  const stateSnapshot = await root.collection('workoutLifecycleState').doc('current').get();
  if (!stateSnapshot.exists) throw new HttpsError('failed-precondition', 'workout_lifecycle_not_initialized');
  const state = stateSnapshot.data() as LifecycleState;
  const [instanceSnapshot, cycleSnapshot, programSnapshot] = await Promise.all([
    root.collection('programInstances').doc(state.activeProgramInstanceId).get(),
    root.collection('trainingCycles').doc(state.currentCycleId).get(),
    root.collection('workoutPrograms').doc(state.activeContentIdentity).get(),
  ]);
  if (!instanceSnapshot.exists || !cycleSnapshot.exists || !programSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'workout_lifecycle_referent_missing');
  }
  return {
    state,
    instance: instanceSnapshot.data()!,
    cycle: cycleSnapshot.data()!,
    program: programSnapshot.data()!,
  };
}

function localDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}`;
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/**
 * Realistic offline-sync slack (docs/workout-lifecycle/v2/decisions/
 * ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md §Backdating): a session
 * finished while offline can legitimately sync a few days late. Anything
 * older than this is treated as fabricated adherence, not delayed sync.
 */
const SCHEDULE_BACKDATING_GRACE_DAYS = 3;

function assertNotBackdated(scheduledLocalDate: string, timezone: string, now: Date): void {
  const today = localDate(now, timezone);
  if (scheduledLocalDate > today || addDays(scheduledLocalDate, SCHEDULE_BACKDATING_GRACE_DAYS) < today) {
    throw new HttpsError('permission-denied', 'schedule_completion_date_out_of_grace_window');
  }
}

async function loadScheduleAuthorityContext(
  uid: string,
  bundle: Awaited<ReturnType<typeof activeBundle>>,
  firestore: Firestore,
): Promise<ScheduleAuthorityContext> {
  const root = firestore.collection('users').doc(uid);
  const [scheduleConfigSnapshot, stateSnapshot] = await Promise.all([
    root.collection('workoutProgramState').doc('scheduleConfig').get(),
    root.collection('workoutPrograms').doc(bundle.state.activeContentIdentity)
      .collection('scheduleState').doc(bundle.state.activeProgramInstanceId).get(),
  ]);
  return buildScheduleAuthorityContext({
    scheduleConfigData: scheduleConfigSnapshot.data() ?? {},
    stateData: stateSnapshot.exists ? stateSnapshot.data()! : null,
    instance: bundle.instance,
    program: bundle.program,
  });
}

function qualifyingExecution(execution: DocumentData, session: DocumentData, expectedInstanceId: string): boolean {
  if (!['COMPLETED', 'PARTIALLY_COMPLETED'].includes(execution.status)) return false;
  const counts = prescribedExecutionCounts(execution, session, expectedInstanceId);
  return counts !== null && counts.completed * 100 >= counts.prescribed * 70;
}

// Exported for tests only (docs/workout-lifecycle/v2/qa/) — lets QA_TRANSITION
// test coverage use this function's own real output as the oracle for what
// the EARN handler should accept, instead of hand-computing activeDays/
// adherence numbers. Not imported by any non-test module.
async function authoritativeEarnedFactWithCycleHistory(
  uid: string,
  firestore: Firestore,
  now: Date,
  cycleHistory: 'BOUNDED' | 'FULL_SCAN_ORACLE',
): Promise<Record<string, unknown>> {
  const { state, instance, program } = await activeBundle(uid, firestore);
  const root = firestore.collection('users').doc(uid);
  const [qaMode, scheduleConfigSnapshot, executionsSnapshot, scheduleEventsSnapshot, cyclesSnapshot] = await Promise.all([
    resolveWorkoutLifecycleQaMode(uid, firestore),
    root.collection('workoutProgramState').doc('scheduleConfig').get(),
    root.collection('workoutExecutions').where('programInstanceId', '==', state.activeProgramInstanceId).get(),
    root.collection('workoutPrograms').doc(state.activeContentIdentity).collection('scheduleEvents').get(),
    cycleHistory === 'FULL_SCAN_ORACLE'
      ? root.collection('trainingCycles').get()
      : state.currentTrainingLevel === 'INTERMEDIATE'
      ? root.collection('trainingCycles')
        .where('level', '==', 'INTERMEDIATE')
        .orderBy('cycleNumber', 'desc')
        .limit(PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion)
        .get()
      : Promise.resolve(null),
  ]);
  const config = resolveProgressionV2Config(progressionPolicyModeFor(qaMode));
  const scheduleConfig = scheduleConfigSnapshot.data() ?? {};
  const snapshotInputs = plainObject(instance.prescriptionInputSnapshot?.inputs)
    ? instance.prescriptionInputSnapshot.inputs as Record<string, unknown>
    : {};
  const scheduleMode = program.scheduleMode === 'flexible'
    ? 'flexible'
    : program.scheduleMode === 'fixed'
      ? 'fixed'
      : snapshotInputs.scheduleMode === 'flexible'
        ? 'flexible'
        : 'fixed';
  const programTrainingDays = Array.isArray(program.weeklySchedule)
    ? program.weeklySchedule.flatMap((item: unknown) => plainObject(item)
      && item.state === 'TRAINING' && typeof item.weekday === 'string' ? [item.weekday] : [])
    : [];
  const configuredDays = programTrainingDays.length > 0
    ? programTrainingDays
    : Array.isArray(snapshotInputs.trainingDays) && snapshotInputs.trainingDays.length > 0
      ? snapshotInputs.trainingDays
      : Array.isArray(scheduleConfig.trainingDays) ? scheduleConfig.trainingDays : [];
  const trainingDays = new Set(configuredDays.filter((item): item is string => typeof item === 'string'));
  const timezone = typeof scheduleConfig.timezone === 'string' ? scheduleConfig.timezone : 'UTC';
  const start = localDate((instance.activatedAt as Timestamp).toDate(), timezone);
  const today = localDate(now, timezone);
  const executions = executionsSnapshot.docs.map((item) => item.data());
  // P0 integrity fix (2026-09, docs/workout-lifecycle/): parity with the
  // client resolver (`src/progressionEngineV2/resolver.ts`'s
  // `hasInProgressExecution` check) — an IN_PROGRESS execution for the
  // active instance always blocks a progression decision (docs §9/§42), and
  // that rule must not depend solely on the client honoring it. Without this,
  // a modified/old client (or a client racing a real IN_PROGRESS session)
  // could call EARN directly and the backend would authorize a decision the
  // client itself would have refused to compute.
  if (executions.some((item) => item.status === 'IN_PROGRESS')) {
    throw new HttpsError('failed-precondition', 'progression_blocked_by_in_progress_execution');
  }
  const executionDates = new Set(executions.map((item) => item.scheduledLocalDate).filter((item): item is string => typeof item === 'string'));
  const countedDates = new Set<string>();
  let activeDays = 0;
  let missed = 0;
  let paused = false;
  for (let cursor = start, guard = 0; cursor <= today && guard < 3660; cursor = addDays(cursor, 1), guard += 1) {
    const hasExecution = executionDates.has(cursor);
    if (hasExecution) { missed = 0; paused = false; }
    if (!paused) { activeDays += 1; countedDates.add(cursor); }
    if (scheduleMode === 'fixed' && !hasExecution && trainingDays.has(weekday(cursor)) && cursor < today) {
      missed += 1;
      if (missed >= config.inactivityMissedOpportunityThreshold) paused = true;
    }
  }
  const opportunityDates = new Set(scheduleMode === 'fixed'
    ? [...countedDates].filter((date) => trainingDays.has(weekday(date)))
    : []);
  const completedLedger = new Set(scheduleEventsSnapshot.docs.map((item) => item.data())
    .filter((event) => event.type === 'COMPLETED' && event.programInstanceId === state.activeProgramInstanceId)
    .map((event) => `${event.scheduledDate}:${event.sessionIndex}`));
  const fulfilled = new Set<string>();
  for (const execution of executions) {
    if (scheduleMode === 'fixed' && !opportunityDates.has(execution.scheduledLocalDate)) continue;
    const session = Array.isArray(program.sessions) ? program.sessions[execution.sessionIndex] : null;
    const key = `${execution.scheduledLocalDate}:${execution.sessionIndex}`;
    if (completedLedger.has(key) && qualifyingExecution(execution, session, state.activeProgramInstanceId)) fulfilled.add(key);
  }
  const prescribedFrequency = Number.isInteger(program.prescribedTrainingFrequency)
    ? program.prescribedTrainingFrequency
    : program.prescribedStructuredDays;
  const flexibleExpectedByWeek = new Map<string, number>();
  if (scheduleMode === 'flexible') {
    const weekdayOffset: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
    const activeDaysByWeek = new Map<string, number>();
    for (const date of countedDates) {
      const week = addDays(date, -(weekdayOffset[weekday(date)] ?? 0));
      activeDaysByWeek.set(week, (activeDaysByWeek.get(week) ?? 0) + 1);
    }
    for (const [week, activeDays] of activeDaysByWeek) {
      flexibleExpectedByWeek.set(week, Math.min(prescribedFrequency, activeDays));
    }
  }
  const expected = scheduleMode === 'flexible'
    ? [...flexibleExpectedByWeek.values()].reduce((sum, count) => sum + count, 0)
    : opportunityDates.size;
  let fulfilledCount = fulfilled.size;
  if (scheduleMode === 'flexible') {
    const weekdayOffset: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
    const fulfilledByWeek = new Map<string, number>();
    for (const key of fulfilled) {
      const date = key.slice(0, 10);
      const week = addDays(date, -(weekdayOffset[weekday(date)] ?? 0));
      fulfilledByWeek.set(week, (fulfilledByWeek.get(week) ?? 0) + 1);
    }
    fulfilledCount = [...flexibleExpectedByWeek.entries()].reduce(
      (sum, [week, target]) => sum + Math.min(target, fulfilledByWeek.get(week) ?? 0), 0,
    );
  }
  const ratioBp = expected === 0 ? 0 : Math.min(10_000, Math.floor(fulfilledCount * 10_000 / expected));
  const quality = ratioBp >= config.adherenceHighThresholdBp ? 'HIGH'
    : ratioBp >= config.adherenceEarnedThresholdBp ? 'GOOD' : 'BELOW_TARGET';
  const minDays = state.currentTrainingLevel === 'BEGINNER'
    ? config.beginnerMinimumActiveDays : config.intermediateAdvancedMinimumActiveDays;
  // QA_TRANSITION's entire purpose (docs/workout-lifecycle/v2/qa/): replace
  // ONLY the eligibility decision — never activeDays, never adherence, never
  // the type/toLevel branching below, which still runs unmodified off the
  // account's REAL currentTrainingLevel/earned-cycle history. Every other
  // gate (70%/85% quality bands, the 4-cycle rule, canonical prescription
  // generation downstream in PREPARE) is completely untouched.
  const earned = qaMode === 'QA_TRANSITION'
    ? true
    : activeDays >= minDays && ratioBp >= config.adherenceEarnedThresholdBp;
  let type: string | null = null;
  let toLevel = state.currentTrainingLevel;
  if (earned && state.currentTrainingLevel === 'BEGINNER') { type = 'LEVEL_PROMOTION'; toLevel = 'INTERMEDIATE'; }
  else if (earned && state.currentTrainingLevel === 'INTERMEDIATE') {
    // Phase 10D (docs/workout-lifecycle/v2/architecture/
    // 22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md P2 finding): use the exact
    // same shared rule the client's local mirror uses — a hand-reimplemented
    // inline check previously diverged from it (missing the legacy pre-8A
    // fallback inference), under-counting real earned cycles for those users.
    const earnedIntermediate = countEarnedIntermediateCycles(
      (cyclesSnapshot?.docs ?? []).map((item) => item.data() as unknown as Pick<TrainingCycle<unknown>,
        'level' | 'status' | 'progressionReason' | 'cycleNumber' | 'completionReason'>));
    if (earnedIntermediate + 1 >= config.intermediateCyclesForPromotion) { type = 'LEVEL_PROMOTION'; toLevel = 'ADVANCED'; }
    else type = 'CYCLE_EVOLUTION';
  } else if (earned && state.currentTrainingLevel === 'ADVANCED') type = 'CYCLE_EVOLUTION';
  else if (!earned && activeDays >= minDays + config.motivationalRenewalExtensionDays && ratioBp < config.adherenceEarnedThresholdBp) type = 'MOTIVATIONAL_RENEWAL';
  if (!type) throw new HttpsError('failed-precondition', 'progression_not_eligible');
  return {
    type,
    fromLevel: state.currentTrainingLevel,
    toLevel,
    quality,
    sessionsCompletedAtEarn: fulfilledCount,
    adherenceAtEarnBp: ratioBp,
    // Ephemeral marker, never persisted verbatim to the domain ledger
    // (`persistEarnedFact`'s Firestore write picks an explicit 6-field
    // payload — see src/services/workoutLifecycleApplication.ts — so this
    // never needs a Rules change). Only used here, in the EARN grant, and
    // in trusted telemetry, so a QA_TRANSITION-forced transition is never
    // mistaken for a real earned one downstream.
    ...(qaMode === 'QA_TRANSITION' ? { qaForced: true, triggerSource: 'QA_TRANSITION' } : {}),
  };
}

export async function authoritativeEarnedFact(uid: string, firestore: Firestore, now: Date): Promise<Record<string, unknown>> {
  return authoritativeEarnedFactWithCycleHistory(uid, firestore, now, 'BOUNDED');
}

/** Test-only reference preserving the pre-Phase-2 history read for structural equivalence assertions. */
export async function authoritativeEarnedFactFullScanOracleForTest(
  uid: string,
  firestore: Firestore,
  now: Date,
): Promise<Record<string, unknown>> {
  return authoritativeEarnedFactWithCycleHistory(uid, firestore, now, 'FULL_SCAN_ORACLE');
}

function assertSnapshot(request: AuthorityRequest, bundle: Awaited<ReturnType<typeof activeBundle>>): Record<string, unknown> {
  const target = request.targetPrescriptionInputSnapshot;
  if (!plainObject(target) || !plainObject(target.inputs) || target.schemaVersion !== 1) {
    throw new HttpsError('invalid-argument', 'invalid_target_prescription_input_snapshot');
  }
  const sourceInputs = bundle.instance.prescriptionInputSnapshot?.inputs;
  if (!plainObject(sourceInputs)) throw new HttpsError('failed-precondition', 'source_prescription_inputs_missing');
  let expectedInputs: Record<string, unknown>;
  let source: string;
  if (request.operation === 'ADAPT') {
    if (!plainObject(request.updatedFields) || 'level' in request.updatedFields) {
      throw new HttpsError('invalid-argument', 'adaptation_cannot_change_level');
    }
    expectedInputs = { ...sourceInputs, ...request.updatedFields, level: currentLevelInput(bundle.state.currentTrainingLevel) };
    source = 'PROGRAM_ADAPTATION';
  } else {
    const pendingLevel = request.earnedFact?.toLevel;
    expectedInputs = { ...sourceInputs, level: currentLevelInput(typeof pendingLevel === 'string' ? pendingLevel : bundle.state.currentTrainingLevel) };
    source = request.earnedFact?.type === 'LEVEL_PROMOTION' ? 'LEVEL_PROMOTION'
      : request.earnedFact?.type === 'MOTIVATIONAL_RENEWAL' ? 'MOTIVATIONAL_RENEWAL' : 'CYCLE_EVOLUTION';
  }
  if (canonical(target.inputs) !== canonical(expectedInputs) || target.source !== source
    || target.snapshotId !== snapshotIdFor(source, expectedInputs)) {
    throw new HttpsError('permission-denied', 'target_prescription_inputs_not_authoritative');
  }
  return expectedInputs;
}

async function assertPlanSafe(request: AuthorityRequest, firestore: Firestore): Promise<void> {
  const plan = request.targetPlan;
  const snapshot = request.targetPrescriptionInputSnapshot;
  if (!plainObject(plan) || !Array.isArray(plan.sessions) || plan.sessions.length < 1 || plan.sessions.length > 7
    || !plainObject(snapshot) || !plainObject(snapshot.inputs)) {
    throw new HttpsError('invalid-argument', 'invalid_authority_plan');
  }
  const exerciseSlots = plan.sessions.flatMap((session) => plainObject(session) && Array.isArray(session.exercises)
    ? session.exercises
    : [null]);
  const exerciseIds = exerciseSlots.map((exercise) => plainObject(exercise) ? exercise.exerciseId : null);
  if (exerciseIds.length === 0 || exerciseIds.length > 100 || exerciseIds.some((id) => !boundedId(id))) {
    throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercises');
  }
  // Defense in depth against a structurally-plausible but semantically
  // impossible prescription (e.g. 1,000,000 sets) reaching Admin SDK sealing
  // — bounds alone are not the primary safety mechanism (backend
  // recomputation/verification is), but no plan may be sealed outside them
  // regardless of how it was produced (docs/workout-lifecycle/v2/decisions/
  // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md).
  for (const exercise of exerciseSlots) {
    if (!plainObject(exercise)) throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercise_shape');
    const sets = exercise.sets;
    if (sets !== undefined && (typeof sets !== 'number' || !Number.isInteger(sets) || sets < 1 || sets > 10)) {
      throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercise_sets');
    }
    const reps = exercise.reps;
    if (reps !== undefined && (typeof reps !== 'string' || reps.length === 0 || reps.length > 20)) {
      throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercise_reps');
    }
    const restSeconds = exercise.restSeconds;
    if (restSeconds !== undefined
      && (typeof restSeconds !== 'number' || !Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600)) {
      throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercise_rest');
    }
    const cycles = exercise.cycles;
    if (cycles !== undefined
      && (typeof cycles !== 'number' || !Number.isInteger(cycles) || cycles < 1 || cycles > 100)) {
      throw new HttpsError('invalid-argument', 'invalid_authority_plan_exercise_cycles');
    }
  }
  const inputs = snapshot.inputs;
  const special = Array.isArray(inputs.specialConditions) ? inputs.specialConditions : [];
  const regions = special.includes('musculoskeletal_limitation') && Array.isArray(inputs.limits)
    ? inputs.limits.filter((item): item is string => typeof item === 'string' && item !== 'none') : [];
  // Fase 11 §5 — a v1.27 plan may legitimately reference a
  // `CANONICAL_ACTIVITIES` id (cardio-leve, mobilidade-geral, etc.): a
  // disjoint, non-Firestore-backed catalog with no `status`/
  // `limitationProfile` concept at all (`canonicalActivities.ts`'s file
  // doc — deliberately never part of the `exercises` collection). These
  // are never looked up here, never treated as "unknown exercise".
  const resistanceExerciseIds = exerciseIds.filter(
    (id): id is string => typeof id === 'string' && !CANONICAL_ACTIVITY_IDS.has(id),
  );
  const documents = await firestore.getAll(...resistanceExerciseIds.map((id) => firestore.collection('exercises').doc(id)));
  for (const document of documents) {
    const exercise = document.data();
    if (!document.exists || exercise?.status !== 'active') throw new HttpsError('permission-denied', 'inactive_or_unknown_exercise');
    if (regions.length === 0) continue;
    const profile = exercise.limitationProfile;
    if (!plainObject(profile) || profile.schemaVersion !== 1 || profile.protocolVersion !== 'musculoskeletal-v1'
      || profile.reviewStatus !== 'approved' || !plainObject(profile.regions)) {
      throw new HttpsError('permission-denied', 'exercise_limitation_profile_untrusted');
    }
    for (const region of regions) {
      const rule = profile.regions[region];
      if (!plainObject(rule) || !['compatible', 'not_applicable'].includes(String(rule.status))) {
        throw new HttpsError('permission-denied', 'unsafe_exercise_for_authoritative_limitations');
      }
    }
  }
}

/**
 * The single point where the backend becomes prescription-authoritative
 * (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md):
 * runs the same deterministic engine the client runs, against authoritative
 * inputs and the same live Firestore/local catalogs the client reads —
 * never against anything the client submitted. The client's own
 * `targetPlan` is not read here at all; whatever this returns is what gets
 * sealed, regardless of what the client sent.
 *
 * Fase 11 (backend cutover) — `version`/`currentTrainingLevel` are now
 * required, CALLER-resolved parameters (never decided inside this
 * function): `generateAuthoritativePlan` (`authoritativePrescription.ts`)
 * is the one place that turns them into an actual engine call, routing to
 * either the v2 or v1.27 pipeline (`generatePrescription.ts`, the same
 * file synced to the client). Every call site below resolves `version`
 * itself from authoritative metadata (never client input) — see each
 * call's own comment for which source.
 */
async function generateCanonicalPlan(
  answers: QuestionnaireAnswers,
  firestore: Firestore,
  version: PrescriptionGenerationVersion,
  currentTrainingLevel: CurrentTrainingLevel,
): Promise<{ plan: FinalWorkoutPlan; templateMetadata: { version: number; sourceVersion: string; contentHash: string } }> {
  return generateAuthoritativePlan(answers, currentTrainingLevel, version, firestore);
}

/**
 * Mirrors `src/services/prescriptionEvolution.ts`'s `loadRecentPrescriptionSessions`:
 * walks the ProgramInstance `previousProgramInstanceId` chain backward from the
 * currently active instance, up to the anti-ping-pong window, collecting each
 * prior sealed program's sessions (docs §96/§97 — never inferred from counts).
 */
async function loadRecentPrescriptionSessions(
  uid: string,
  firestore: Firestore,
  startingInstance: DocumentData,
): Promise<FinalWorkoutPlan['sessions'][]> {
  const root = firestore.collection('users').doc(uid);
  const history: FinalWorkoutPlan['sessions'][] = [];
  let cursor: string | null = typeof startingInstance.previousProgramInstanceId === 'string'
    ? startingInstance.previousProgramInstanceId : null;
  while (cursor && history.length < PRESCRIPTION_EVOLUTION_CONFIG.antiPingPongWindow) {
    const instanceSnapshot = await root.collection('programInstances').doc(cursor).get();
    if (!instanceSnapshot.exists) break;
    const instance = instanceSnapshot.data()!;
    if (typeof instance.contentIdentity === 'string') {
      const programSnapshot = await root.collection('workoutPrograms').doc(instance.contentIdentity).get();
      const sessions = programSnapshot.data()?.sessions;
      if (Array.isArray(sessions)) history.push(sessions);
    }
    cursor = typeof instance.previousProgramInstanceId === 'string' ? instance.previousProgramInstanceId : null;
  }
  return history;
}

/**
 * CYCLE_EVOLUTION / MOTIVATIONAL_RENEWAL canonical generation — mirrors
 * `src/services/prescriptionEvolution.ts`'s shared conservative transformer.
 * Unlike `generateCanonicalPlan` (full engine, used for INITIALIZE/MIGRATE/
 * ADAPT/LEVEL_PROMOTION), this never re-selects a template or changes split/
 * frequency/session identity — it starts from the CURRENT sealed sessions
 * and substitutes only a bounded ratio of exercise slots for safe,
 * structurally-equivalent variants (docs prescription/02-05, ADR-008).
 */
async function generateCanonicalCycleEvolution(
  uid: string,
  answers: QuestionnaireAnswers,
  bundle: Awaited<ReturnType<typeof activeBundle>>,
  firestore: Firestore,
): Promise<{ plan: FinalWorkoutPlan; templateMetadata: { version: number; sourceVersion: string; contentHash: string } }> {
  const limitationMapping = mapQuestionnaireLimitations(answers);
  if (limitationMapping.status !== 'MAPPED') {
    throw new HttpsError('failed-precondition', 'authoritative_cycle_evolution_limitation_unmapped');
  }
  const catalog = new Map<string, LimitationCatalogExercise>(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));
  const equipmentContext = equipmentContextFor(answers, bundle.program.environment);
  const priorSessions = await loadRecentPrescriptionSessions(uid, firestore, bundle.instance);
  const targetCycleIdentity = `${bundle.state.currentCycleId}:${bundle.state.activeProgramInstanceId}`;
  const result = evolveCycle({
    sessions: bundle.program.sessions,
    targetCycleIdentity,
    limitationRegions: limitationMapping.regions,
    equipmentContext,
    catalog,
    recentSlotHistory: buildRecentSlotHistory(priorSessions),
  });
  const planId = `wpe_${stableHash(canonical({ basePlanId: bundle.program.planId, targetCycleIdentity, sessions: result.sessions }))}`;
  const plan: FinalWorkoutPlan = {
    planId,
    templateId: bundle.program.templateId,
    requestedDays: bundle.program.requestedDays,
    prescribedStructuredDays: bundle.program.prescribedStructuredDays,
    prescribedTrainingFrequency: bundle.program.prescribedTrainingFrequency,
    scheduleMode: bundle.program.scheduleMode === 'flexible' ? 'flexible' : 'fixed',
    availability: bundle.program.availability,
    weeklySchedule: bundle.program.weeklySchedule,
    population: bundle.program.population,
    environment: bundle.program.environment,
    goalFamily: bundle.program.goalFamily,
    split: bundle.program.split,
    adaptationStage: bundle.program.adaptationStage,
    limitationDatasetVersion: bundle.program.limitationDatasetVersion,
    limitationDatasetHash: bundle.program.limitationDatasetHash,
    sessions: result.sessions,
    versions: bundle.program.versions,
    trace: bundle.program.trace,
  };
  return {
    plan: JSON.parse(JSON.stringify(plan)) as FinalWorkoutPlan,
    templateMetadata: {
      version: bundle.program.templateVersion,
      sourceVersion: bundle.program.templateSourceVersion,
      contentHash: bundle.program.templateContentHash,
    },
  };
}

function levelFromSnapshot(snapshot: unknown): string {
  const level = plainObject(snapshot) && plainObject(snapshot.inputs) ? snapshot.inputs.level : null;
  if (level === 'beginner') return 'BEGINNER';
  if (level === 'intermediate') return 'INTERMEDIATE';
  if (level === 'advanced') return 'ADVANCED';
  throw new HttpsError('invalid-argument', 'target_snapshot_level_invalid');
}

async function sealTargetProgram(uid: string, request: AuthorityRequest, firestore: Firestore): Promise<void> {
  if (!boundedId(request.targetContentIdentity) || !plainObject(request.targetPlan)
    || !boundedId(request.targetPrescriptionIdentity) || !boundedId(request.questionnaireId)
    || !Number.isInteger(request.questionnaireVersion)
    || typeof request.targetProgramSource !== 'string'
    || !Number.isInteger(request.targetTemplateVersion)
    || typeof request.targetTemplateSourceVersion !== 'string'
    || typeof request.targetTemplateContentHash !== 'string') {
    throw new HttpsError('invalid-argument', 'target_program_seal_metadata_missing');
  }
  const reference = firestore.collection('users').doc(uid).collection('workoutPrograms').doc(request.targetContentIdentity);
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const data = existing.data()!;
      const samePlan = Object.keys(request.targetPlan!).every((key) =>
        canonical(data[key]) === canonical(request.targetPlan![key]));
      if (!samePlan || data.prescriptionId !== request.targetPrescriptionIdentity
        || data.questionnaireId !== request.questionnaireId
        || data.questionnaireVersion !== request.questionnaireVersion) {
        throw new HttpsError('permission-denied', 'target_content_identity_already_bound_to_different_plan');
      }
      return;
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(reference, {
      ...request.targetPlan,
      programId: request.targetContentIdentity,
      prescriptionId: request.targetPrescriptionIdentity,
      status: 'active',
      source: request.targetProgramSource,
      templateVersion: request.targetTemplateVersion,
      templateSourceVersion: request.targetTemplateSourceVersion,
      templateContentHash: request.targetTemplateContentHash,
      questionnaireId: request.questionnaireId,
      questionnaireVersion: request.questionnaireVersion as number,
      createdAt: now,
      activatedAt: now,
      updatedAt: now,
    });
  });
}

async function validateFinishExecution(
  uid: string,
  request: AuthorityRequest,
  firestore: Firestore,
): Promise<Record<string, unknown>> {
  if (!boundedId(request.executionId)) throw new HttpsError('invalid-argument', 'invalid_execution_id');
  const root = firestore.collection('users').doc(uid);
  const executionSnapshot = await root.collection('workoutExecutions').doc(request.executionId).get();
  const execution = executionSnapshot.data();
  if (!executionSnapshot.exists || execution?.status !== 'IN_PROGRESS'
    || !boundedId(execution?.programInstanceId)) {
    throw new HttpsError('failed-precondition', 'execution_not_finishable');
  }

  // Bind finish authority to the immutable ProgramInstance carried by this
  // execution, not to whichever program happens to be active later. An
  // adaptation/evolution racing a long workout may supersede the active
  // pointer, but it must not make already-started evidence impossible to
  // terminalize against its own prescription snapshot.
  const instanceSnapshot = await root.collection('programInstances').doc(execution.programInstanceId).get();
  const instance = instanceSnapshot.data();
  const executionProgramId = boundedId(execution.programId) ? execution.programId : instance?.contentIdentity;
  if (!boundedId(executionProgramId)) {
    throw new HttpsError('failed-precondition', 'execution_prescription_referent_missing');
  }
  const programSnapshot = await root.collection('workoutPrograms').doc(executionProgramId).get();
  const program = programSnapshot.data();
  if (!instanceSnapshot.exists || !programSnapshot.exists
    || instance?.contentIdentity !== executionProgramId) {
    throw new HttpsError('failed-precondition', 'execution_prescription_referent_missing');
  }
  const session = Number.isInteger(execution.sessionIndex) && Array.isArray(program?.sessions)
    ? program.sessions[execution.sessionIndex]
    : null;
  if (!session || prescribedExecutionCounts(execution, session, execution.programInstanceId) === null) {
    const actual = Array.isArray(execution.exercises)
      ? execution.exercises.map((record: DocumentData) => ({
        exerciseIndex: record?.exerciseIndex ?? null,
        prescribedExerciseId: record?.prescribedExerciseId ?? record?.exerciseId ?? null,
        exerciseId: record?.exerciseId ?? null,
        setCount: Array.isArray(record?.sets) ? record.sets.length : null,
      })) : null;
    const expected = Array.isArray(session?.exercises)
      ? session.exercises.map((record: DocumentData, exerciseIndex: number) => ({
        exerciseIndex,
        exerciseId: record?.exerciseId ?? null,
        setCount: Number.isInteger(record?.sets) ? record.sets : 1,
      })) : null;
    logWarn('workoutLifecycle.authorize', 'execution_does_not_match_authoritative_prescription', {
      executionId: request.executionId,
      programInstanceId: execution.programInstanceId,
      sessionIndex: execution.sessionIndex ?? null,
      expected: expected?.map((item: unknown) => canonical(item)) ?? null,
      actual: actual?.map((item: unknown) => canonical(item)) ?? null,
    });
    throw new HttpsError(
      'permission-denied',
      'execution_does_not_match_authoritative_prescription',
      { reason: 'execution_does_not_match_authoritative_prescription' },
    );
  }
  const substitution = await validateMaterializedExecutionSubstitutions(uid, execution, firestore);
  if (!substitution.valid) {
    logWarn('workoutLifecycle.authorize', 'execution_substitution_not_authoritative', {
      executionId: request.executionId,
      programInstanceId: execution.programInstanceId,
      sessionIndex: execution.sessionIndex,
      reason: substitution.reason,
      exerciseIndex: substitution.exerciseIndex,
      prescribedExerciseId: substitution.prescribedExerciseId,
      exerciseId: substitution.exerciseId,
    });
    throw new HttpsError(
      'permission-denied',
      'execution_substitution_not_authoritative',
      { reason: substitution.reason },
    );
  }
  return { sourceProgramInstanceId: execution.programInstanceId };
}

async function validateRequest(uid: string, request: AuthorityRequest, firestore: Firestore): Promise<Record<string, unknown>> {
  if (request.operation === 'INITIALIZE' || request.operation === 'MIGRATE') {
    if (!boundedId(request.targetProgramInstanceId) || !boundedId(request.targetCycleId)
      || !boundedId(request.questionnaireId) || !plainObject(request.targetPrescriptionInputSnapshot)) {
      throw new HttpsError('invalid-argument', 'missing_authority_targets');
    }
    const state = await firestore.collection('users').doc(uid).collection('workoutLifecycleState').doc('current').get();
    if (state.exists) throw new HttpsError('aborted', 'lifecycle_already_initialized');
    const target = request.targetPrescriptionInputSnapshot;
    if (!plainObject(target.inputs) || target.source !== 'QUESTIONNAIRE_BASELINE'
      || target.snapshotId !== snapshotIdFor('QUESTIONNAIRE_BASELINE', target.inputs)) {
      throw new HttpsError('permission-denied', 'initial_snapshot_not_authoritative');
    }
    const questionnaire = await firestore.collection('users').doc(uid).collection('questionnaires').doc(request.questionnaireId).get();
    const answers = questionnaire.data()?.answers;
    if (!questionnaire.exists || !plainObject(answers)) throw new HttpsError('failed-precondition', 'questionnaire_missing');
    for (const key of ['limits', 'specialConditions', 'pregnancyScreening', 'postpartumScreening', 'functionalScreening',
      'lipedemaScreening', 'dizzinessScreening', 'postSurgicalScreening', 'medicalRestrictionScreening']) {
      if (canonical(target.inputs[key]) !== canonical(answers[key])) {
        throw new HttpsError('permission-denied', 'initial_safety_inputs_do_not_match_questionnaire');
      }
    }
    const expectedEventType = 'PROGRAM_STARTED';
    const carriesEvent = request.eventId != null || request.eventType != null || request.idempotencyKey != null;
    if (carriesEvent && (!request.idempotencyKey || request.eventType !== expectedEventType
      || request.eventId !== lifecycleEventId(expectedEventType, request.idempotencyKey))) {
      throw new HttpsError('permission-denied', 'initial_event_identity_not_deterministic');
    }
    // The client's own `targetPlan`/`targetPrescriptionIdentity` are never
    // read as content authority — the backend generates the canonical plan
    // itself from the same authoritative questionnaire answers, using the
    // same deterministic engine and the same live catalogs the client uses.
    //
    // Fase 11 §3/§4 — INITIALIZE (brand-new lifecycle, nothing to preserve
    // yet) uses the central default. MIGRATE bootstraps a lifecycle from a
    // pre-lifecycle v1.3/v2.0-era baseline program — inherently a legacy
    // concept that predates v1.27's existence — and always stays v2,
    // regardless of the central default, so a migration can never itself
    // produce a v1.27 plan.
    const version: PrescriptionGenerationVersion = request.operation === 'MIGRATE'
      ? 'v2'
      : resolveAuthoritativeGenerationVersionForNewLifecycle();
    const currentTrainingLevel = levelFromSnapshot(target) as CurrentTrainingLevel;
    const { plan, templateMetadata } = await generateCanonicalPlan(
      answers as unknown as QuestionnaireAnswers, firestore, version, currentTrainingLevel,
    );
    await assertPlanSafe({ ...request, targetPlan: plan as unknown as Record<string, unknown> }, firestore);
    const activeState = await firestore.collection('users').doc(uid).collection('workoutProgramState').doc('active').get();
    const baselineContentIdentity = activeState.data()?.programId;
    const baselineProgram = request.operation === 'MIGRATE' && typeof baselineContentIdentity === 'string'
      ? await firestore.collection('users').doc(uid).collection('workoutPrograms').doc(baselineContentIdentity).get()
      : null;
    if (request.operation === 'MIGRATE' && (!baselineProgram?.exists
      || typeof baselineProgram.data()?.prescriptionId !== 'string')) {
      throw new HttpsError('failed-precondition', 'legacy_baseline_program_missing');
    }
    const targetContentIdentity = canonicalContentIdentity({
      questionnaireId: request.questionnaireId,
      questionnaireVersion: request.questionnaireVersion as number,
      plan,
      templateMetadata,
    });
    const canonicalOperationKey = request.idempotencyKey?.startsWith('activation:')
      ? request.idempotencyKey
      : `${request.operation === 'MIGRATE' ? 'v1-baseline' : 'v2-initial'}:${targetContentIdentity}`;
    return {
      targetTrainingLevel: levelFromSnapshot(request.targetPrescriptionInputSnapshot),
      targetCycleNumber: 1,
      targetPlan: plan,
      targetContentIdentity,
      targetPrescriptionIdentity: plan.planId,
      targetProgramInstanceId: `wpi_${lifecycleStableHash(canonicalOperationKey)}`,
      targetCycleId: `cyc_${lifecycleStableHash(canonicalOperationKey)}`,
      idempotencyKey: canonicalOperationKey,
      eventId: `wle_${lifecycleStableHash(`PROGRAM_STARTED:${canonicalOperationKey}`)}`,
      targetTemplateVersion: templateMetadata.version,
      targetTemplateSourceVersion: templateMetadata.sourceVersion,
      targetTemplateContentHash: templateMetadata.contentHash,
      ...(request.operation === 'MIGRATE' && typeof baselineContentIdentity === 'string'
        ? {
          baselineProgramInstanceId: `wpi_${lifecycleStableHash(`v1-baseline:${baselineContentIdentity}`)}`,
          baselineContentIdentity,
          baselinePrescriptionIdentity: baselineProgram!.data()!.prescriptionId,
        }
        : {}),
    };
  }
  if (request.operation === 'RECOVER') {
    // RECOVER is identity/state reconciliation ONLY — it must never carry
    // semantic authority over prescription content (docs/workout-lifecycle/
    // v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md). It never
    // runs the canonical engine and never seals new content. A caller that
    // needs to install NEW prescription content must use
    // INITIALIZE/MIGRATE/ADAPT/PREPARE instead, which run the canonical
    // engine and derive their own identities — there is no "safe-but-wrong"
    // content path here, so a `targetPlan` on a RECOVER request is rejected
    // outright rather than bounds-checked and passed through. Every
    // identity field returned below is independently re-derived from
    // already-authoritative persisted state — never taken from the client,
    // even when the client's own value happens to be correct.
    if (request.targetPlan != null) {
      throw new HttpsError('permission-denied', 'recover_does_not_install_content');
    }
    const root = firestore.collection('users').doc(uid);
    const stateSnapshot = await root.collection('workoutLifecycleState').doc('current').get();
    if (stateSnapshot.exists) {
      const state = stateSnapshot.data() as LifecycleState;
      if ((request.sourceProgramInstanceId && request.sourceProgramInstanceId !== state.activeProgramInstanceId)
        || (request.sourceCycleId && request.sourceCycleId !== state.currentCycleId)) {
        throw new HttpsError('aborted', 'recovery_target_changed');
      }
      const carriesTargets = request.targetProgramInstanceId != null || request.targetCycleId != null;
      if (carriesTargets && (request.targetProgramInstanceId !== state.activeProgramInstanceId
        || request.targetCycleId !== state.currentCycleId)) {
        throw new HttpsError('aborted', 'recovery_target_changed');
      }
      if (request.pendingEvolutionId) {
        const pending = await root.collection('pendingEvolutions').doc('current').get();
        if (!pending.exists || pending.data()?.pendingEvolutionId !== request.pendingEvolutionId) {
          throw new HttpsError('aborted', 'recovery_pending_changed');
        }
      }
      return {
        sourceProgramInstanceId: state.activeProgramInstanceId,
        sourceCycleId: state.currentCycleId,
        targetProgramInstanceId: state.activeProgramInstanceId,
        targetCycleId: state.currentCycleId,
        targetContentIdentity: state.activeContentIdentity,
        targetPrescriptionIdentity: state.activePrescriptionIdentity,
        targetTrainingLevel: state.currentTrainingLevel,
        targetCycleNumber: state.currentCycleNumber,
      };
    }
    const [cycles, instances] = await Promise.all([
      root.collection('trainingCycles').where('status', '==', 'ACTIVE').get(),
      root.collection('programInstances').where('supersededAt', '==', null).get(),
    ]);
    const pairs = cycles.docs.flatMap((cycle) => instances.docs
      .filter((instance) => instance.id === cycle.data().programInstanceId && instance.data().cycleId === cycle.id)
      .map((instance) => ({ cycle, instance })));
    if (pairs.length !== 1 || request.targetCycleId !== pairs[0].cycle.id
      || request.targetProgramInstanceId !== pairs[0].instance.id) {
      throw new HttpsError('failed-precondition', 'recovery_not_unambiguous');
    }
    return {
      targetProgramInstanceId: pairs[0].instance.id,
      targetCycleId: pairs[0].cycle.id,
      targetContentIdentity: pairs[0].instance.data().contentIdentity,
      targetPrescriptionIdentity: pairs[0].instance.data().prescriptionIdentity,
      targetTrainingLevel: pairs[0].cycle.data().level,
      targetCycleNumber: pairs[0].cycle.data().cycleNumber,
    };
  }
  if (request.operation === 'FINISH_EXECUTION') {
    return validateFinishExecution(uid, request, firestore);
  }
  const bundle = await activeBundle(uid, firestore);
  assertSource(request, bundle.state);
  const authoritativeBase = {
    sourceProgramInstanceId: bundle.state.activeProgramInstanceId,
    sourceCycleId: bundle.state.currentCycleId,
  };
  const persistedSnapshotId = bundle.instance.prescriptionInputSnapshot?.snapshotId
    ?? `legacy:${bundle.state.activeProgramInstanceId}`;
  if (request.sourcePrescriptionInputSnapshotId && request.sourcePrescriptionInputSnapshotId !== persistedSnapshotId) {
    throw new HttpsError('aborted', 'stale_prescription_inputs');
  }
  if (request.operation === 'EARN') {
    const authoritative = await authoritativeEarnedFact(uid, firestore, new Date());
    if (!plainObject(request.earnedFact) || canonical(request.earnedFact) !== canonical(authoritative)) {
      throw new HttpsError('permission-denied', 'forged_earned_fact');
    }
    const expectedEventType = authoritative.type === 'MOTIVATIONAL_RENEWAL'
      ? 'MOTIVATIONAL_RENEWAL_OFFERED' : 'EVOLUTION_EARNED';
    const expectedKey = `evolution:${bundle.state.activeProgramInstanceId}:${authoritative.type}`;
    if (request.eventType !== expectedEventType || request.idempotencyKey !== expectedKey
      || request.eventId !== lifecycleEventId(expectedEventType, expectedKey)) {
      throw new HttpsError('permission-denied', 'forged_earned_event_identity');
    }
    return { ...authoritativeBase, authoritativeEarnedFact: authoritative };
  }
  let contentCanonical: { plan: FinalWorkoutPlan; templateMetadata: { version: number; sourceVersion: string; contentHash: string } } | null = null;
  let preparedInputs: Record<string, unknown> | null = null;
  if (request.operation === 'PREPARE' || request.operation === 'ADAPT') {
    const expectedInputs = assertSnapshot(request, bundle);
    if (request.operation === 'ADAPT') {
      // The client's `updatedFields` are intent (which allowed fields
      // changed); the backend derives the resulting authoritative answers
      // itself (already done by `assertSnapshot`) and regenerates the
      // canonical plan from them — the client's own `targetPlan` is never
      // read as content authority (docs/workout-lifecycle/v2/decisions/
      // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md).
      //
      // Fase 11 §4 — ADAPT never changes level or library version; both are
      // read straight from the CURRENT authoritative program/lifecycle
      // state (`bundle`, server-read), never re-derived or defaulted.
      contentCanonical = await generateCanonicalPlan(
        expectedInputs as unknown as QuestionnaireAnswers,
        firestore,
        authoritativeGenerationVersionForActiveProgram(bundle.program.templateSourceVersion),
        bundle.state.currentTrainingLevel as CurrentTrainingLevel,
      );
      await assertPlanSafe({ ...request, targetPlan: contentCanonical.plan as unknown as Record<string, unknown> }, firestore);
    } else {
      // PREPARE's canonical generation depends on which evolution type was
      // actually earned (LEVEL_PROMOTION vs CYCLE_EVOLUTION/RENEWAL), which
      // isn't proven authoritative until the persisted-earned-fact check
      // below runs — deferred there instead of trusting `request.earnedFact`
      // this early.
      preparedInputs = expectedInputs;
    }
  }
  if (request.operation === 'ADAPT' && (request.targetTrainingLevel !== bundle.state.currentTrainingLevel
    || request.targetCycleNumber !== bundle.state.currentCycleNumber)) {
    throw new HttpsError('permission-denied', 'adaptation_cannot_change_cycle_semantics');
  }
  const expectedEventTypes: Partial<Record<AuthorityOperation, string[]>> = {
    DEFER: ['EVOLUTION_DEFERRED'],
    ACTIVATE: ['EVOLUTION_ACTIVATED', 'LEVEL_PROMOTED', 'MOTIVATIONAL_RENEWAL_ACTIVATED'],
    ADAPT: ['PROGRAM_ADAPTED'],
    INITIALIZE: ['PROGRAM_STARTED'],
    MIGRATE: ['PROGRAM_STARTED'],
    RECOVER: ['PROGRAM_STARTED'],
  };
  if (request.eventType && !expectedEventTypes[request.operation]?.includes(request.eventType)) {
    throw new HttpsError('permission-denied', 'event_type_not_authorized_for_operation');
  }
  if (request.eventType && request.idempotencyKey
    && request.eventId !== lifecycleEventId(request.eventType, request.idempotencyKey)) {
    throw new HttpsError('permission-denied', 'event_identity_not_deterministic');
  }
  const pendingSnapshot = await firestore.collection('users').doc(uid).collection('pendingEvolutions').doc('current').get();
  if (request.operation === 'PREPARE') {
    if (!plainObject(request.earnedFact) || typeof request.earnedFact.type !== 'string') {
      throw new HttpsError('invalid-argument', 'earned_fact_required_for_prepare');
    }
    const earnedKey = `evolution:${bundle.state.activeProgramInstanceId}:${request.earnedFact.type}`;
    const earnedType = request.earnedFact.type === 'MOTIVATIONAL_RENEWAL'
      ? 'MOTIVATIONAL_RENEWAL_OFFERED' : 'EVOLUTION_EARNED';
    const earnedEvent = await firestore.collection('users').doc(uid).collection('workoutLifecycleEvents')
      .doc(lifecycleEventId(earnedType, earnedKey)).get();
    if (!earnedEvent.exists || earnedEvent.data()?.idempotencyKey !== earnedKey
      || canonical(earnedEvent.data()?.payload) !== canonical({
        evolutionType: request.earnedFact.type,
        quality: request.earnedFact.quality,
        fromLevel: request.earnedFact.fromLevel,
        toLevel: request.earnedFact.toLevel,
        sessionsCompletedAtEarn: request.earnedFact.sessionsCompletedAtEarn,
        adherenceAtEarnBp: request.earnedFact.adherenceAtEarnBp,
      })) {
      throw new HttpsError('permission-denied', 'prepare_requires_persisted_earned_fact');
    }
    // Only now is `request.earnedFact.type` proven authoritative — safe to
    // pick and run the corresponding canonical generation path. The
    // client's own `targetPlan` is never read as content authority.
    //
    // Fase 11 §4 — LEVEL_PROMOTION changes the training LEVEL, never the
    // template LIBRARY VERSION: the promoted plan stays on the SAME
    // library the current program already uses (`bundle.program.
    // templateSourceVersion`, authoritative) — a v1.27 BEGINNER promoted to
    // INTERMEDIATE gets a v1.27 regular-family plan, never a v2 one.
    // CYCLE_EVOLUTION/MOTIVATIONAL_RENEWAL (`generateCanonicalCycleEvolution`)
    // never re-selects a template or recomputes `versions` at all — it
    // already reuses `bundle.program.versions`/`templateVersion`/
    // `templateSourceVersion`/`templateContentHash` verbatim, so it
    // preserves the active program's version by construction, with no
    // change needed here.
    contentCanonical = request.earnedFact.type === 'LEVEL_PROMOTION'
      ? await generateCanonicalPlan(
          preparedInputs as unknown as QuestionnaireAnswers,
          firestore,
          authoritativeGenerationVersionForActiveProgram(bundle.program.templateSourceVersion),
          request.earnedFact.toLevel as CurrentTrainingLevel,
        )
      : await generateCanonicalCycleEvolution(uid, preparedInputs as unknown as QuestionnaireAnswers, bundle, firestore);
    await assertPlanSafe({ ...request, targetPlan: contentCanonical.plan as unknown as Record<string, unknown> }, firestore);
  }
  if (request.operation === 'DEFER' || request.operation === 'ACTIVATE') {
    if (!pendingSnapshot.exists || pendingSnapshot.data()?.pendingEvolutionId !== request.pendingEvolutionId) {
      throw new HttpsError('aborted', 'stale_pending_evolution');
    }
  }
  if (request.operation === 'ACTIVATE') {
    const pending = pendingSnapshot.data()!;
    const expectedEventType = pending.type === 'LEVEL_PROMOTION' ? 'LEVEL_PROMOTED'
      : pending.type === 'MOTIVATIONAL_RENEWAL' ? 'MOTIVATIONAL_RENEWAL_ACTIVATED' : 'EVOLUTION_ACTIVATED';
    // Diagnostic only: each entry mirrors one clause of the OR-chain below so
    // a `permission-denied` can be attributed to the exact clause that
    // tripped it. Never fold this into the throw condition itself — the
    // authorization result must stay byte-for-byte identical to the single
    // combined boolean.
    const activationMismatches: Array<[string, boolean]> = [
      ['targetProgramInstanceId', request.targetProgramInstanceId !== pending.targetProgramInstanceId],
      ['targetContentIdentity', request.targetContentIdentity !== pending.targetContentIdentity],
      ['targetPrescriptionIdentity', request.targetPrescriptionIdentity !== pending.targetPrescriptionIdentity],
      ['targetPlan', canonical(request.targetPlan) !== canonical(pending.plan)],
      ['targetPrescriptionInputSnapshot',
        canonical(request.targetPrescriptionInputSnapshot) !== canonical(pending.targetPrescriptionInputSnapshot)],
      ['eventType', request.eventType !== expectedEventType],
    ];
    if (activationMismatches.some(([, mismatched]) => mismatched)) {
      logWarn('workoutLifecycle.authorize', 'activation_does_not_match_authoritative_pending', {
        mismatchFields: activationMismatches.filter(([, mismatched]) => mismatched).map(([field]) => field).join(','),
        requestTargetProgramInstanceIdHash: stableHash(request.targetProgramInstanceId ?? null),
        pendingTargetProgramInstanceIdHash: stableHash(pending.targetProgramInstanceId ?? null),
        requestTargetContentIdentityHash: stableHash(request.targetContentIdentity ?? null),
        pendingTargetContentIdentityHash: stableHash(pending.targetContentIdentity ?? null),
        requestTargetPrescriptionIdentityHash: stableHash(request.targetPrescriptionIdentity ?? null),
        pendingTargetPrescriptionIdentityHash: stableHash(pending.targetPrescriptionIdentity ?? null),
        requestTargetPlanFingerprint: stableHash(request.targetPlan ?? null),
        pendingTargetPlanFingerprint: stableHash(pending.plan ?? null),
        requestPrescriptionInputSnapshotFingerprint: stableHash(request.targetPrescriptionInputSnapshot ?? null),
        pendingPrescriptionInputSnapshotFingerprint: stableHash(pending.targetPrescriptionInputSnapshot ?? null),
        requestEventType: request.eventType ?? null,
        expectedEventType,
      });
      throw new HttpsError('permission-denied', 'activation_does_not_match_authoritative_pending');
    }
    const expectedLevel = pending.toLevel;
    const expectedCycleNumber = pending.type === 'LEVEL_PROMOTION'
      ? 1
      : pending.type === 'CYCLE_EVOLUTION'
        ? bundle.state.currentCycleNumber + 1
        : bundle.state.currentCycleNumber;
    if (request.targetTrainingLevel !== expectedLevel || request.targetCycleNumber !== expectedCycleNumber) {
      logWarn('workoutLifecycle.authorize', 'activation_cycle_semantics_not_authoritative', {
        mismatchFields: [
          request.targetTrainingLevel !== expectedLevel ? 'targetTrainingLevel' : null,
          request.targetCycleNumber !== expectedCycleNumber ? 'targetCycleNumber' : null,
        ].filter((field): field is string => field !== null).join(','),
        requestTargetTrainingLevel: request.targetTrainingLevel ?? null,
        expectedTrainingLevel: expectedLevel ?? null,
        requestTargetCycleNumber: request.targetCycleNumber ?? null,
        expectedCycleNumber: expectedCycleNumber ?? null,
      });
      throw new HttpsError('permission-denied', 'activation_cycle_semantics_not_authoritative');
    }
    await assertPlanSafe(request, firestore);
  }
  let scheduleAuthorityFields: Record<string, unknown> = {};
  if (request.operation === 'COMPLETE_SCHEDULE') {
    if (request.sessionIndex == null || !request.scheduledLocalDate) throw new HttpsError('invalid-argument', 'invalid_schedule_completion');
    const context = await loadScheduleAuthorityContext(uid, bundle, firestore);
    if (context.sessionCount <= 0
      || ((context.config.scheduleMode ?? 'fixed') === 'fixed' && context.config.trainingDays.length === 0)) {
      throw new HttpsError('failed-precondition', 'schedule_not_configured');
    }
    assertNotBackdated(request.scheduledLocalDate, context.config.timezone, new Date());
    // The schedule — not the execution — decides which session was expected
    // (docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md
    // §Scheduled Opportunity Integrity). Re-derived from the authoritative,
    // grant-protected rotation cursor via the exact same resolver the client
    // uses — never from `request.sessionIndex` alone, and never from
    // whatever the execution itself claims.
    const resolution = resolveWorkoutSchedule({
      hasActiveProgram: true,
      sessionCount: context.sessionCount,
      scheduleMode: context.config.scheduleMode ?? 'fixed',
      config: context.config,
      state: context.state,
      activatedAtLocalDate: context.activatedAtLocalDate,
      todayLocalDate: request.scheduledLocalDate,
    });
    if (resolution.status !== 'SESSION_READY' || resolution.sessionIndex !== request.sessionIndex) {
      throw new HttpsError('permission-denied', 'schedule_completion_session_not_expected');
    }
    const executions = await firestore.collection('users').doc(uid).collection('workoutExecutions')
      .where('programInstanceId', '==', bundle.state.activeProgramInstanceId).get();
    const matching = executions.docs.some((item) => item.data().sessionIndex === request.sessionIndex
      && item.data().scheduledLocalDate === request.scheduledLocalDate
      && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(item.data().status));
    if (!matching) throw new HttpsError('failed-precondition', 'schedule_completion_requires_finished_execution');
    scheduleAuthorityFields = {
      targetNextSessionIndex: (request.sessionIndex + 1) % context.sessionCount,
      targetCursorDate: request.scheduledLocalDate,
    };
  }
  if (request.operation === 'RESOLVE_MISSED_SESSION') {
    if (request.decision !== 'CONTINUE_SEQUENCE' && request.decision !== 'FOLLOW_SCHEDULE') {
      throw new HttpsError('invalid-argument', 'invalid_miss_resolution_decision');
    }
    if (!request.scheduledLocalDate) throw new HttpsError('invalid-argument', 'invalid_miss_resolution_date');
    if (
      !Number.isInteger(request.expectedMissedSessionIndex)
      || !Number.isInteger(request.expectedCalendarSessionIndex)
      || typeof request.expectedMissedScheduledDate !== 'string'
    ) {
      throw new HttpsError('invalid-argument', 'missing_missed_session_decision_identity');
    }
    const context = await loadScheduleAuthorityContext(uid, bundle, firestore);
    if ((context.config.scheduleMode ?? 'fixed') === 'flexible') {
      throw new HttpsError('failed-precondition', 'missed_session_not_applicable');
    }
    if (context.sessionCount <= 0 || context.config.trainingDays.length === 0) {
      throw new HttpsError('failed-precondition', 'schedule_not_configured');
    }
    assertNotBackdated(request.scheduledLocalDate, context.config.timezone, new Date());
    // Never trust the stored `pendingMissDecision` payload's own values —
    // recompute the real gap independently from the authoritative cursor so
    // a forged pending-decision document can't smuggle a favorable target.
    const gap = detectMissedSessionGap({
      hasActiveProgram: true,
      sessionCount: context.sessionCount,
      config: context.config,
      state: context.state ? { ...context.state, pendingMissDecision: null } : null,
      activatedAtLocalDate: context.activatedAtLocalDate,
      todayLocalDate: request.scheduledLocalDate,
    });
    if (!gap) throw new HttpsError('failed-precondition', 'no_pending_missed_session_decision');
    if (
      gap.missedSessionIndex !== request.expectedMissedSessionIndex
      || gap.calendarSessionIndex !== request.expectedCalendarSessionIndex
      || gap.missedScheduledDate !== request.expectedMissedScheduledDate
    ) {
      throw new HttpsError('aborted', 'stale_missed_session_decision');
    }
    const targetScheduleEvents: Array<{ type: string; sessionIndex: number; scheduledDate: string }> = [
      { type: 'MISS_RESOLVED', sessionIndex: gap.missedSessionIndex, scheduledDate: gap.missedScheduledDate },
    ];
    let targetNextSessionIndex = gap.missedSessionIndex;
    let targetCursorDate = context.state?.cursorDate ?? context.activatedAtLocalDate;
    if (request.decision === 'FOLLOW_SCHEDULE') {
      let index = gap.missedSessionIndex;
      while (index !== gap.calendarSessionIndex) {
        targetScheduleEvents.push({ type: 'SKIPPED', sessionIndex: index, scheduledDate: request.scheduledLocalDate });
        index = (index + 1) % context.sessionCount;
      }
      targetNextSessionIndex = gap.calendarSessionIndex;
      targetCursorDate = addDays(request.scheduledLocalDate, -1);
    }
    scheduleAuthorityFields = { targetNextSessionIndex, targetCursorDate, targetScheduleEvents };
  }
  const canonicalTargetContentIdentity = contentCanonical
    ? canonicalContentIdentity({
      questionnaireId: String(bundle.program.questionnaireId),
      questionnaireVersion: Number(bundle.program.questionnaireVersion),
      plan: contentCanonical.plan,
      templateMetadata: contentCanonical.templateMetadata,
    })
    : null;
  const canonicalAdaptOperationKey = request.operation === 'ADAPT'
    && canonicalTargetContentIdentity
    && !request.idempotencyKey?.startsWith('activation:')
    ? `content:${bundle.state.activeProgramInstanceId}:${canonicalTargetContentIdentity}`
    : request.idempotencyKey;
  return {
    ...authoritativeBase,
    ...scheduleAuthorityFields,
    ...(request.operation === 'ADAPT' || request.operation === 'ACTIVATE'
      ? {
        targetTrainingLevel: request.targetTrainingLevel,
        targetCycleNumber: request.targetCycleNumber,
      }
      : {}),
    ...(contentCanonical
      ? {
        targetPlan: contentCanonical.plan,
        targetContentIdentity: canonicalTargetContentIdentity,
        targetPrescriptionIdentity: contentCanonical.plan.planId,
        targetTemplateVersion: contentCanonical.templateMetadata.version,
        targetTemplateSourceVersion: contentCanonical.templateMetadata.sourceVersion,
        targetTemplateContentHash: contentCanonical.templateMetadata.contentHash,
      }
      : {}),
    ...(request.operation === 'ADAPT' && canonicalAdaptOperationKey
      ? {
        targetProgramInstanceId: `wpi_${lifecycleStableHash(canonicalAdaptOperationKey)}`,
        targetCycleId: bundle.state.currentCycleId,
        idempotencyKey: canonicalAdaptOperationKey,
        eventId: `wle_${lifecycleStableHash(`PROGRAM_ADAPTED:${canonicalAdaptOperationKey}`)}`,
      }
      : {}),
  };
}

export interface AuthorityCanonicalContent {
  targetPlan: FinalWorkoutPlan;
  targetContentIdentity: string;
  targetPrescriptionIdentity: string;
  targetTemplateVersion: number;
  targetTemplateSourceVersion: string;
  targetTemplateContentHash: string;
}

/**
 * Fase 16 (ADAPT/ACTIVATE v1.27 cutover) — the ADAPT/ACTIVATE counterpart to
 * `initializeWorkoutProgramV127Handler`'s INITIALIZE fix. Both operations
 * already sealed `workoutPrograms/{contentIdentity}` via Admin SDK
 * (`sealTargetProgram`, called just above in the handler) BEFORE this
 * function existed — the remaining gap was the CLIENT's own subsequent
 * `saveAndActivateWorkoutProgram` transaction, which still wrote
 * `programInstances`/`trainingCycles`/`workoutLifecycleState`/
 * `workoutLifecycleEvents`/`workoutProgramState` (and re-validated the now-
 * sealed `workoutPrograms` doc via `allow update`) through client-side
 * Firestore Rules — the exact same per-request expression ceiling that
 * broke INITIALIZE for a real v1.27 document. This performs that same
 * "existing lifecycle, install new active content" transition entirely via
 * Admin SDK, mirroring `saveAndActivateWorkoutProgram`'s own
 * `shouldCreateInstance` branch (`src/services/workoutPrograms.ts`) field
 * for field — ONLY for v1.27 target content; v2 is completely untouched
 * (still grant + client transaction, exactly as before).
 *
 * Every field this reads off `merged` was ALREADY the authoritative value
 * the client-side transaction would have used (validated by `validateRequest`
 * above for ADAPT, or cross-checked byte-for-byte against the sealed
 * `pendingEvolutions/current` document for ACTIVATE) — nothing here
 * re-derives or loosens any check; it only moves WHO performs the write.
 */
async function persistLifecycleActivationV127(
  uid: string,
  firestore: Firestore,
  merged: AuthorityRequest,
  pendingData: DocumentData | null,
): Promise<void> {
  const userRoot = firestore.collection('users').doc(uid);
  const targetProgramInstanceId = merged.targetProgramInstanceId as string;
  const targetCycleId = merged.targetCycleId as string;
  const targetContentIdentity = merged.targetContentIdentity as string;
  const targetPrescriptionIdentity = merged.targetPrescriptionIdentity as string;
  const sourceProgramInstanceId = merged.sourceProgramInstanceId as string;
  const sourceCycleId = merged.sourceCycleId as string;
  const prescriptionInputSnapshot = merged.targetPrescriptionInputSnapshot;
  // True exactly when the client requested a `nextCycle` (ADAPT never does —
  // "adaptation never starts a new TrainingCycle", `workoutLifecycleApplication.ts`'s
  // own comment; ACTIVATE does for LEVEL_PROMOTION/CYCLE_EVOLUTION, not for
  // MOTIVATIONAL_RENEWAL) — mirrors `saveAndActivateWorkoutProgram`'s own
  // `cycleId: input.nextCycle ? cycleIdForOperation(...) : currentCycleId`
  // derivation exactly, just read back from the already-computed target
  // instead of re-deciding it.
  const isNewCycle = targetCycleId !== sourceCycleId;
  const eventType = merged.eventType as string;
  const eventId = merged.eventId as string;
  // Byte-for-byte the same ternary `saveAndActivateWorkoutProgram` already
  // uses for `activationReason` (src/services/workoutPrograms.ts) — not a
  // new policy decision, just relocated.
  const activationReason = isNewCycle
    ? 'EVOLUTION_ACTIVATION'
    : merged.targetProgramSource === 'program_adaptation'
      ? 'PROGRAM_ADAPTATION'
      : merged.targetProgramSource === 'automatic_progression'
        ? 'V1_AUTOMATIC_PROGRESSION'
        : merged.targetProgramSource === 'manual_regeneration'
          ? 'MANUAL_REGENERATION'
          : 'AUTOMATIC_RECONCILIATION';
  const progressionReason = pendingData?.type === 'LEVEL_PROMOTION'
    ? 'EARNED_LEVEL_PROMOTION'
    : pendingData?.type === 'CYCLE_EVOLUTION'
      ? 'EARNED_CYCLE_EVOLUTION'
      : 'EARNED_EVOLUTION';

  const lifecycleRef = userRoot.collection('workoutLifecycleState').doc('current');
  const instanceRef = userRoot.collection('programInstances').doc(targetProgramInstanceId);
  const cycleRef = userRoot.collection('trainingCycles').doc(targetCycleId);
  const eventRef = userRoot.collection('workoutLifecycleEvents').doc(eventId);
  const stateRef = userRoot.collection('workoutProgramState').doc('active');
  const currentInstanceRef = userRoot.collection('programInstances').doc(sourceProgramInstanceId);
  const currentCycleRef = userRoot.collection('trainingCycles').doc(sourceCycleId);
  const pendingRef = userRoot.collection('pendingEvolutions').doc('current');

  await firestore.runTransaction(async (transaction) => {
    const [lifecycleSnapshot, instanceSnapshot] = await Promise.all([
      transaction.get(lifecycleRef), transaction.get(instanceRef),
    ]);
    if (instanceSnapshot.exists) {
      // Idempotent retry (double tap / redelivered call) — this exact
      // transition was already persisted; no second write.
      return;
    }
    const lifecycleData = lifecycleSnapshot.data();
    if (!lifecycleData || lifecycleData.activeProgramInstanceId !== sourceProgramInstanceId) {
      throw new HttpsError('aborted', 'workout_lifecycle_v127_transition_source_changed');
    }
    const now = FieldValue.serverTimestamp();
    // Mirrors `saveAndActivateWorkoutProgram`'s own `status: 'superseded'`
    // write on the previously-active `workoutPrograms` doc — Admin SDK, so
    // (unlike the client's own equivalent write) this is never subject to
    // Firestore Rules' per-request expression ceiling regardless of that
    // document's real size.
    if (typeof lifecycleData.activeContentIdentity === 'string' && lifecycleData.activeContentIdentity !== targetContentIdentity) {
      transaction.update(userRoot.collection('workoutPrograms').doc(lifecycleData.activeContentIdentity), {
        status: 'superseded', updatedAt: now,
      });
    }
    transaction.update(currentInstanceRef, { supersededAt: now, updatedAt: now });
    transaction.set(instanceRef, {
      programInstanceId: targetProgramInstanceId,
      cycleId: targetCycleId,
      contentIdentity: targetContentIdentity,
      prescriptionIdentity: targetPrescriptionIdentity,
      questionnaireId: merged.questionnaireId,
      prescriptionInputSnapshot,
      activatedAt: now,
      supersededAt: null,
      previousProgramInstanceId: sourceProgramInstanceId,
      activationReason,
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    if (isNewCycle) {
      transaction.update(currentCycleRef, { status: 'COMPLETED', completedAt: now, updatedAt: now });
      transaction.set(cycleRef, {
        cycleId: targetCycleId,
        level: merged.targetTrainingLevel,
        cycleNumber: merged.targetCycleNumber,
        status: 'ACTIVE',
        origin: 'V2_NATIVE',
        programInstanceId: targetProgramInstanceId,
        previousProgramInstanceId: sourceProgramInstanceId,
        startedAt: now,
        eligibleAt: null,
        completedAt: null,
        completionReason: null,
        progressionReason,
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      transaction.update(currentCycleRef, {
        programInstanceId: targetProgramInstanceId,
        previousProgramInstanceId: sourceProgramInstanceId,
        updatedAt: now,
      });
    }
    transaction.set(eventRef, {
      eventId,
      type: eventType,
      occurredAt: now,
      cycleId: targetCycleId,
      programInstanceId: targetProgramInstanceId,
      idempotencyKey: merged.idempotencyKey,
      payload: {
        source: merged.targetProgramSource ?? null,
        ...(pendingData?.type ? { evolutionType: pendingData.type } : {}),
      },
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
    });
    transaction.set(stateRef, {
      programId: targetContentIdentity, programInstanceId: targetProgramInstanceId, updatedAt: now,
    });
    transaction.update(lifecycleRef, {
      activeProgramInstanceId: targetProgramInstanceId,
      activeContentIdentity: targetContentIdentity,
      activePrescriptionIdentity: targetPrescriptionIdentity,
      ...(isNewCycle
        ? {
          currentCycleId: targetCycleId,
          currentCycleNumber: merged.targetCycleNumber,
          currentTrainingLevel: merged.targetTrainingLevel,
        }
        : {}),
      updatedAt: now,
    });
    if (merged.operation === 'ACTIVATE') {
      transaction.delete(pendingRef);
    }
  });
}

export async function authorizeWorkoutLifecycleMutationHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<{
  grantId?: typeof WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID;
  expiresAtMs?: number;
  /**
   * Present whenever the backend computed the canonical prescription itself
   * (INITIALIZE/MIGRATE/ADAPT/PREPARE — docs/workout-lifecycle/v2/decisions/
   * ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md). In the common case this
   * is identical to whatever the client itself computed (same deterministic
   * engine, same catalogs), but it is still the sole persistence source for
   * callers that install newly generated content. It diverges from the live
   * exercise/template catalog changes between the client's read and this
   * call.
   */
  canonical?: AuthorityCanonicalContent;
  /**
   * Fase 16 — present exclusively for v1.27 ADAPT/ACTIVATE: the entire
   * lifecycle transition (see `persistLifecycleActivationV127` above) has
   * already been persisted via Admin SDK. No grant is issued in this case —
   * there is nothing left for the client to consume; `saveAndActivateWorkoutProgram`
   * (`src/services/workoutPrograms.ts`) checks this field and, when present,
   * skips its own Firestore transaction entirely and just re-reads the
   * result.
   */
  persisted?: { programId: string; programInstanceId: string };
}> {
  const uid = requireAuth(request);
  const data = parseRequest(request.data);
  // Phase 10E circuit breaker (docs/workout-lifecycle/v2/architecture/
  // 26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md §50): evaluated before any
  // validation/canonical-generation work, backend-enforced, unconditional —
  // an old or modified client cannot opt out of this check by not asking
  // for it. See `circuitBreaker.ts` for the operation-by-operation
  // justification of what stays allowed even while open.
  const circuitBreakerConfig = await loadWorkoutLifecycleCircuitBreakerConfig(firestore);
  if (isOperationBlockedByCircuitBreaker(data.operation, circuitBreakerConfig)) {
    throw new HttpsError('unavailable', 'workout_lifecycle_circuit_breaker_open');
  }
  const validated = await validateRequest(uid, data, firestore);
  // `validated` carries the backend-computed canonical plan/identity for
  // INITIALIZE/MIGRATE/ADAPT/PREPARE (docs/workout-lifecycle/v2/decisions/
  // ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md) — it must win over
  // whatever the client sent in `data`, both for sealing and for the grant.
  const merged = { ...data, ...validated } as AuthorityRequest;
  // Sealing is unconditional for every operation that installs prescription
  // content — never opt-out-able via an omitted client field. A caller that
  // used to skip this by not sending `targetProgramSource` now fails inside
  // `sealTargetProgram` itself (missing seal metadata) instead of silently
  // bypassing the safety check.
  if (['INITIALIZE', 'MIGRATE', 'ACTIVATE', 'ADAPT'].includes(data.operation)) {
    await sealTargetProgram(uid, merged, firestore);
  }
  // Fase 16 — v1.27 ADAPT/ACTIVATE: perform the FULL lifecycle transition
  // server-side (see `persistLifecycleActivationV127`'s own doc comment)
  // instead of issuing a grant for the client to consume. v2 (and MIGRATE/
  // RECOVER/PREPARE/DEFER/EARN/etc., all versions) are entirely unaffected —
  // this branch is only ever reached for ADAPT/ACTIVATE with v1.27 target
  // content.
  if (data.operation === 'ADAPT' || data.operation === 'ACTIVATE') {
    const targetVersions = plainObject(merged.targetPlan) ? merged.targetPlan.versions : null;
    if (plainObject(targetVersions) && targetVersions.templateLibrary === '1.27.0') {
      const pendingData = data.operation === 'ACTIVATE'
        ? (await firestore.collection('users').doc(uid).collection('pendingEvolutions').doc('current').get()).data() ?? null
        : null;
      await persistLifecycleActivationV127(uid, firestore, merged, pendingData);
      return {
        persisted: {
          programId: merged.targetContentIdentity as string,
          programInstanceId: merged.targetProgramInstanceId as string,
        },
      };
    }
  }
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 60_000);
  const grant: Record<string, unknown> = {
    ...merged,
    uid,
    requestHash: stableHash(data),
    issuedAt: now,
    expiresAt,
    schemaVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  };
  await firestore.collection('users').doc(uid).collection('workoutLifecycleAuthorityGrants')
    .doc(WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID).set(grant);
  const canonicalContent: AuthorityCanonicalContent | undefined = plainObject(validated.targetPlan)
    ? {
      targetPlan: validated.targetPlan as unknown as FinalWorkoutPlan,
      targetContentIdentity: validated.targetContentIdentity as string,
      targetPrescriptionIdentity: validated.targetPrescriptionIdentity as string,
      targetTemplateVersion: validated.targetTemplateVersion as number,
      targetTemplateSourceVersion: validated.targetTemplateSourceVersion as string,
      targetTemplateContentHash: validated.targetTemplateContentHash as string,
    }
    : undefined;
  return {
    grantId: WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
    expiresAtMs: expiresAt.toMillis(),
    ...(canonicalContent ? { canonical: canonicalContent } : {}),
  };
}

/**
 * Fase 15 (v1.27 INITIALIZE cutover) — the ONE-CALL, fully backend-persisted
 * alternative to `authorizeWorkoutLifecycleMutationHandler`'s
 * grant-then-client-writes pattern, for exactly one case: a brand-new
 * account's very first v1.27 program. `firestore-tests/
 * workoutPrograms.rules.test.ts`'s Fase 14 investigation proved that a real
 * v1.27 document (many sessions + a full decision trace) makes
 * `workoutProgramCommonValid`'s Firestore Rules evaluation exceed the
 * platform's per-request expression ceiling — no amount of Rules-side
 * restructuring fixes this, because the cost is proportional to the
 * document's own size, not to which validations run. The fix is
 * architectural, not a Rules tweak: for this one case, the client never
 * writes `workoutPrograms` (or any of the other lifecycle-bootstrap
 * documents) directly at all — this callable does, via the Admin SDK, which
 * is not subject to Security Rules or their expression budget.
 *
 * Reuses, never re-implements:
 *   - `generateCanonicalPlan`/`generateAuthoritativePlan` (the SAME engine
 *     call `validateRequest`'s INITIALIZE branch and every other lifecycle
 *     operation already use — no second engine, no v1.27-specific
 *     generation logic exists anywhere but there).
 *   - `assertPlanSafe` (the SAME fail-closed exercise/limitation-profile
 *     check every other content-installing operation already runs).
 *   - `sealTargetProgram` (the SAME idempotent Admin-SDK
 *     `workoutPrograms/{contentIdentity}` writer INITIALIZE/MIGRATE/ACTIVATE/
 *     ADAPT already use today, just reached one step earlier — it no longer
 *     needs a grant in between).
 *   - `canonicalContentIdentity`/`lifecycleStableHash`/`lifecycleEventId` —
 *     the exact same deterministic-id scheme the client's own
 *     `contentIdentityFor`/`programInstanceIdForOperation` mirror, so a
 *     program created here is byte-identical in identity to one the legacy
 *     client-transaction path would have produced for the same inputs.
 *
 * Does NOT reuse `validateRequest`'s INITIALIZE branch directly — that
 * branch throws immediately when `workoutLifecycleState/current` already
 * exists (correct for the grant flow, where the client's own transaction
 * provides retry/idempotency handling afterward). This callable has no such
 * follow-up transaction, so it performs its OWN idempotency comparison
 * instead of an unconditional early throw — see the retry handling below.
 *
 * Scope, deliberately narrow: ONLY the true first-ever INITIALIZE case
 * (no existing `workoutLifecycleState/current`, no existing
 * `workoutProgramState/active`) is handled end-to-end here. Any other
 * shape — an existing V1 baseline needing MIGRATE, an existing V2/v1.27
 * lifecycle needing ADAPT/PREPARE/RECOVER, or the active generation version
 * resolving to v2 instead of v1.27 — throws `workout_lifecycle_v127_
 * initialize_not_applicable`, a deliberately distinguishable error the
 * client (`src/services/workoutPrograms.ts`'s `tryInitializeWorkoutProgramV127`)
 * catches and falls back to the existing, unmodified, unaffected
 * grant-based flow for. v2's INITIALIZE, and every non-INITIALIZE
 * operation for both versions, are completely untouched by this function.
 */
const INITIALIZE_V127_SOURCES = [
  'onboarding', 'manual_regeneration', 'automatic_progression',
  'automatic_reconciliation', 'evolution_activation', 'program_adaptation',
] as const;

export async function initializeWorkoutProgramV127Handler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<{
  status: 'SUCCESS';
  programId: string;
  programInstanceId: string;
}> {
  const uid = requireAuth(request);
  const data = request.data;
  // `source` is optional and defaults to 'onboarding'. Validated against the
  // exact same `WorkoutProgramSource` enum `saveAndActivateWorkoutProgram`/
  // `isProgramSnapshot` already accept — this is purely an audit/analytics
  // label written onto the sealed `workoutPrograms` doc and the
  // `PROGRAM_STARTED` event's payload, never read by any authorization
  // decision, so accepting the same bounded set every other write path
  // already accepts is not a new trust surface. `saveAndActivateWorkoutProgram`'s
  // own operation resolution (never `source`-gated) is what decides whether
  // a call is genuinely a first-ever INITIALIZE in the first place — this
  // callable only needs the label to be well-formed.
  if (!plainObject(data) || !boundedId(data.questionnaireId) || !Number.isInteger(data.questionnaireVersion)
    || (data.source !== undefined
      && !INITIALIZE_V127_SOURCES.includes(data.source as typeof INITIALIZE_V127_SOURCES[number]))) {
    throw new HttpsError('invalid-argument', 'invalid_initialize_v127_request');
  }
  const questionnaireId = data.questionnaireId;
  const questionnaireVersion = data.questionnaireVersion as number;
  const source = (data.source as typeof INITIALIZE_V127_SOURCES[number] | undefined) ?? 'onboarding';

  const circuitBreakerConfig = await loadWorkoutLifecycleCircuitBreakerConfig(firestore);
  if (isOperationBlockedByCircuitBreaker('INITIALIZE', circuitBreakerConfig)) {
    throw new HttpsError('unavailable', 'workout_lifecycle_circuit_breaker_open');
  }

  // Central default resolves the generation version the exact same way
  // `validateRequest`'s own INITIALIZE branch does for a brand-new
  // lifecycle — never anything the client requests. If it is not v1.27
  // (e.g. the rollout default has been flipped back), this endpoint simply
  // does not apply; the caller falls back to the existing v2-capable flow.
  if (resolveAuthoritativeGenerationVersionForNewLifecycle() !== 'v1.27') {
    throw new HttpsError('failed-precondition', 'workout_lifecycle_v127_initialize_not_applicable');
  }

  const userRoot = firestore.collection('users').doc(uid);
  const questionnaireSnapshot = await userRoot.collection('questionnaires').doc(questionnaireId).get();
  const answers = questionnaireSnapshot.data()?.answers;
  if (!questionnaireSnapshot.exists || !plainObject(answers) || questionnaireSnapshot.data()?.version !== questionnaireVersion) {
    throw new HttpsError('failed-precondition', 'questionnaire_missing');
  }
  const rawLevel = answers.level;
  const currentTrainingLevel: CurrentTrainingLevel =
    rawLevel === 'never_or_starting' || rawLevel === 'beginner' || rawLevel === 'beg' ? 'BEGINNER'
      : rawLevel === 'intermediate' || rawLevel === 'int' ? 'INTERMEDIATE'
        : rawLevel === 'advanced' || rawLevel === 'adv' || rawLevel === 'elite' ? 'ADVANCED'
          : (() => { throw new HttpsError('failed-precondition', 'starting_level_unknown'); })();

  // Same Admin-SDK-write-safe `undefined`-stripping `generateAuthoritativePlan`
  // already applies to the plan itself (its own doc comment) — built
  // in-memory here (never round-tripped through JSON-over-the-wire like the
  // legacy client-supplied snapshot was), so an absent optional answer
  // (e.g. `primaryPlace`) surfaces as a literal `undefined`, which the
  // Admin SDK rejects outright on write.
  const prescriptionInputSnapshot = JSON.parse(JSON.stringify(buildPrescriptionInputSnapshot({
    answers: answers as unknown as Parameters<typeof buildPrescriptionInputSnapshot>[0]['answers'],
    currentTrainingLevel,
    source: 'QUESTIONNAIRE_BASELINE',
  }))) as ReturnType<typeof buildPrescriptionInputSnapshot>;

  const { plan, templateMetadata } = await generateCanonicalPlan(
    answers as unknown as QuestionnaireAnswers, firestore, 'v1.27', currentTrainingLevel,
  );
  const authorityRequestForSafety = {
    operation: 'INITIALIZE',
    targetPlan: plan as unknown as Record<string, unknown>,
    targetPrescriptionInputSnapshot: prescriptionInputSnapshot as unknown as Record<string, unknown>,
  } as AuthorityRequest;
  await assertPlanSafe(authorityRequestForSafety, firestore);

  const targetContentIdentity = canonicalContentIdentity({
    questionnaireId, questionnaireVersion, plan, templateMetadata,
  });
  const canonicalOperationKey = `v2-initial:${targetContentIdentity}`;
  const targetProgramInstanceId = `wpi_${lifecycleStableHash(canonicalOperationKey)}`;
  const targetCycleId = `cyc_${lifecycleStableHash(canonicalOperationKey)}`;
  const eventId = lifecycleEventId('PROGRAM_STARTED', canonicalOperationKey);

  const lifecycleRef = userRoot.collection('workoutLifecycleState').doc('current');
  const legacyStateRef = userRoot.collection('workoutProgramState').doc('active');
  const [lifecycleSnapshot, legacyStateSnapshot] = await Promise.all([
    lifecycleRef.get(), legacyStateRef.get(),
  ]);
  if (lifecycleSnapshot.exists) {
    const lifecycleData = lifecycleSnapshot.data()!;
    if (lifecycleData.activeContentIdentity === targetContentIdentity
      && lifecycleData.activeProgramInstanceId === targetProgramInstanceId) {
      // Idempotent retry (double tap / client timeout that actually
      // succeeded / re-delivered call): the exact same deterministic
      // content this call would produce is already the active program —
      // report success without writing anything a second time.
      return { status: 'SUCCESS', programId: targetContentIdentity, programInstanceId: targetProgramInstanceId };
    }
    // A DIFFERENT program is already active for this lifecycle — this is
    // not a genuine first INITIALIZE (most likely ADAPT/PREPARE/RECOVER
    // territory instead). Not an error the user needs to see: the caller
    // falls back to the existing grant-based flow, which already knows how
    // to handle every one of those cases correctly.
    throw new HttpsError('failed-precondition', 'workout_lifecycle_v127_initialize_not_applicable');
  }
  if (legacyStateSnapshot.exists) {
    // Pre-lifecycle V1 pointer present with no V2/v1.27 lifecycle yet — a
    // MIGRATE, which always stays v2 regardless of the central default
    // (see `resolveAuthoritativeGenerationVersionForNewLifecycle`'s own
    // doc comment). Not this endpoint's concern; fall back.
    throw new HttpsError('failed-precondition', 'workout_lifecycle_v127_initialize_not_applicable');
  }

  // Same idempotent Admin-SDK writer INITIALIZE/MIGRATE/ACTIVATE/ADAPT
  // already use via `authorizeWorkoutLifecycleMutationHandler` — reached
  // one step earlier here, with no grant in between.
  await sealTargetProgram(uid, {
    targetContentIdentity,
    targetPlan: plan as unknown as Record<string, unknown>,
    targetPrescriptionIdentity: plan.planId,
    questionnaireId,
    questionnaireVersion,
    targetProgramSource: source,
    targetTemplateVersion: templateMetadata.version,
    targetTemplateSourceVersion: templateMetadata.sourceVersion,
    targetTemplateContentHash: templateMetadata.contentHash,
  } as AuthorityRequest, firestore);

  await firestore.runTransaction(async (transaction) => {
    const [txLifecycleSnapshot, txLegacyStateSnapshot] = await Promise.all([
      transaction.get(lifecycleRef), transaction.get(legacyStateRef),
    ]);
    if (txLifecycleSnapshot.exists) {
      const lifecycleData = txLifecycleSnapshot.data()!;
      if (lifecycleData.activeContentIdentity === targetContentIdentity
        && lifecycleData.activeProgramInstanceId === targetProgramInstanceId) {
        return;
      }
      throw new HttpsError('aborted', 'workout_lifecycle_v127_initialize_race_lost');
    }
    if (txLegacyStateSnapshot.exists) {
      throw new HttpsError('aborted', 'workout_lifecycle_v127_initialize_race_lost');
    }
    const now = FieldValue.serverTimestamp();
    transaction.set(userRoot.collection('programInstances').doc(targetProgramInstanceId), {
      programInstanceId: targetProgramInstanceId,
      cycleId: targetCycleId,
      contentIdentity: targetContentIdentity,
      prescriptionIdentity: plan.planId,
      questionnaireId,
      prescriptionInputSnapshot,
      activatedAt: now,
      supersededAt: null,
      previousProgramInstanceId: null,
      activationReason: 'INITIAL_PROGRAM',
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(userRoot.collection('trainingCycles').doc(targetCycleId), {
      cycleId: targetCycleId,
      level: currentTrainingLevel,
      cycleNumber: 1,
      status: 'ACTIVE',
      origin: 'V2_NATIVE',
      programInstanceId: targetProgramInstanceId,
      previousProgramInstanceId: null,
      startedAt: now,
      eligibleAt: null,
      completedAt: null,
      completionReason: null,
      progressionReason: 'INITIAL_PRESCRIPTION',
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(lifecycleRef, {
      startingLevel: currentTrainingLevel,
      currentTrainingLevel,
      currentCycleId: targetCycleId,
      currentCycleNumber: 1,
      activeProgramInstanceId: targetProgramInstanceId,
      activeContentIdentity: targetContentIdentity,
      activePrescriptionIdentity: plan.planId,
      initializationOrigin: 'V2_NATIVE',
      historyCompleteFrom: now,
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(userRoot.collection('workoutLifecycleEvents').doc(eventId), {
      eventId,
      type: 'PROGRAM_STARTED',
      occurredAt: now,
      cycleId: targetCycleId,
      programInstanceId: targetProgramInstanceId,
      idempotencyKey: canonicalOperationKey,
      payload: { source },
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
    });
    transaction.set(legacyStateRef, {
      programId: targetContentIdentity,
      programInstanceId: targetProgramInstanceId,
      updatedAt: now,
    });
  });

  return { status: 'SUCCESS', programId: targetContentIdentity, programInstanceId: targetProgramInstanceId };
}
