import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { EXERCISES_SEED } from '../data/exercisesSeedData';
import { generateWorkoutPrescription } from '../workoutPrescription/engine';
import type { LimitationCatalogExercise } from '../workoutPrescription/limitationResolver';
import { selectTemplate } from '../workoutPrescription/selection';
import {
  fromWorkoutTemplateDocument,
  WORKOUT_TEMPLATE_DOCUMENT_VERSION,
  type WorkoutTemplateDocument,
} from '../workoutPrescription/templateDocument';
import {
  PRESCRIPTION_VERSIONS,
  type FinalWorkoutPlan,
  type PrescriptionResult,
  type QuestionnaireAnswers,
  type TemplateId,
} from '../workoutPrescription/types';

const USERS = 'users';
const PROGRAMS = 'workoutPrograms';
const PROGRAM_STATE = 'workoutProgramState';
const TEMPLATES = 'workoutTemplates';
const EXERCISES = 'exercises';
const EXPECTED_EXERCISE_COUNT = 116;

export type WorkoutProgramStatus = 'active' | 'superseded';
/** `automatic_progression` — Progression Engine V1: Beginner stage transitions and normal-cycle renewal (docs/workout-lifecycle/04_PROGRESSION_ENGINE.md). */
export type WorkoutProgramSource = 'onboarding' | 'manual_regeneration' | 'automatic_progression';

export interface WorkoutProgramSnapshot extends FinalWorkoutPlan {
  programId: string;
  prescriptionId: string;
  status: WorkoutProgramStatus;
  source: WorkoutProgramSource;
  templateVersion: number;
  templateSourceVersion: string;
  templateContentHash: string;
  questionnaireId: string;
  questionnaireVersion: number;
  createdAt: Timestamp | null;
  activatedAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type GenerateAndPersistResult = Exclude<PrescriptionResult, { status: 'SUCCESS' }> | {
  status: 'SUCCESS';
  plan: FinalWorkoutPlan;
  program: WorkoutProgramSnapshot;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Plain data objects only — `serverTimestamp()`/`FieldValue` sentinels (and any other class instance, e.g. `Timestamp`) are NOT plain objects and must be returned verbatim below, never decomposed via `Object.entries()`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    ) as T;
  }
  return value;
}

function templateRef(templateId: TemplateId) {
  return doc(db, TEMPLATES, templateId);
}

function userRef(uid: string) {
  return doc(db, USERS, uid);
}

function programRef(uid: string, programId: string) {
  return doc(db, USERS, uid, PROGRAMS, programId);
}

function activeProgramStateRef(uid: string) {
  return doc(db, USERS, uid, PROGRAM_STATE, 'active');
}

function isTemplateDocument(value: unknown, id: TemplateId): value is WorkoutTemplateDocument {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkoutTemplateDocument>;
  return item.id === id
    && item.status === 'active'
    && item.version === WORKOUT_TEMPLATE_DOCUMENT_VERSION
    && item.sourceVersion === PRESCRIPTION_VERSIONS.templateLibrary
    && typeof item.contentHash === 'string'
    && item.contentHash.length === 64
    && Array.isArray(item.sessions)
    && item.sessions.length > 0;
}

export async function loadWorkoutTemplate(templateId: TemplateId): Promise<WorkoutTemplateDocument | null> {
  const snapshot = await getDoc(templateRef(templateId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!isTemplateDocument(data, templateId)) {
    throw new Error(`WORKOUT_TEMPLATE_VERSION_MISMATCH:${templateId}`);
  }
  return data;
}

function isExerciseCatalogDocument(value: unknown, id: string): value is LimitationCatalogExercise {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LimitationCatalogExercise>;
  return item.slug === id
    && ['active', 'inactive', 'draft'].includes(item.status ?? '')
    && Array.isArray(item.equipment)
    && item.target != null
    && typeof item.target.primaryMuscle === 'string'
    && item.movement != null
    && typeof item.movement.pattern === 'string'
    && item.availability != null
    && item.substitution != null
    && Array.isArray(item.substitution.similarExerciseIds);
}

/** Single catalog query; Limitation Resolver remains pure and performs no I/O. */
export async function loadExerciseCatalogForLimitations(): Promise<LimitationCatalogExercise[]> {
  const snapshot = await getDocs(collection(db, EXERCISES));
  if (snapshot.size !== EXPECTED_EXERCISE_COUNT) {
    throw new Error(`LIMITATION_CATALOG_COUNT_INVALID:${snapshot.size}`);
  }
  return snapshot.docs.map((document) => {
    const data = { ...document.data(), id: document.id };
    if (!isExerciseCatalogDocument(data, document.id)) {
      throw new Error(`LIMITATION_CATALOG_EXERCISE_INVALID:${document.id}`);
    }
    return data;
  });
}

function isProgramSnapshot(value: unknown, programId: string): value is WorkoutProgramSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkoutProgramSnapshot>;
  return item.programId === programId
    && item.status === 'active'
    && /^T(?:00[1-9]|0[1-8][0-9]|090)$/.test(item.templateId ?? '')
    && Array.isArray(item.sessions)
    && item.sessions.length > 0
    && typeof item.questionnaireId === 'string'
    && item.versions?.templateLibrary === PRESCRIPTION_VERSIONS.templateLibrary;
}

export async function loadActiveWorkoutProgram(uid: string): Promise<WorkoutProgramSnapshot | null> {
  const stateSnapshot = await getDoc(activeProgramStateRef(uid));
  if (!stateSnapshot.exists()) return null;
  const activeWorkoutId = stateSnapshot.data().programId;
  if (typeof activeWorkoutId !== 'string' || !activeWorkoutId) return null;
  const programSnapshot = await getDoc(programRef(uid, activeWorkoutId));
  if (!programSnapshot.exists()) throw new Error('ACTIVE_WORKOUT_PROGRAM_NOT_FOUND');
  const data = programSnapshot.data();
  if (!isProgramSnapshot(data, activeWorkoutId)) throw new Error('ACTIVE_WORKOUT_PROGRAM_INVALID');
  return data;
}

function validateProgramExerciseIds(plan: FinalWorkoutPlan): string[] {
  // The live 116/116 existence gate is enforced by the template seed before
  // any template can be published. Delete is forbidden by Rules. Keeping the
  // ID set local also lets initial onboarding finish before email verification;
  // no exercise content is read from this bootstrap set.
  const ids = new Set(EXERCISES_SEED.map((item) => item.id));
  return [...new Set(plan.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId)))]
    .filter((id) => !ids.has(id))
    .sort();
}

function programIdentity(input: {
  questionnaireId: string;
  questionnaireVersion: number;
  plan: FinalWorkoutPlan;
  template: WorkoutTemplateDocument;
}): string {
  return JSON.stringify({
    questionnaireId: input.questionnaireId,
    questionnaireVersion: input.questionnaireVersion,
    prescriptionId: input.plan.planId,
    templateId: input.template.id,
    templateVersion: input.template.version,
    templateContentHash: input.template.contentHash,
    versions: input.plan.versions,
    adaptationStage: input.plan.adaptationStage ?? null,
  });
}

export async function saveAndActivateWorkoutProgram(input: {
  uid: string;
  questionnaireId: string;
  questionnaireVersion: number;
  plan: FinalWorkoutPlan;
  template: WorkoutTemplateDocument;
  source: WorkoutProgramSource;
}): Promise<WorkoutProgramSnapshot> {
  const programId = `wpg_${stableHash(programIdentity(input))}`;
  const targetRef = programRef(input.uid, programId);
  const parentRef = userRef(input.uid);
  const stateRef = activeProgramStateRef(input.uid);

  await runTransaction(db, async (transaction) => {
    const parentSnapshot = await transaction.get(parentRef);
    if (!parentSnapshot.exists()) throw new Error('WORKOUT_PROGRAM_USER_NOT_FOUND');
    const stateSnapshot = await transaction.get(stateRef);
    const currentId = stateSnapshot.exists() ? stateSnapshot.data().programId : null;
    const targetSnapshot = await transaction.get(targetRef);
    const currentRef = typeof currentId === 'string' && currentId !== programId
      ? programRef(input.uid, currentId)
      : null;
    const currentSnapshot = currentRef ? await transaction.get(currentRef) : null;

    if (currentRef && currentSnapshot?.exists()) {
      transaction.update(currentRef, { status: 'superseded', updatedAt: serverTimestamp() });
    }
    if (targetSnapshot.exists()) {
      transaction.update(targetRef, {
        status: 'active',
        activatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      transaction.set(targetRef, withoutUndefined({
        ...input.plan,
        programId,
        prescriptionId: input.plan.planId,
        status: 'active',
        source: input.source,
        templateVersion: input.template.version,
        templateSourceVersion: input.template.sourceVersion,
        templateContentHash: input.template.contentHash,
        questionnaireId: input.questionnaireId,
        questionnaireVersion: input.questionnaireVersion,
        createdAt: serverTimestamp(),
        activatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    }
    transaction.set(stateRef, {
      programId,
      updatedAt: serverTimestamp(),
    });
  });

  const saved = await getDoc(targetRef);
  const savedData = saved.data();
  if (!saved.exists() || !isProgramSnapshot(savedData, programId)) {
    throw new Error('PROGRAM_PERSIST_FAILED');
  }
  return savedData;
}

export async function generateAndPersistWorkoutProgram(input: {
  uid: string;
  questionnaireId: string;
  questionnaireVersion: number;
  answers: QuestionnaireAnswers;
  source: WorkoutProgramSource;
  adaptationWeek?: number;
}): Promise<GenerateAndPersistResult> {
  const selection = selectTemplate(input.answers);
  if (selection.status !== 'SELECTED') {
    return { status: 'MISSING_TEMPLATE', reasonCodes: selection.reasonCodes };
  }
  let template: WorkoutTemplateDocument | null;
  try {
    template = await loadWorkoutTemplate(selection.decision.templateId);
  } catch (error) {
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: [error instanceof Error ? error.message : 'WORKOUT_TEMPLATE_VERSION_MISMATCH'],
    };
  }
  if (!template) {
    return { status: 'MISSING_TEMPLATE', reasonCodes: ['WORKOUT_TEMPLATE_NOT_FOUND'] };
  }
  let exerciseCatalog: LimitationCatalogExercise[] | undefined;
  if (input.answers.specialConditions.includes('musculoskeletal_limitation')) {
    try {
      exerciseCatalog = await loadExerciseCatalogForLimitations();
    } catch (error) {
      return {
        status: 'INVALID_CONFIGURATION',
        reasonCodes: [error instanceof Error ? error.message : 'LIMITATION_CATALOG_LOAD_FAILED'],
      };
    }
  }
  const result = generateWorkoutPrescription(input.answers, {
    adaptationWeek: input.adaptationWeek,
    template: fromWorkoutTemplateDocument(template),
    exerciseCatalog,
  });
  if (result.status !== 'SUCCESS') return result;
  const missingExercises = validateProgramExerciseIds(result.plan);
  if (missingExercises.length) {
    return {
      status: 'MISSING_EXERCISE',
      reasonCodes: missingExercises.map((id) => `MISSING_EXERCISE:${id}`),
      trace: result.plan.trace,
    };
  }
  const program = await saveAndActivateWorkoutProgram({
    ...input,
    plan: result.plan,
    template,
  });
  return { status: 'SUCCESS', plan: program, program };
}
