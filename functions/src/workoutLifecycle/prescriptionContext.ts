
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { EXERCISES_SEED } from './prescriptionEngine/data/exercisesSeedData';
import type { CatalogExercise } from './prescriptionEngine/workoutPrescription/exerciseCatalog';
import { fromWorkoutTemplateDocument, WORKOUT_TEMPLATE_DOCUMENT_VERSION, type WorkoutTemplateDocument } from './prescriptionEngine/workoutPrescription/templateDocument';
import { PRESCRIPTION_VERSIONS, type CanonicalTemplate, type PrescriptionGenerationContext, type QuestionnaireAnswers, type TemplateId } from './prescriptionEngine/workoutPrescription/types';
import { selectTemplate } from './prescriptionEngine/workoutPrescription/selection';

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExerciseCatalogDocument(value: unknown, id: string): value is CatalogExercise {
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

export async function loadExerciseCatalog(firestore: Firestore): Promise<CatalogExercise[]> {
  const snapshot = await firestore.collection('exercises').get();
  const exercises = snapshot.docs.map((document) => {
    const data = { ...document.data(), id: document.id };
    if (!isExerciseCatalogDocument(data, document.id)) {
      throw new HttpsError('failed-precondition', `authoritative_exercise_catalog_document_invalid:${document.id}`);
    }
    return data;
  });
  const ids = new Set(exercises.map((exercise) => exercise.id));
  for (const exercise of EXERCISES_SEED) {
    if (!ids.has(exercise.id)) {
      throw new HttpsError('failed-precondition', `authoritative_exercise_catalog_required_exercise_missing:${exercise.id}`);
    }
  }
  return exercises;
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
  return {
    context: { template: authoritativeTemplate.template, exerciseCatalog },
    templateMetadata: authoritativeTemplate,
  };
}
