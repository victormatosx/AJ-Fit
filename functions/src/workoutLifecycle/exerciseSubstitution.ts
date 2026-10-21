import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { db as defaultDb } from '../lib/firebaseAdmin';
import { requireAuth } from '../lib/auth';
import { loadExerciseCatalog } from './prescriptionContext';
import { isExerciseExecutable, manualSubstitutionEquipmentContext } from './prescriptionEngine/workoutPrescription/equipment';
import type { ExerciseCatalog } from './prescriptionEngine/workoutPrescription/exerciseCatalog';
import {
  evaluateManualSubstitutionCandidate,
  evaluateRevertToAnchor,
} from './prescriptionEngine/workoutPrescription/manualSubstitutionResolver';
import type { QuestionnaireAnswers } from './prescriptionEngine/workoutPrescription/types';

export type ExerciseSubstitutionScope = 'SESSION' | 'PERMANENT';

export interface ApplyExerciseSubstitutionRequest {
  executionId: string;
  exerciseIndex: number;
  requestedExerciseId: string;
  scope: ExerciseSubstitutionScope;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function parseRequest(value: unknown): ApplyExerciseSubstitutionRequest {
  if (
    !plainObject(value)
    || !boundedId(value.executionId)
    || !Number.isInteger(value.exerciseIndex) || (value.exerciseIndex as number) < 0 || (value.exerciseIndex as number) > 19
    || !boundedId(value.requestedExerciseId)
    || (value.scope !== 'SESSION' && value.scope !== 'PERMANENT')
  ) {
    throw new HttpsError('invalid-argument', 'invalid_exercise_substitution_request');
  }
  return value as unknown as ApplyExerciseSubstitutionRequest;
}

interface ExecutionSlotContext {
  anchorExerciseId: string;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}

function loadSlotContext(exercises: DocumentData[], exerciseIndex: number): ExecutionSlotContext {
  if (!Array.isArray(exercises) || exerciseIndex >= exercises.length) {
    throw new HttpsError('invalid-argument', 'exercise_index_out_of_range');
  }
  const slot = exercises[exerciseIndex];
  const sets = Array.isArray(slot?.sets) ? slot.sets : [];
  if (sets.some((set: DocumentData) => set.status === 'COMPLETED')) {
    throw new HttpsError('failed-precondition', 'exercise_already_has_completed_sets');
  }
  const anchorExerciseId = typeof slot.prescribedExerciseId === 'string' ? slot.prescribedExerciseId : slot.exerciseId;
  if (typeof anchorExerciseId !== 'string') throw new HttpsError('failed-precondition', 'execution_slot_missing_exercise_id');
  const effectiveExerciseIdsInSession = new Set<string>(
    exercises
      .map((exercise, index) => (index === exerciseIndex ? null : exercise.exerciseId))
      .filter((id): id is string => typeof id === 'string'),
  );
  return { anchorExerciseId, effectiveExerciseIdsInSession };
}

async function loadSubstitutionResolutionContext(
  uid: string,
  execution: DocumentData,
  firestore: Firestore,
): Promise<{ catalog: ExerciseCatalog; equipmentContext: ReturnType<typeof manualSubstitutionEquipmentContext> }> {
  if (typeof execution.programInstanceId !== 'string') {
    throw new HttpsError('failed-precondition', 'manual_substitution_requires_v2_program');
  }
  const root = firestore.collection('users').doc(uid);
  const [instanceSnapshot, programSnapshot, catalogExercises] = await Promise.all([
    root.collection('programInstances').doc(execution.programInstanceId).get(),
    root.collection('workoutPrograms').doc(execution.programId).get(),
    loadExerciseCatalog(firestore),
  ]);
  if (!instanceSnapshot.exists || !programSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'program_context_missing');
  }
  const instance = instanceSnapshot.data()!;
  const program = programSnapshot.data()!;
  const answers = plainObject(instance.prescriptionInputSnapshot) && plainObject(instance.prescriptionInputSnapshot.inputs)
    ? instance.prescriptionInputSnapshot.inputs as unknown as QuestionnaireAnswers
    : null;
  if (!answers) throw new HttpsError('failed-precondition', 'prescription_inputs_missing');
  const catalog: ExerciseCatalog = new Map(catalogExercises.map((exercise) => [exercise.id, exercise]));
  return {
    catalog,
    equipmentContext: manualSubstitutionEquipmentContext(answers, program.environment, program.templateSourceVersion),
  };
}

export function isRequestedSubstitutionEligible(input: {
  anchorExerciseId: string;
  requestedExerciseId: string;
  catalog: ExerciseCatalog;
  equipmentContext: ReturnType<typeof manualSubstitutionEquipmentContext>;
  effectiveExerciseIdsInSession: ReadonlySet<string>;
}): boolean {
  if (input.requestedExerciseId === input.anchorExerciseId) {
    return evaluateRevertToAnchor({
      anchorExerciseId: input.anchorExerciseId,
      catalog: input.catalog,
      equipmentContext: input.equipmentContext,
      effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
    }).eligible;
  }
  const source = input.catalog.get(input.anchorExerciseId);
  if (!source) return false;
  // Re-evaluated directly against the exact requested id — NOT limited to
  // membership in a top-3-sliced `resolveManualSubstitutionCandidates` list,
  // so a candidate that was eligible-but-ranked-4th-or-lower (or evaluated
  // under a slightly different `effectiveExerciseIdsInSession` a moment
  // earlier) is judged on its own merits at commit time, never on a stale
  // top-N snapshot.
  return evaluateManualSubstitutionCandidate({
    source,
    candidateId: input.requestedExerciseId,
    catalog: input.catalog,
    equipmentContext: input.equipmentContext,
    effectiveExerciseIdsInSession: input.effectiveExerciseIdsInSession,
  }).eligible;
}

export type MaterializedSubstitutionValidation =
  | { valid: true }
  | {
    valid: false;
    reason: 'substitution_marker_missing' | 'substitution_marker_invalid'
      | 'substitution_marker_on_prescribed_exercise' | 'substitution_not_eligible';
    exerciseIndex: number;
    prescribedExerciseId: string;
    exerciseId: string;
  };

export async function validateMaterializedExecutionSubstitutions(
  uid: string,
  execution: DocumentData,
  firestore: Firestore,
): Promise<MaterializedSubstitutionValidation> {
  const exercises: DocumentData[] = Array.isArray(execution.exercises) ? execution.exercises : [];
  const hasEffectiveSubstitution = exercises.some((slot) =>
    typeof slot?.prescribedExerciseId === 'string'
      && typeof slot?.exerciseId === 'string'
      && slot.prescribedExerciseId !== slot.exerciseId);
  if (!hasEffectiveSubstitution) {
    const markerIndex = exercises.findIndex((slot) => slot?.substitution != null);
    if (markerIndex < 0) return { valid: true };
    const slot = exercises[markerIndex];
    return {
      valid: false,
      reason: 'substitution_marker_on_prescribed_exercise',
      exerciseIndex: markerIndex,
      prescribedExerciseId: String(slot?.prescribedExerciseId ?? slot?.exerciseId ?? ''),
      exerciseId: String(slot?.exerciseId ?? ''),
    };
  }

  for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex += 1) {
    const slot = exercises[exerciseIndex];
    const prescribedExerciseId = typeof slot?.prescribedExerciseId === 'string'
      ? slot.prescribedExerciseId : slot?.exerciseId;
    const exerciseId = slot?.exerciseId;
    if (typeof prescribedExerciseId !== 'string' || typeof exerciseId !== 'string'
      || prescribedExerciseId === exerciseId) continue;
    if (!plainObject(slot.substitution)) {
      return { valid: false, reason: 'substitution_marker_missing', exerciseIndex, prescribedExerciseId, exerciseId };
    }
    if (!['SESSION', 'PERMANENT'].includes(String(slot.substitution.scope))
      || !(slot.substitution.appliedAt instanceof Timestamp)) {
      return { valid: false, reason: 'substitution_marker_invalid', exerciseIndex, prescribedExerciseId, exerciseId };
    }
  }

  const { catalog, equipmentContext } = await loadSubstitutionResolutionContext(uid, execution, firestore);
  for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex += 1) {
    const slot = exercises[exerciseIndex];
    const prescribedExerciseId = typeof slot?.prescribedExerciseId === 'string'
      ? slot.prescribedExerciseId : slot?.exerciseId;
    const exerciseId = slot?.exerciseId;
    if (typeof prescribedExerciseId !== 'string' || typeof exerciseId !== 'string') continue;
    if (prescribedExerciseId === exerciseId) {
      if (slot.substitution != null) {
        return { valid: false, reason: 'substitution_marker_on_prescribed_exercise', exerciseIndex, prescribedExerciseId, exerciseId };
      }
      continue;
    }
    const effectiveExerciseIdsInSession = new Set<string>(exercises
      .filter((_, index) => index !== exerciseIndex)
      .map((other) => other?.exerciseId)
      .filter((id): id is string => typeof id === 'string'));
    // Read-only continuity for already persisted sessions from the retired schema.
    // Rules forbid this field on new executions. Its value never selects a policy.
    // Keep the user's existing swap, validating operational availability, equipment
    // and duplicates; new requests always pass the ordinary manual resolver below.
    if (Object.prototype.hasOwnProperty.call(execution, 'substitutionPolicySnapshot')) {
      const candidate = catalog.get(exerciseId);
      if (!candidate || candidate.status !== 'active' || !candidate.availability.manualSelection
        || !candidate.availability.substitution || !isExerciseExecutable(candidate, equipmentContext)
        || effectiveExerciseIdsInSession.has(exerciseId)) {
        return { valid: false, reason: 'substitution_not_eligible', exerciseIndex, prescribedExerciseId, exerciseId };
      }
      continue;
    }
    if (!isRequestedSubstitutionEligible({
      anchorExerciseId: prescribedExerciseId,
      requestedExerciseId: exerciseId,
      catalog,
      equipmentContext,
      effectiveExerciseIdsInSession,
    })) {
      return { valid: false, reason: 'substitution_not_eligible', exerciseIndex, prescribedExerciseId, exerciseId };
    }
  }
  return { valid: true };
}

export async function applyExerciseSubstitutionHandler(
  request: CallableRequest,
  firestore: Firestore = defaultDb,
): Promise<{ exerciseId: string; scope: ExerciseSubstitutionScope }> {
  const uid = requireAuth(request);
  const data = parseRequest(request.data);
  const root = firestore.collection('users').doc(uid);
  const executionRef = root.collection('workoutExecutions').doc(data.executionId);

  const executionSnapshot = await executionRef.get();
  if (!executionSnapshot.exists) throw new HttpsError('not-found', 'execution_not_found');
  const execution = executionSnapshot.data()!;
  if (execution.status !== 'IN_PROGRESS') throw new HttpsError('failed-precondition', 'execution_not_in_progress');

  const { anchorExerciseId, effectiveExerciseIdsInSession } = loadSlotContext(execution.exercises, data.exerciseIndex);
  const { catalog, equipmentContext } = await loadSubstitutionResolutionContext(uid, execution, firestore);

  if (!catalog.has(anchorExerciseId)) throw new HttpsError('failed-precondition', 'anchor_exercise_not_in_catalog');
  const eligible = isRequestedSubstitutionEligible({
    anchorExerciseId,
    requestedExerciseId: data.requestedExerciseId,
    catalog,
    equipmentContext,
    effectiveExerciseIdsInSession,
  });
  if (!eligible) throw new HttpsError('permission-denied', 'requested_exercise_not_an_eligible_substitution');

  const isRevert = data.requestedExerciseId === anchorExerciseId;
  const appliedAt = Timestamp.now();

  await firestore.runTransaction(async (transaction) => {
    const fresh = await transaction.get(executionRef);
    if (!fresh.exists) throw new HttpsError('not-found', 'execution_not_found');
    const freshData = fresh.data()!;
    if (freshData.status !== 'IN_PROGRESS') throw new HttpsError('failed-precondition', 'execution_not_in_progress');
    const freshExercises: DocumentData[] = Array.isArray(freshData.exercises) ? freshData.exercises : [];
    const freshSlot = freshExercises[data.exerciseIndex];
    if (!freshSlot) throw new HttpsError('aborted', 'stale_execution_state');
    const freshSets = Array.isArray(freshSlot.sets) ? freshSlot.sets : [];
    if (freshSets.some((set: DocumentData) => set.status === 'COMPLETED')) {
      throw new HttpsError('failed-precondition', 'exercise_already_has_completed_sets');
    }
    // Re-check duplicate-in-session against the LATEST committed state, not
    // the pre-transaction read above — closes the race where a concurrent
    // substitution on a DIFFERENT slot landed a matching exerciseId in
    // between (audit Caso 5: stale candidate becomes a duplicate mid-flight).
    const freshEffective = new Set<string>(
      freshExercises
        .map((exercise, index) => (index === data.exerciseIndex ? null : exercise.exerciseId))
        .filter((id): id is string => typeof id === 'string'),
    );
    if (!isRevert && freshEffective.has(data.requestedExerciseId)) {
      throw new HttpsError('aborted', 'duplicate_in_session_at_commit');
    }

    const nextExercises = freshExercises.map((exercise, index) => {
      if (index !== data.exerciseIndex) return exercise;
      const { substitution: _dropped, ...rest } = exercise as DocumentData & { substitution?: unknown };
      const patched: DocumentData = {
        ...rest,
        prescribedExerciseId: typeof exercise.prescribedExerciseId === 'string' ? exercise.prescribedExerciseId : anchorExerciseId,
        exerciseId: data.requestedExerciseId,
      };
      // Reverting to the anchor clears the `substitution` marker entirely —
      // a slot back at its prescribed exercise is not "substituted".
      // `FieldValue.delete()` cannot be used inside an array element, so the
      // key is simply omitted via the destructure above instead.
      return isRevert ? patched : { ...patched, substitution: { scope: data.scope, appliedAt } };
    });
    transaction.update(executionRef, { exercises: nextExercises, updatedAt: FieldValue.serverTimestamp() });

    const preferenceRef = root.collection('exerciseSubstitutionPreferences').doc(anchorExerciseId);
    if (data.scope === 'PERMANENT' && !isRevert) {
      transaction.set(preferenceRef, {
        prescribedExerciseId: anchorExerciseId,
        preferredExerciseId: data.requestedExerciseId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (isRevert) {
      // "Voltar ao original" deactivates any standing permanent preference
      // for this anchor — it is never re-expressed as a new preferredExerciseId
      // pointing back at the anchor (Decision #5: no A->B->A chain semantics).
      transaction.delete(preferenceRef);
    }
  });

  return { exerciseId: data.requestedExerciseId, scope: data.scope };
}
