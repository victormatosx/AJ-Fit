import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { canonicalizeLimitationProfiles, LIMITATION_DATASET_ACTIVE_DOCUMENT, LIMITATION_DATASET_STATE_COLLECTION, type LimitationDatasetIdentity } from './prescriptionEngine/workoutPrescription/limitationDataset';
import type { LimitationCatalogExercise } from './prescriptionEngine/workoutPrescription/limitationResolver';
import { fromWorkoutTemplateDocument, WORKOUT_TEMPLATE_DOCUMENT_VERSION, type WorkoutTemplateDocument } from './prescriptionEngine/workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS, type CanonicalTemplate, type PrescriptionGenerationContext, type QuestionnaireAnswers, type TemplateId } from './prescriptionEngine/workoutPrescription/types';
import { selectTemplate } from './prescriptionEngine/workoutPrescription/selection';

/**
 * Backend mirror of the client's `isExerciseCatalogDocument`/`loadExerciseCatalogForLimitations`
 * (`src/services/workoutPrograms.ts`) — same validation, same expected count, same identity
 * cross-check, so the backend reads exactly the authoritative catalog the client would (docs/
 * workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md).
 */
const EXPECTED_EXERCISE_COUNT = 116;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExerciseCatalogDocument(value: unknown, id: string): value is LimitationCatalogExercise {
  if (!plainObject(value)) return false;
  const target = value.target;
  const movement = value.movement;
  const availability = value.availability;
  const substitution = value.substitution;
  return value.slug === id
    && ['active', 'inactive', 'draft'].includes(String(value.status ?? ''))
    && Array.isArray(value.equipment)
    && plainObject(target) && typeof target.primaryMuscle === 'string'
    && plainObject(movement) && typeof movement.pattern === 'string'
    && plainObject(availability)
    && plainObject(substitution) && Array.isArray(substitution.similarExerciseIds);
}

export async function loadExerciseCatalog(firestore: Firestore): Promise<LimitationCatalogExercise[]> {
  const snapshot = await firestore.collection('exercises').get();
  if (snapshot.size !== EXPECTED_EXERCISE_COUNT) {
    throw new HttpsError('failed-precondition', `authoritative_exercise_catalog_count_invalid:${snapshot.size}`);
  }
  return snapshot.docs.map((document) => {
    const data = { ...document.data(), id: document.id };
    if (!isExerciseCatalogDocument(data, document.id)) {
      throw new HttpsError('failed-precondition', `authoritative_exercise_catalog_document_invalid:${document.id}`);
    }
    return data;
  });
}

export async function loadLimitationDatasetIdentity(
  firestore: Firestore,
  exercises: readonly LimitationCatalogExercise[],
): Promise<LimitationDatasetIdentity> {
  const snapshot = await firestore.collection(LIMITATION_DATASET_STATE_COLLECTION).doc(LIMITATION_DATASET_ACTIVE_DOCUMENT).get();
  const data = snapshot.data();
  if (!snapshot.exists || typeof data?.datasetVersion !== 'string' || typeof data?.limitationDatasetHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(data.limitationDatasetHash)) {
    throw new HttpsError('failed-precondition', 'authoritative_limitation_dataset_identity_missing');
  }
  const profiles = exercises
    .filter((exercise) => exercise.limitationProfile != null)
    .map((exercise) => ({ exerciseId: exercise.id, limitationProfile: exercise.limitationProfile }));
  const computedHash = createHash('sha256')
    .update(canonicalizeLimitationProfiles(profiles, exercises))
    .digest('hex');
  if (computedHash !== data.limitationDatasetHash) {
    throw new HttpsError('failed-precondition', 'authoritative_limitation_dataset_hash_mismatch');
  }
  return { version: data.datasetVersion, hash: data.limitationDatasetHash, source: 'firestore' };
}

function isTemplateDocument(value: unknown, id: TemplateId): value is WorkoutTemplateDocument {
  if (!plainObject(value)) return false;
  return value.id === id
    && value.status === 'active'
    && value.version === WORKOUT_TEMPLATE_DOCUMENT_VERSION
    && value.sourceVersion === PRESCRIPTION_VERSIONS.templateLibrary
    && typeof value.contentHash === 'string'
    && value.contentHash.length === 64
    && Array.isArray(value.sessions)
    && value.sessions.length > 0;
}

export interface AuthoritativeTemplate {
  template: CanonicalTemplate;
  version: number;
  sourceVersion: string;
  contentHash: string;
}

export async function loadCanonicalTemplate(firestore: Firestore, templateId: TemplateId): Promise<AuthoritativeTemplate | null> {
  const snapshot = await firestore.collection('workoutTemplates').doc(templateId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!isTemplateDocument(data, templateId)) {
    throw new HttpsError('failed-precondition', `authoritative_template_version_mismatch:${templateId}`);
  }
  return {
    template: fromWorkoutTemplateDocument(data),
    version: data.version,
    sourceVersion: data.sourceVersion,
    contentHash: data.contentHash,
  };
}

export interface PrescriptionGenerationInputs {
  context: PrescriptionGenerationContext;
  templateMetadata: Pick<AuthoritativeTemplate, 'version' | 'sourceVersion' | 'contentHash'>;
}

/**
 * Everything `generateWorkoutPrescription` (the synced engine) needs to independently
 * compute the canonical plan for `answers`, read from the same authoritative Firestore
 * collections the client reads (`exercises`, `workoutTemplates`, `limitationDatasetState`) —
 * never from anything the client submitted in the request.
 */
export async function buildPrescriptionGenerationContext(
  firestore: Firestore,
  answers: QuestionnaireAnswers,
): Promise<PrescriptionGenerationInputs> {
  const selection = selectTemplate(answers);
  if (selection.status === 'MISSING_TEMPLATE') {
    throw new HttpsError('failed-precondition', 'authoritative_prescription_missing_template');
  }
  const [exerciseCatalog, authoritativeTemplate] = await Promise.all([
    loadExerciseCatalog(firestore),
    loadCanonicalTemplate(firestore, selection.decision.templateId),
  ]);
  if (!authoritativeTemplate) {
    throw new HttpsError('failed-precondition', `authoritative_template_not_found:${selection.decision.templateId}`);
  }
  const limitationDataset = await loadLimitationDatasetIdentity(firestore, exerciseCatalog);
  return {
    context: { template: authoritativeTemplate.template, exerciseCatalog, limitationDataset },
    templateMetadata: authoritativeTemplate,
  };
}
