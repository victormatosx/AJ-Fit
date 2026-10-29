import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { countFirestoreRead } from '../lib/perf';
import { createInFlightDedupe } from '../lib/inFlightDedupe';
import {
  cycleIdForOperation,
  isPendingEvolution,
  isProgramInstance,
  isTrainingCycle,
  isWorkoutLifecycle,
  isWorkoutLifecycleEvent,
  lifecycleEventId,
  programInstanceIdForOperation,
  startingLevelFromQuestionnaire,
} from '../workoutLifecycle/domain';
import {
  WORKOUT_LIFECYCLE_SCHEMA_VERSION,
  type CurrentTrainingLevel,
  type PendingEvolution,
  type PrescriptionInputSnapshot,
  type ProgramInstance,
  type ProgramInstanceActivationReason,
  type StartingLevel,
  type TrainingCycle,
  type TrainingCycleOrigin,
  type WorkoutLifecycle,
  type WorkoutLifecycleEvent,
  type WorkoutLifecycleEventType,
} from '../workoutLifecycle/types';
import type { DeprecatedExperienceLevel, ExperienceLevel, LegacyExperienceLevel } from '../state/AppState';
import { buildPrescriptionInputSnapshot } from '../workoutLifecycle/prescriptionInputs';
import { getQuestionnaireById } from './userProfile';
import {
  isEligibleForNewMigration,
  isValidRolloutConfig,
  WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG,
  type WorkoutLifecycleRolloutConfig,
} from '../workoutLifecycle/rollout';
import { logWorkoutLifecycleEvent } from '../workoutLifecycle/telemetry';
import {
  authorizeWorkoutLifecycleMutation,
  requireWorkoutLifecycleCanonical,
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID,
} from '../workoutLifecycle/authorityProvider';

const USERS = 'users';
const ROLLOUT_CONFIG_COLLECTION = 'workoutLifecycleRolloutConfig';
const ROLLOUT_CONFIG_DOC = 'active';

/**
 * Fase 6 — reads the ops-controlled rollout doc (Admin-SDK-write-only, see
 * firestore.rules). Absent/malformed config fails closed to "no new
 * migrations" (docs §119) — this can never affect an account that already
 * has a V2 lifecycle, since every caller only consults it from the
 * `!lifecycle` branch.
 */
export async function loadWorkoutLifecycleRolloutConfig(): Promise<WorkoutLifecycleRolloutConfig> {
  try {
    const snapshot = await getDoc(doc(db, ROLLOUT_CONFIG_COLLECTION, ROLLOUT_CONFIG_DOC));
    if (!snapshot.exists()) {
      logWorkoutLifecycleEvent({ name: 'lifecycle_rollout_config_failed', reason: 'MISSING' });
      return WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG;
    }
    const data = snapshot.data();
    if (!isValidRolloutConfig(data)) {
      logWorkoutLifecycleEvent({ name: 'lifecycle_rollout_config_failed', reason: 'MALFORMED' });
      return WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG;
    }
    return data;
  } catch {
    logWorkoutLifecycleEvent({ name: 'lifecycle_rollout_config_failed', reason: 'UNAVAILABLE' });
    return WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG;
  }
}
export const WORKOUT_LIFECYCLE_STATE = 'workoutLifecycleState';
export const TRAINING_CYCLES = 'trainingCycles';
export const PROGRAM_INSTANCES = 'programInstances';
export const WORKOUT_LIFECYCLE_EVENTS = 'workoutLifecycleEvents';
export const WORKOUT_LIFECYCLE_CURRENT_DOC = 'current';
export const PENDING_EVOLUTIONS = 'pendingEvolutions';
export const PENDING_EVOLUTION_CURRENT_DOC = 'current';

export function lifecycleRef(uid: string) {
  return doc(db, USERS, uid, WORKOUT_LIFECYCLE_STATE, WORKOUT_LIFECYCLE_CURRENT_DOC);
}

function authorityGrantRef(uid: string) {
  return doc(db, USERS, uid, 'workoutLifecycleAuthorityGrants', WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID);
}

function cycleRef(uid: string, cycleId: string) {
  return doc(db, USERS, uid, TRAINING_CYCLES, cycleId);
}

function programInstanceRef(uid: string, programInstanceId: string) {
  return doc(db, USERS, uid, PROGRAM_INSTANCES, programInstanceId);
}

function eventRef(uid: string, eventId: string) {
  return doc(db, USERS, uid, WORKOUT_LIFECYCLE_EVENTS, eventId);
}

export function pendingEvolutionRef(uid: string) {
  return doc(db, USERS, uid, PENDING_EVOLUTIONS, PENDING_EVOLUTION_CURRENT_DOC);
}

export async function loadPendingEvolution(uid: string): Promise<PendingEvolution<Timestamp> | null> {
  countFirestoreRead('reconcile.firestore_reads.pending_evolution');
  const snapshot = await getDoc(pendingEvolutionRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!isPendingEvolution(data)) throw new Error('PENDING_EVOLUTION_INVALID');
  return data as PendingEvolution<Timestamp>;
}

export interface ActiveProgramLifecycleInput {
  contentIdentity: string;
  prescriptionIdentity: string;
  questionnaireId: string;
  questionnaireExperienceLevel: ExperienceLevel | DeprecatedExperienceLevel | LegacyExperienceLevel | null | undefined;
  /** Present for migrations performed by 8A+ clients; absent means historical inputs are unknown, not invented. */
  prescriptionInputSnapshot?: PrescriptionInputSnapshot;
  activatedAt: Timestamp | null;
}

export interface PersistedWorkoutLifecycleBundle {
  lifecycle: WorkoutLifecycle<Timestamp>;
  cycle: TrainingCycle<Timestamp>;
  programInstance: ProgramInstance<Timestamp>;
}

function parseBundle(
  lifecycleData: unknown,
  cycleData: unknown,
  instanceData: unknown,
): PersistedWorkoutLifecycleBundle {
  if (!isWorkoutLifecycle(lifecycleData)) throw new Error('WORKOUT_LIFECYCLE_INVALID');
  if (!isTrainingCycle(cycleData)) throw new Error('TRAINING_CYCLE_INVALID');
  if (!isProgramInstance(instanceData)) throw new Error('PROGRAM_INSTANCE_INVALID');
  return {
    lifecycle: lifecycleData as WorkoutLifecycle<Timestamp>,
    cycle: cycleData as TrainingCycle<Timestamp>,
    programInstance: instanceData as ProgramInstance<Timestamp>,
  };
}

export async function loadWorkoutLifecycle(uid: string): Promise<PersistedWorkoutLifecycleBundle | null> {
  countFirestoreRead('workout_lifecycle.bundle');
  const state = await getDoc(lifecycleRef(uid));
  if (!state.exists()) return null;
  if (!isWorkoutLifecycle(state.data())) throw new Error('WORKOUT_LIFECYCLE_INVALID');
  const lifecycle = state.data() as WorkoutLifecycle<Timestamp>;
  const [cycle, instance] = await Promise.all([
    getDoc(cycleRef(uid, lifecycle.currentCycleId)),
    getDoc(programInstanceRef(uid, lifecycle.activeProgramInstanceId)),
  ]);
  if (!cycle.exists() || !instance.exists()) throw new Error('WORKOUT_LIFECYCLE_REFERENT_MISSING');
  return parseBundle(lifecycle, cycle.data(), instance.data());
}

const dedupeLifecycleRead = createInFlightDedupe<PersistedWorkoutLifecycleBundle | null>();

/**
 * Ported from perf-fase0-fase1 (Fase 1.1). Same result as
 * `loadWorkoutLifecycle`, but concurrent callers for the same uid within the
 * same in-flight window share ONE Firestore round trip — fixes
 * `useWorkoutEvolution.load()` reading the lifecycle bundle twice in the
 * same Promise.all (once directly, once inside
 * `evaluateProgressionV2ForUserFull`).
 *
 * Used ONLY by hydration-only read paths (`useWorkoutEvolution`,
 * `evaluateProgressionV2ForUserFull`) — every write/convergence/recovery
 * call site keeps calling the plain `loadWorkoutLifecycle` directly, because
 * those reads must observe a snapshot no older than a write they just made;
 * joining an in-flight promise that may have started dispatching before
 * that write committed would silently return stale data.
 */
export function loadWorkoutLifecycleDeduped(uid: string): Promise<PersistedWorkoutLifecycleBundle | null> {
  return dedupeLifecycleRead(uid, () => loadWorkoutLifecycle(uid));
}

export type WorkoutLifecyclePartialState =
  | 'NO_V2_STATE'
  | 'COMPLETE'
  | 'STATE_MISSING_CYCLE'
  | 'STATE_MISSING_INSTANCE'
  | 'STATE_MISSING_CYCLE_AND_INSTANCE'
  | 'STATE_MISSING_WITH_COHERENT_ACTIVE_PAIR'
  | 'UNRECOVERABLE';

export interface WorkoutLifecycleRecoveryResult {
  classification: WorkoutLifecyclePartialState;
  recovered: boolean;
  lifecycle: PersistedWorkoutLifecycleBundle | null;
}

/** Minimally repairs only partial states whose intended V2 identities are already proven by persisted V2 records. */
export async function recoverWorkoutLifecyclePartialState(uid: string): Promise<WorkoutLifecycleRecoveryResult> {
  countFirestoreRead('reconcile.firestore_reads.recovery_state');
  countFirestoreRead('reconcile.firestore_reads.recovery_cycles');
  countFirestoreRead('reconcile.firestore_reads.recovery_instances');
  const [stateSnapshot, cycleSnapshots, instanceSnapshots] = await Promise.all([
    getDoc(lifecycleRef(uid)),
    getDocs(collection(db, USERS, uid, TRAINING_CYCLES)),
    getDocs(collection(db, USERS, uid, PROGRAM_INSTANCES)),
  ]);
  const cycles = cycleSnapshots.docs.filter((item) => isTrainingCycle(item.data()))
    .map((item) => item.data() as TrainingCycle<Timestamp>);
  const instances = instanceSnapshots.docs.filter((item) => isProgramInstance(item.data()))
    .map((item) => item.data() as ProgramInstance<Timestamp>);

  if (!stateSnapshot.exists()) {
    if (cycles.length === 0 && instances.length === 0) {
      return { classification: 'NO_V2_STATE', recovered: false, lifecycle: null };
    }
    const pairs = cycles.filter((cycle) => cycle.status === 'ACTIVE').flatMap((cycle) =>
      instances.filter((instance) => instance.supersededAt === null
        && instance.programInstanceId === cycle.programInstanceId
        && instance.cycleId === cycle.cycleId)
        .map((instance) => ({ cycle, instance })),
    );
    if (pairs.length !== 1) return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
    const { cycle, instance } = pairs[0];
    const earliestPersistedCycle = [...cycles].sort((left, right) => {
      const byStartedAt = left.startedAt.toMillis() - right.startedAt.toMillis();
      return byStartedAt !== 0 ? byStartedAt : left.cycleId.localeCompare(right.cycleId);
    })[0] ?? cycle;
    await authorizeWorkoutLifecycleMutation({
      operation: 'RECOVER',
      targetProgramInstanceId: instance.programInstanceId,
      targetCycleId: cycle.cycleId,
      targetContentIdentity: instance.contentIdentity,
      targetPrescriptionIdentity: instance.prescriptionIdentity,
    });
    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(lifecycleRef(uid));
      if (current.exists()) return;
      const now = serverTimestamp();
      transaction.set(lifecycleRef(uid), {
        startingLevel: earliestPersistedCycle.level, currentTrainingLevel: cycle.level,
        currentCycleId: cycle.cycleId, currentCycleNumber: cycle.cycleNumber,
        activeProgramInstanceId: instance.programInstanceId,
        activeContentIdentity: instance.contentIdentity,
        activePrescriptionIdentity: instance.prescriptionIdentity,
        initializationOrigin: earliestPersistedCycle.origin,
        historyCompleteFrom: earliestPersistedCycle.createdAt,
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION, createdAt: now, updatedAt: now,
      });
      transaction.delete(authorityGrantRef(uid));
    });
    return {
      classification: 'STATE_MISSING_WITH_COHERENT_ACTIVE_PAIR', recovered: true,
      lifecycle: await loadWorkoutLifecycle(uid),
    };
  }

  if (!isWorkoutLifecycle(stateSnapshot.data())) {
    return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  }
  const state = stateSnapshot.data() as WorkoutLifecycle<Timestamp>;
  const cycle = cycles.find((item) => item.cycleId === state.currentCycleId) ?? null;
  const instance = instances.find((item) => item.programInstanceId === state.activeProgramInstanceId) ?? null;
  if ((cycle && cycle.programInstanceId !== state.activeProgramInstanceId)
    || (instance && instance.cycleId !== state.currentCycleId)) {
    return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  }
  if (cycle && instance) {
    return { classification: 'COMPLETE', recovered: false, lifecycle: parseBundle(state, cycle, instance) };
  }

  const programSnapshot = await getDoc(doc(db, USERS, uid, 'workoutPrograms', state.activeContentIdentity));
  if (!programSnapshot.exists()) return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  const program = programSnapshot.data();
  if (program.prescriptionId !== state.activePrescriptionIdentity || typeof program.questionnaireId !== 'string') {
    return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  }
  if (!instance && state.initializationOrigin !== 'V1_MIGRATION_BASELINE' && program.source !== 'onboarding') {
    return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  }
  const questionnaire = await getQuestionnaireById(uid, program.questionnaireId);
  if (!questionnaire) return { classification: 'UNRECOVERABLE', recovered: false, lifecycle: null };
  const inputSnapshot = buildPrescriptionInputSnapshot({
    answers: questionnaire.answers,
    currentTrainingLevel: state.currentTrainingLevel,
    source: 'QUESTIONNAIRE_BASELINE',
  });
  const classification: WorkoutLifecyclePartialState = !cycle && !instance
    ? 'STATE_MISSING_CYCLE_AND_INSTANCE'
    : !cycle ? 'STATE_MISSING_CYCLE' : 'STATE_MISSING_INSTANCE';

  await authorizeWorkoutLifecycleMutation({
    operation: 'RECOVER',
    sourceProgramInstanceId: state.activeProgramInstanceId,
    sourceCycleId: state.currentCycleId,
    targetProgramInstanceId: state.activeProgramInstanceId,
    targetCycleId: state.currentCycleId,
    targetContentIdentity: state.activeContentIdentity,
    targetPrescriptionIdentity: state.activePrescriptionIdentity,
    targetPrescriptionInputSnapshot: inputSnapshot as unknown as Record<string, unknown>,
  });

  try {
    await runTransaction(db, async (transaction) => {
      const [currentState, currentCycle, currentInstance] = await Promise.all([
      transaction.get(lifecycleRef(uid)),
      transaction.get(cycleRef(uid, state.currentCycleId)),
      transaction.get(programInstanceRef(uid, state.activeProgramInstanceId)),
    ]);
    if (!currentState.exists() || !isWorkoutLifecycle(currentState.data())) {
      throw new Error('WORKOUT_LIFECYCLE_RECOVERY_STATE_CHANGED');
    }
    const now = serverTimestamp();
    if (!currentInstance.exists()) {
      transaction.set(programInstanceRef(uid, state.activeProgramInstanceId), {
        programInstanceId: state.activeProgramInstanceId, cycleId: state.currentCycleId,
        contentIdentity: state.activeContentIdentity, prescriptionIdentity: state.activePrescriptionIdentity,
        questionnaireId: program.questionnaireId, prescriptionInputSnapshot: inputSnapshot,
        activatedAt: cycle?.startedAt ?? state.historyCompleteFrom, supersededAt: null,
        previousProgramInstanceId: cycle?.previousProgramInstanceId ?? null,
        activationReason: state.initializationOrigin === 'V1_MIGRATION_BASELINE'
          ? 'V1_MIGRATION_BASELINE' : 'AUTOMATIC_RECONCILIATION',
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION, createdAt: now, updatedAt: now,
      });
    }
    if (!currentCycle.exists()) {
      transaction.set(cycleRef(uid, state.currentCycleId), {
        cycleId: state.currentCycleId, level: state.currentTrainingLevel,
        cycleNumber: state.currentCycleNumber, status: 'ACTIVE', origin: state.initializationOrigin,
        programInstanceId: state.activeProgramInstanceId,
        previousProgramInstanceId: instance?.previousProgramInstanceId ?? null,
        startedAt: instance?.activatedAt ?? state.historyCompleteFrom,
        eligibleAt: null, completedAt: null, completionReason: null,
        progressionReason: state.initializationOrigin === 'V1_MIGRATION_BASELINE'
          ? 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED'
          : 'PARTIAL_STATE_RECOVERY_NO_HISTORY_INFERRED',
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION, createdAt: now, updatedAt: now,
      });
    }
      transaction.delete(authorityGrantRef(uid));
    });
  } catch (error) {
    const converged = await loadWorkoutLifecycle(uid).catch(() => null);
    if (!converged
      || converged.lifecycle.activeProgramInstanceId !== state.activeProgramInstanceId
      || converged.lifecycle.currentCycleId !== state.currentCycleId) {
      throw error;
    }
    return { classification, recovered: true, lifecycle: converged };
  }
  return { classification, recovered: true, lifecycle: await loadWorkoutLifecycle(uid) };
}

/**
 * Deterministic, transaction-guarded lazy bootstrap for an account whose
 * active WorkoutProgram predates V2. It records only the active program's
 * known activation timestamp. Earlier cycles/instances are deliberately not
 * inferred; `V1_MIGRATION_BASELINE` and `historyCompleteFrom` make that
 * limitation explicit and auditable.
 */
export async function ensureWorkoutLifecycleForLegacyActiveProgram(
  uid: string,
  program: ActiveProgramLifecycleInput,
): Promise<PersistedWorkoutLifecycleBundle> {
  const alreadyV2 = await loadWorkoutLifecycle(uid);
  if (alreadyV2) return alreadyV2;
  const startingLevel = startingLevelFromQuestionnaire(program.questionnaireExperienceLevel);
  if (!startingLevel) throw new Error('WORKOUT_LIFECYCLE_STARTING_LEVEL_UNKNOWN');
  const prescriptionInputSnapshot = program.prescriptionInputSnapshot ?? await (async () => {
    const questionnaire = await getQuestionnaireById(uid, program.questionnaireId);
    if (!questionnaire) throw new Error('WORKOUT_LIFECYCLE_QUESTIONNAIRE_NOT_FOUND');
    return buildPrescriptionInputSnapshot({
      answers: questionnaire.answers,
      currentTrainingLevel: startingLevel,
      source: 'QUESTIONNAIRE_BASELINE',
    });
  })();
  const programSnapshot = await getDoc(doc(db, USERS, uid, 'workoutPrograms', program.contentIdentity));
  if (!programSnapshot.exists()) throw new Error('WORKOUT_LIFECYCLE_PROGRAM_NOT_FOUND');
  const programData = programSnapshot.data();
  // Very old V1 snapshots may predate one or more seal-metadata fields. They
  // are intent-only placeholders here: MIGRATE's backend canonical response
  // replaces plan/template identity before any authoritative write.
  const questionnaireVersion = typeof programData.questionnaireVersion === 'number'
    ? programData.questionnaireVersion : 1;
  const programSource = typeof programData.source === 'string'
    ? programData.source : 'automatic_reconciliation';
  const templateVersion = typeof programData.templateVersion === 'number'
    ? programData.templateVersion : 1;
  const templateSourceVersion = typeof programData.templateSourceVersion === 'string'
    ? programData.templateSourceVersion : '1.0.0';
  const templateContentHash = typeof programData.templateContentHash === 'string'
    ? programData.templateContentHash : '0'.repeat(64);

  const authorityResult = await authorizeWorkoutLifecycleMutation({
    operation: 'MIGRATE',
    targetProgramInstanceId: programInstanceIdForOperation(`v1-baseline:${program.contentIdentity}`),
    targetCycleId: cycleIdForOperation(`v1-baseline:${program.contentIdentity}`),
    targetContentIdentity: program.contentIdentity,
    targetPrescriptionIdentity: program.prescriptionIdentity,
    questionnaireId: program.questionnaireId,
    questionnaireVersion,
    targetProgramSource: programSource,
    targetTemplateVersion: templateVersion,
    targetTemplateSourceVersion: templateSourceVersion,
    targetTemplateContentHash: templateContentHash,
    targetPlan: programSnapshot.data() as Record<string, unknown>,
    targetPrescriptionInputSnapshot: prescriptionInputSnapshot as unknown as Record<string, unknown>,
  });
  const canonical = requireWorkoutLifecycleCanonical(authorityResult, 'MIGRATE');
  if (canonical.targetPrescriptionIdentity !== canonical.targetPlan.planId) {
    throw new Error('WORKOUT_LIFECYCLE_CANONICAL_IDENTITY_INVALID');
  }
  const targetContentIdentity = canonical.targetContentIdentity;
  const targetPrescriptionIdentity = canonical.targetPrescriptionIdentity;
  const operationKey = `v1-baseline:${targetContentIdentity}`;
  const cycleId = cycleIdForOperation(operationKey);
  const programInstanceId = programInstanceIdForOperation(operationKey);
  const stateRef = lifecycleRef(uid);
  const targetCycleRef = cycleRef(uid, cycleId);
  const targetInstanceRef = programInstanceRef(uid, programInstanceId);
  const targetProgramRef = doc(db, USERS, uid, 'workoutPrograms', targetContentIdentity);
  const activeProgramStateRef = doc(db, USERS, uid, 'workoutProgramState', 'active');

  try {
    await runTransaction(db, async (transaction) => {
      const [existing, canonicalProgram] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(targetProgramRef),
      ]);
      if (existing.exists()) return;
      if (!canonicalProgram.exists()) throw new Error('WORKOUT_LIFECYCLE_CANONICAL_PROGRAM_MISSING');
      const activatedAt = targetContentIdentity === program.contentIdentity
        ? program.activatedAt ?? serverTimestamp()
        : serverTimestamp();
      const now = serverTimestamp();
      if (targetContentIdentity !== program.contentIdentity) {
        transaction.update(programSnapshot.ref, { status: 'superseded', updatedAt: now });
      }
      transaction.set(targetInstanceRef, {
        programInstanceId,
        cycleId,
        contentIdentity: targetContentIdentity,
        prescriptionIdentity: targetPrescriptionIdentity,
        questionnaireId: program.questionnaireId,
        prescriptionInputSnapshot,
        activatedAt,
        supersededAt: null,
        previousProgramInstanceId: null,
        activationReason: 'V1_MIGRATION_BASELINE',
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(targetCycleRef, {
        cycleId,
        level: startingLevel,
        cycleNumber: 1,
        status: 'ACTIVE',
        origin: 'V1_MIGRATION_BASELINE',
        programInstanceId,
        previousProgramInstanceId: null,
        startedAt: activatedAt,
        eligibleAt: null,
        completedAt: null,
        completionReason: null,
        progressionReason: 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED',
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(stateRef, {
        startingLevel,
        currentTrainingLevel: startingLevel,
        currentCycleId: cycleId,
        currentCycleNumber: 1,
        activeProgramInstanceId: programInstanceId,
        activeContentIdentity: targetContentIdentity,
        activePrescriptionIdentity: targetPrescriptionIdentity,
        initializationOrigin: 'V1_MIGRATION_BASELINE',
        historyCompleteFrom: now,
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(activeProgramStateRef, {
        programId: targetContentIdentity,
        programInstanceId,
        updatedAt: now,
      });
      transaction.delete(authorityGrantRef(uid));
    });
  } catch (error) {
    // When two devices submit the same deterministic create at exactly the
    // same time, Rules may classify the stale loser's `set` as an update
    // before the Web SDK receives an ABORTED retry. Re-read the authoritative
    // state: the operation converged if and only if the winner created the
    // exact expected baseline; every other denial/error is rethrown.
    const converged = await loadWorkoutLifecycle(uid).catch(() => null);
    if (
      !converged
      || converged.lifecycle.activeContentIdentity !== targetContentIdentity
      || converged.lifecycle.activePrescriptionIdentity !== targetPrescriptionIdentity
      || converged.lifecycle.initializationOrigin !== 'V1_MIGRATION_BASELINE'
    ) throw error;
    return converged;
  }

  const loaded = await loadWorkoutLifecycle(uid);
  if (!loaded) throw new Error('WORKOUT_LIFECYCLE_INITIALIZATION_FAILED');
  return loaded;
}

export type EnsureWorkoutLifecycleV2Result =
  | { status: 'ALREADY_V2'; lifecycle: PersistedWorkoutLifecycleBundle }
  | { status: 'MIGRATED'; lifecycle: PersistedWorkoutLifecycleBundle }
  | { status: 'NOT_ROLLED_OUT' };

/**
 * Fase 6 rollout-gated composition of the Phase 1 lazy bootstrap (docs §21:
 * "ensureWorkoutLifecycleV2(uid)"). Safe to call repeatedly, safe
 * concurrently (delegates entirely to `ensureWorkoutLifecycleForLegacyActiveProgram`'s
 * own transaction+convergence guarantees), and a true no-op for an account
 * that already has a V2 lifecycle — the rollout check is skipped entirely in
 * that case, so reducing the rollout percentage can never move an
 * already-migrated user back to V1 (docs §30/§CC).
 *
 * Phase 8C wires this composition into the real `loadActiveWorkoutProgram`
 * enrollment branch. `NOT_ROLLED_OUT` returns the still-usable legacy program
 * without V2 identity fields and without restoring V1 progression authority;
 * a later eligible load performs the same deterministic migration.
 */
export async function ensureWorkoutLifecycleV2(
  uid: string,
  program: ActiveProgramLifecycleInput,
  rolloutConfig: WorkoutLifecycleRolloutConfig,
): Promise<EnsureWorkoutLifecycleV2Result> {
  const existing = await loadWorkoutLifecycle(uid);
  if (existing) return { status: 'ALREADY_V2', lifecycle: existing };
  if (!isEligibleForNewMigration(uid, rolloutConfig)) return { status: 'NOT_ROLLED_OUT' };
  const lifecycle = await ensureWorkoutLifecycleForLegacyActiveProgram(uid, program);
  return { status: 'MIGRATED', lifecycle };
}

export interface ActivateProgramInstanceInput {
  uid: string;
  idempotencyKey: string;
  expectedActiveProgramInstanceId: string;
  contentIdentity: string;
  prescriptionIdentity: string;
  questionnaireId: string;
  prescriptionInputSnapshot?: PrescriptionInputSnapshot;
  activationReason: ProgramInstanceActivationReason;
  nextCycle?: {
    level: CurrentTrainingLevel;
    cycleNumber: number;
    progressionReason: string;
    origin?: TrainingCycleOrigin;
  };
  eventType?: Extract<WorkoutLifecycleEventType, 'PROGRAM_STARTED' | 'PROGRAM_ADAPTED'>;
}

/**
 * Phase-1 primitive for explicit future transitions. It does not decide
 * eligibility or prescription changes; callers must provide the already-
 * decided cycle/instance transition and an idempotency key.
 */
export async function activateProgramInstance(
  input: ActivateProgramInstanceInput,
): Promise<PersistedWorkoutLifecycleBundle> {
  if (!input.idempotencyKey) throw new Error('WORKOUT_LIFECYCLE_IDEMPOTENCY_KEY_REQUIRED');
  const instanceId = programInstanceIdForOperation(input.idempotencyKey);
  const eventType = input.eventType ?? 'PROGRAM_STARTED';
  const eventId = lifecycleEventId(eventType, input.idempotencyKey);
  const preflight = await loadWorkoutLifecycle(input.uid);
  if (!preflight) throw new Error('WORKOUT_LIFECYCLE_NOT_INITIALIZED');
  const targetCycleId = input.nextCycle
    ? cycleIdForOperation(`cycle:${input.idempotencyKey}`)
    : preflight.cycle.cycleId;
  // Historical Phase-1 primitive retained for compatibility tests. The
  // production backend intentionally refuses this ACTIVATE request when it
  // is not correlated to an authoritative pending evolution; callers must
  // use the lifecycle application orchestrator instead.
  await authorizeWorkoutLifecycleMutation({
    operation: 'ACTIVATE',
    sourceProgramInstanceId: preflight.programInstance.programInstanceId,
    sourceCycleId: preflight.cycle.cycleId,
    targetProgramInstanceId: instanceId,
    targetCycleId,
    targetContentIdentity: input.contentIdentity,
    targetPrescriptionIdentity: input.prescriptionIdentity,
    targetTrainingLevel: input.nextCycle?.level ?? preflight.lifecycle.currentTrainingLevel,
    targetCycleNumber: input.nextCycle?.cycleNumber ?? preflight.lifecycle.currentCycleNumber,
    eventId,
    eventType,
    idempotencyKey: input.idempotencyKey,
  });

  try {
    await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(lifecycleRef(input.uid));
    if (!stateSnapshot.exists() || !isWorkoutLifecycle(stateSnapshot.data())) {
      throw new Error('WORKOUT_LIFECYCLE_NOT_INITIALIZED');
    }
    const state = stateSnapshot.data() as WorkoutLifecycle<Timestamp>;
    const existingInstance = await transaction.get(programInstanceRef(input.uid, instanceId));
    if (existingInstance.exists()) {
      transaction.delete(authorityGrantRef(input.uid));
      return;
    }
    if (state.activeProgramInstanceId !== input.expectedActiveProgramInstanceId) {
      throw new Error('WORKOUT_LIFECYCLE_STALE_ACTIVE_INSTANCE');
    }
    const [previousInstance, currentCycle, existingEvent] = await Promise.all([
      transaction.get(programInstanceRef(input.uid, state.activeProgramInstanceId)),
      transaction.get(cycleRef(input.uid, state.currentCycleId)),
      transaction.get(eventRef(input.uid, eventId)),
    ]);
    if (!previousInstance.exists() || !currentCycle.exists()) {
      throw new Error('WORKOUT_LIFECYCLE_REFERENT_MISSING');
    }
    if (existingEvent.exists()) {
      transaction.delete(authorityGrantRef(input.uid));
      return;
    }

    const now = serverTimestamp();
    const cycleId = input.nextCycle
      ? cycleIdForOperation(`cycle:${input.idempotencyKey}`)
      : state.currentCycleId;

    transaction.update(programInstanceRef(input.uid, state.activeProgramInstanceId), {
      supersededAt: now,
      updatedAt: now,
    });
    transaction.set(programInstanceRef(input.uid, instanceId), {
      programInstanceId: instanceId,
      cycleId,
      contentIdentity: input.contentIdentity,
      prescriptionIdentity: input.prescriptionIdentity,
      questionnaireId: input.questionnaireId,
      ...(input.prescriptionInputSnapshot ? { prescriptionInputSnapshot: input.prescriptionInputSnapshot } : {}),
      activatedAt: now,
      supersededAt: null,
      previousProgramInstanceId: state.activeProgramInstanceId,
      activationReason: input.activationReason,
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    if (input.nextCycle) {
      transaction.update(cycleRef(input.uid, state.currentCycleId), {
        status: 'COMPLETED',
        completedAt: now,
        completionReason: 'EARNED_EVOLUTION',
        updatedAt: now,
      });
      transaction.set(cycleRef(input.uid, cycleId), {
        cycleId,
        level: input.nextCycle.level,
        cycleNumber: input.nextCycle.cycleNumber,
        status: 'ACTIVE',
        origin: input.nextCycle.origin ?? 'V2_NATIVE',
        programInstanceId: instanceId,
        previousProgramInstanceId: state.activeProgramInstanceId,
        startedAt: now,
        eligibleAt: null,
        completedAt: null,
        completionReason: null,
        progressionReason: input.nextCycle.progressionReason,
        schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      transaction.update(cycleRef(input.uid, state.currentCycleId), {
        programInstanceId: instanceId,
        previousProgramInstanceId: state.activeProgramInstanceId,
        updatedAt: now,
      });
    }

    transaction.update(lifecycleRef(input.uid), {
      currentTrainingLevel: input.nextCycle?.level ?? state.currentTrainingLevel,
      currentCycleId: cycleId,
      currentCycleNumber: input.nextCycle?.cycleNumber ?? state.currentCycleNumber,
      activeProgramInstanceId: instanceId,
      activeContentIdentity: input.contentIdentity,
      activePrescriptionIdentity: input.prescriptionIdentity,
      updatedAt: now,
    });
    transaction.set(eventRef(input.uid, eventId), {
      eventId,
      type: eventType,
      occurredAt: now,
      cycleId,
      programInstanceId: instanceId,
      idempotencyKey: input.idempotencyKey,
      payload: { activationReason: input.activationReason },
      schemaVersion: WORKOUT_LIFECYCLE_SCHEMA_VERSION,
    });
    transaction.delete(authorityGrantRef(input.uid));
    });
  } catch (error) {
    // A concurrent caller may have committed this same deterministic
    // transition while this transaction was retrying. Accept only the exact
    // intended instance/content/prescription; a different winner is stale.
    const converged = await loadWorkoutLifecycle(input.uid).catch(() => null);
    if (
      !converged
      || converged.lifecycle.activeProgramInstanceId !== instanceId
      || converged.lifecycle.activeContentIdentity !== input.contentIdentity
      || converged.lifecycle.activePrescriptionIdentity !== input.prescriptionIdentity
    ) throw error;
    return converged;
  }

  const result = await loadWorkoutLifecycle(input.uid);
  if (
    !result
    || result.lifecycle.activeProgramInstanceId !== instanceId
    || result.lifecycle.activeContentIdentity !== input.contentIdentity
    || result.lifecycle.activePrescriptionIdentity !== input.prescriptionIdentity
  ) throw new Error('WORKOUT_LIFECYCLE_TRANSITION_DIVERGED');
  return result;
}

export async function listTrainingCycles(uid: string): Promise<TrainingCycle<Timestamp>[]> {
  const snapshot = await getDocs(collection(db, USERS, uid, TRAINING_CYCLES));
  return snapshot.docs.map((item) => {
    if (!isTrainingCycle(item.data())) throw new Error(`TRAINING_CYCLE_INVALID:${item.id}`);
    return item.data() as TrainingCycle<Timestamp>;
  });
}

/**
 * Bounded progression history for the Intermediate promotion decision.
 * The active cycle plus the three immediately preceding earned cycles are
 * sufficient for the four-cycle rule (and retain the successor needed by
 * the conservative pre-8A completion inference).
 */
export async function listRecentIntermediateTrainingCycles(
  uid: string,
  maximumCycles: number,
): Promise<TrainingCycle<Timestamp>[]> {
  countFirestoreRead('workout_lifecycle.intermediate_cycles');
  const snapshot = await getDocs(query(
    collection(db, USERS, uid, TRAINING_CYCLES),
    where('level', '==', 'INTERMEDIATE'),
    orderBy('cycleNumber', 'desc'),
    limit(maximumCycles),
  ));
  return snapshot.docs.map((item) => {
    if (!isTrainingCycle(item.data())) throw new Error(`TRAINING_CYCLE_INVALID:${item.id}`);
    return item.data() as TrainingCycle<Timestamp>;
  });
}

export async function listProgramInstances(uid: string): Promise<ProgramInstance<Timestamp>[]> {
  const snapshot = await getDocs(collection(db, USERS, uid, PROGRAM_INSTANCES));
  return snapshot.docs.map((item) => {
    if (!isProgramInstance(item.data())) throw new Error(`PROGRAM_INSTANCE_INVALID:${item.id}`);
    return item.data() as ProgramInstance<Timestamp>;
  });
}

/**
 * Every ProgramInstance that belonged to one TrainingCycle, oldest activation
 * first — the real window set the cycle's progression must be reconstructed
 * from (an ADAPT supersedes one instance and activates another inside the
 * SAME cycle, so a single-instance read loses the progress already earned).
 *
 * Bounded by an explicit cap instead of reading the whole collection. A cycle
 * with more instances than `maximumInstances` is reported as truncated rather
 * than silently cut, so no caller can mistake a partial window set for a
 * complete one.
 */
export async function listProgramInstancesForCycle(
  uid: string,
  cycleId: string,
  maximumInstances: number,
): Promise<{ instances: ProgramInstance<Timestamp>[]; truncated: boolean }> {
  countFirestoreRead('workout_lifecycle.cycle_program_instances');
  const snapshot = await getDocs(query(
    collection(db, USERS, uid, PROGRAM_INSTANCES),
    where('cycleId', '==', cycleId),
    limit(maximumInstances + 1),
  ));
  const instances = snapshot.docs.slice(0, maximumInstances).map((item) => {
    if (!isProgramInstance(item.data())) throw new Error(`PROGRAM_INSTANCE_INVALID:${item.id}`);
    return item.data() as ProgramInstance<Timestamp>;
  });
  instances.sort((left, right) => left.activatedAt.toMillis() - right.activatedAt.toMillis());
  return { instances, truncated: snapshot.docs.length > maximumInstances };
}

export async function listWorkoutLifecycleEvents(uid: string): Promise<WorkoutLifecycleEvent<Timestamp>[]> {
  const snapshot = await getDocs(collection(db, USERS, uid, WORKOUT_LIFECYCLE_EVENTS));
  return snapshot.docs.map((item) => {
    if (!isWorkoutLifecycleEvent(item.data())) throw new Error(`WORKOUT_LIFECYCLE_EVENT_INVALID:${item.id}`);
    return item.data() as WorkoutLifecycleEvent<Timestamp>;
  });
}

/** Bounded to the currently-active ProgramInstance, so UX hydration never
 * scans a user's full immutable lifecycle ledger. */
export async function listWorkoutLifecycleEventsForProgramInstance(
  uid: string,
  programInstanceId: string,
): Promise<WorkoutLifecycleEvent<Timestamp>[]> {
  countFirestoreRead('workout_lifecycle.program_instance_events');
  const snapshot = await getDocs(query(
    collection(db, USERS, uid, WORKOUT_LIFECYCLE_EVENTS),
    where('programInstanceId', '==', programInstanceId),
  ));
  return snapshot.docs.map((item) => {
    if (!isWorkoutLifecycleEvent(item.data())) throw new Error(`WORKOUT_LIFECYCLE_EVENT_INVALID:${item.id}`);
    return item.data() as WorkoutLifecycleEvent<Timestamp>;
  });
}

export async function loadProgramInstance(
  uid: string,
  programInstanceId: string,
): Promise<ProgramInstance<Timestamp> | null> {
  const snapshot = await getDoc(programInstanceRef(uid, programInstanceId));
  if (!snapshot.exists()) return null;
  if (!isProgramInstance(snapshot.data())) throw new Error('PROGRAM_INSTANCE_INVALID');
  return snapshot.data() as ProgramInstance<Timestamp>;
}

/** Returns the fully-known V2 interval containing `instant`, if any. */
export async function lifecycleAt(
  uid: string,
  instant: Timestamp,
): Promise<{ cycle: TrainingCycle<Timestamp>; programInstance: ProgramInstance<Timestamp> } | null> {
  const [cycles, instances] = await Promise.all([listTrainingCycles(uid), listProgramInstances(uid)]);
  const activeInstance = instances.find((item) =>
    item.activatedAt.toMillis() <= instant.toMillis()
    && (item.supersededAt == null || instant.toMillis() < item.supersededAt.toMillis()),
  );
  if (!activeInstance) return null;
  const cycle = cycles.find((item) => item.cycleId === activeInstance.cycleId);
  return cycle ? { cycle, programInstance: activeInstance } : null;
}

export type { StartingLevel };
