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
import { getTemplateById, TEMPLATE_LIBRARY_VERSION } from '../workoutPrescription/catalog';
import { generateWorkoutPrescription } from '../workoutPrescription/engine';
import { prescriptionInputErrors, sanitizeAnswersForEngine } from '../workoutPrescription/input';
import type { LimitationCatalogExercise } from '../workoutPrescription/limitationResolver';
import { loadLocalLimitationDataset } from '../workoutPrescription/localLimitationCatalog';
import {
  LIMITATION_DATASET_ACTIVE_DOCUMENT,
  LIMITATION_DATASET_STATE_COLLECTION,
  canonicalizeLimitationProfiles,
  type LimitationDatasetIdentity,
  type LimitationDatasetSnapshot,
} from '../workoutPrescription/limitationDataset';
import { logError, logInfo, logWarn } from '../lib/logger';
import { selectTemplate } from '../workoutPrescription/selection';
import {
  fromWorkoutTemplateDocument,
  WORKOUT_TEMPLATE_DOCUMENT_VERSION,
  type WorkoutTemplateDocument,
} from '../workoutPrescription/templateDocument';
import {
  PRESCRIPTION_VERSIONS,
  type CanonicalTemplate,
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
/**
 * `automatic_progression` — Progression Engine V1: Beginner stage
 * transitions and normal-cycle renewal (docs/workout-lifecycle/
 * 04_PROGRESSION_ENGINE.md).
 *
 * `automatic_reconciliation` — the FIRST program for an account, generated
 * the moment `useWorkoutPrescription` finds none (every app open that
 * reaches Home, not just once during `signUp()`). `onboarding` is kept only
 * for pre-existing documents written before this source value existed —
 * nothing in the client writes it anymore.
 */
export type WorkoutProgramSource = 'onboarding' | 'manual_regeneration' | 'automatic_progression' | 'automatic_reconciliation';

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
function limitationDatasetStateRef() {
  return doc(db, LIMITATION_DATASET_STATE_COLLECTION, LIMITATION_DATASET_ACTIVE_DOCUMENT);
}

function parseRemoteLimitationDatasetIdentity(value: unknown): LimitationDatasetIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.datasetVersion !== 'string'
    || typeof data.limitationDatasetHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(data.limitationDatasetHash)
  ) return null;
  return { version: data.datasetVersion, hash: data.limitationDatasetHash, source: 'firestore' };
}

export async function loadExerciseCatalogForLimitations(
  includeExercises = true,
): Promise<LimitationDatasetSnapshot> {
  const identityBeforeSnapshot = await getDoc(limitationDatasetStateRef());
  const identityBefore = identityBeforeSnapshot.exists()
    ? parseRemoteLimitationDatasetIdentity(identityBeforeSnapshot.data())
    : null;
  if (!identityBefore) throw new Error('LIMITATION_DATASET_ACTIVE_IDENTITY_MISSING');

  if (!includeExercises) {
    logInfo('limitation_dataset', 'limitation_dataset_loaded', {
      version: identityBefore.version,
      hash: identityBefore.hash,
      source: identityBefore.source,
    });
    return { ...identityBefore, exercises: [] };
  }

  const snapshot = await getDocs(collection(db, EXERCISES));
  if (snapshot.size !== EXPECTED_EXERCISE_COUNT) {
    throw new Error(`LIMITATION_CATALOG_COUNT_INVALID:${snapshot.size}`);
  }
  const exercises = snapshot.docs.map((document) => {
    const data = { ...document.data(), id: document.id };
    if (!isExerciseCatalogDocument(data, document.id)) {
      throw new Error(`LIMITATION_CATALOG_EXERCISE_INVALID:${document.id}`);
    }
    return data;
  });
  const profiles = exercises
    .filter((exercise) => exercise.limitationProfile != null)
    .map((exercise) => ({ exerciseId: exercise.id, limitationProfile: exercise.limitationProfile }));
  const Crypto = await import('expo-crypto');
  const computedHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalizeLimitationProfiles(profiles, exercises),
  );
  const identityAfterSnapshot = await getDoc(limitationDatasetStateRef());
  const identityAfter = identityAfterSnapshot.exists()
    ? parseRemoteLimitationDatasetIdentity(identityAfterSnapshot.data())
    : null;
  if (
    !identityAfter
    || identityBefore.version !== identityAfter.version
    || identityBefore.hash !== identityAfter.hash
    || computedHash !== identityAfter.hash
  ) {
    logError('limitation_dataset_version_mismatch', new Error('LIMITATION_DATASET_VERSION_MISMATCH'), {
      expectedVersion: identityAfter?.version ?? null,
      expectedHash: identityAfter?.hash ?? null,
      computedHash,
      source: 'firestore',
    });
    throw new Error('LIMITATION_DATASET_VERSION_MISMATCH');
  }
  logInfo('limitation_dataset', 'limitation_dataset_loaded', {
    version: identityAfter.version,
    hash: identityAfter.hash,
    source: identityAfter.source,
  });
  return { ...identityAfter, exercises };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function hasValidPrescriptionVersions(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return [
    'templateLibrary', 'selectionEngine', 'safetyRules',
    'modifierRules', 'compositionEngine', 'limitationResolver',
  ].every((key) => typeof value[key] === 'string' && SEMVER.test(value[key]));
}

const WEEKDAYS = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

function hasValidPhase2FrequencyCalendar(value: Partial<WorkoutProgramSnapshot>): boolean {
  if (value.versions?.selectionEngine !== '2.0.0') return true;
  if (
    typeof value.requestedDays !== 'number'
    || typeof value.prescribedStructuredDays !== 'number'
    || value.prescribedTrainingFrequency !== value.prescribedStructuredDays
    || value.prescribedTrainingFrequency > value.requestedDays
    || !isPlainObject(value.availability)
    || value.availability.days !== value.requestedDays
    || !Array.isArray(value.availability.weekdays)
    || !value.availability.weekdays.every((day) => typeof day === 'string' && WEEKDAYS.has(day))
    || ![0, value.requestedDays].includes(value.availability.weekdays.length)
    || new Set(value.availability.weekdays).size !== value.availability.weekdays.length
    || !Array.isArray(value.weeklySchedule)
    || ![0, 7].includes(value.weeklySchedule.length)
  ) return false;
  return value.weeklySchedule.every((day) =>
    isPlainObject(day)
    && typeof day.weekday === 'string'
    && WEEKDAYS.has(day.weekday)
    && ['TRAINING', 'ACTIVE_RECOVERY', 'REST'].includes(String(day.state))
    && (day.state === 'REST' || (typeof day.sessionIndex === 'number' && Number.isInteger(day.sessionIndex))),
  );
}

/** Exported only so backward-compatibility quality gates can exercise the exact load boundary. */
export function isProgramSnapshot(value: unknown, programId: string): value is WorkoutProgramSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkoutProgramSnapshot>;
  return item.programId === programId
    && typeof item.prescriptionId === 'string'
    && item.prescriptionId.length > 0
    && item.status === 'active'
    && ['onboarding', 'manual_regeneration', 'automatic_progression', 'automatic_reconciliation'].includes(item.source ?? '')
    && /^T(?:00[1-9]|0[1-8][0-9]|090)$/.test(item.templateId ?? '')
    && Array.isArray(item.sessions)
    && item.sessions.length > 0
    && item.sessions.every((session) =>
      isPlainObject(session)
      && typeof session.name === 'string'
      && typeof session.type === 'string'
      && Array.isArray(session.exercises)
      && session.exercises.length > 0
      && session.exercises.every((exercise) =>
        isPlainObject(exercise)
        && typeof exercise.exerciseId === 'string'
        && typeof exercise.sourceExerciseId === 'string'),
    )
    && typeof item.questionnaireId === 'string'
    && item.questionnaireId.length > 0
    && typeof item.questionnaireVersion === 'number'
    && Number.isInteger(item.questionnaireVersion)
    && item.questionnaireVersion > 0
    && typeof item.templateVersion === 'number'
    && Number.isInteger(item.templateVersion)
    && item.templateVersion > 0
    && typeof item.templateSourceVersion === 'string'
    && SEMVER.test(item.templateSourceVersion)
    && typeof item.templateContentHash === 'string'
    && /^[a-f0-9]{64}$/.test(item.templateContentHash)
    // Shape validation only — NOT an equality check against the current
    // engine's PRESCRIPTION_VERSIONS.templateLibrary. Programs persisted
    // under an older catalog version (e.g. 1.3.0) must stay readable after
    // the catalog is upgraded (e.g. to 2.0.0); a mismatched-but-well-formed
    // version string is a legitimate legacy program, not a corrupt one.
    && hasValidPrescriptionVersions(item.versions)
    && hasValidPhase2FrequencyCalendar(item);
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
    limitationDatasetVersion: input.plan.limitationDatasetVersion,
    limitationDatasetHash: input.plan.limitationDatasetHash,
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

// ─── COMPUTE (Phase 3, Part B) ───────────────────────────────────────────
//
// `prepareWorkoutProgram` is the ONE place the compute pipeline (sanitize →
// validate → select Txxx → load template → Limitation Resolver → engine →
// exercise-existence check) lives. `generateAndPersistWorkoutProgram`
// (Firestore-backed, post-auth) and `prepareWorkoutProgramLocally`
// (bundled-sources, pre-auth — Phase 3 Part C) both call this SAME function
// with different loader callbacks; neither re-implements any of it. Persist
// (Firestore transaction, active pointer, superseding) stays entirely
// separate, in `saveAndActivateWorkoutProgram`.

export interface PreparedWorkoutProgram {
  status: 'SUCCESS';
  plan: FinalWorkoutPlan;
  templateId: TemplateId;
  /**
   * True only when BOTH the Limitation Resolver actually ran AND it ran
   * against the local bundled catalog (`loadLocalExerciseCatalogForLimitations`)
   * rather than Firestore's. `persistPreparedWorkoutProgram` treats this as
   * an automatic "do not trust for direct persist" signal — see its doc
   * comment.
   */
  usedLocalLimitationCatalog: boolean;
  /** Deterministic hash of the normalized answers this plan was computed from — see `questionnaireFingerprint`. */
  questionnaireFingerprint: string;
  /** Engine/rule versions active at compute time (also embedded in `plan.versions`, duplicated here so a version drift can be checked without reaching into the plan). */
  prescriptionVersions: typeof PRESCRIPTION_VERSIONS;
  /** `TEMPLATE_LIBRARY_VERSION` at compute time — the local catalog's own version marker, independent of any Firestore document. */
  templateLibraryVersion: string;
  generatedAt: number;
}

export type PrepareWorkoutProgramResult = PreparedWorkoutProgram | Exclude<PrescriptionResult, { status: 'SUCCESS' }>;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    if (!isPlainObject(value)) return JSON.stringify(value);
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministic fingerprint of the NORMALIZED, sanitized answers a prepared
 * plan was computed from (docs/workout-lifecycle — Phase 3 Part F). Two
 * calls with the same effective answers always produce the same value,
 * regardless of object key order — `persistPreparedWorkoutProgram` recomputes
 * this from the actually-persisted questionnaire and rejects `prepared` on
 * any mismatch, rather than trusting an in-memory object blindly.
 */
export function questionnaireFingerprint(answers: QuestionnaireAnswers): string {
  const { answers: sanitized } = sanitizeAnswersForEngine(answers);
  return stableHash(stableStringify(sanitized));
}

/**
 * Classifies a `loadTemplate`/`loadLimitationDataset` failure for INTERNAL
 * diagnostics only — the public `status`/`reasonCodes` contract this feeds
 * into (`INVALID_CONFIGURATION`) is unchanged and never exposes this to the
 * end user. Before this, any thrown error (a real bad-config signal, a
 * Firestore Rules permission-denied, or a transient network/infra failure)
 * was reported identically, making a genuine data problem indistinguishable
 * from e.g. a signed-in-but-not-yet-verified account being denied a read —
 * exactly what made the first-app-entry `INVALID_CONFIGURATION` regression
 * hard to diagnose from logs alone.
 */
type PrepareLoadFailureClass = 'ACCESS_DENIED' | 'NETWORK_UNAVAILABLE' | 'CONFIGURATION';

function classifyPrepareLoadFailure(error: unknown): { failureClass: PrepareLoadFailureClass; code?: string } {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined;
  if (code === 'permission-denied' || code === 'unauthenticated') return { failureClass: 'ACCESS_DENIED', code };
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled') return { failureClass: 'NETWORK_UNAVAILABLE', code };
  return { failureClass: 'CONFIGURATION', code };
}

function reportPrepareLoadFailure(step: 'TEMPLATE' | 'LIMITATION_DATASET', error: unknown, fallbackCode: string): string[] {
  const { failureClass, code } = classifyPrepareLoadFailure(error);
  const message = error instanceof Error ? error.message : fallbackCode;
  // Internal-only: never surfaced to the end user, who only ever sees the
  // generic `INVALID_CONFIGURATION` outcome and a safe fallback UI.
  logWarn('workout_program', 'prepare_workout_program_load_failed', { step, failureClass, code, message });
  return [message];
}

export async function prepareWorkoutProgram(input: {
  answers: QuestionnaireAnswers;
  adaptationWeek?: number;
  loadTemplate: (templateId: TemplateId) => Promise<CanonicalTemplate | null>;
  loadLimitationDataset: (includeExercises: boolean) => Promise<LimitationDatasetSnapshot>;
  /** Declares which source `loadLimitationDataset` actually reads from — never inferred. */
  usedLocalLimitationCatalog: boolean;
}): Promise<PrepareWorkoutProgramResult> {
  // Boundary first — same guard `generateWorkoutPrescription` applies
  // internally, but this function calls `selectTemplate` and inspects
  // `specialConditions` itself (to know which template/catalog to fetch)
  // BEFORE ever reaching the engine, so it must not trust `input.answers`
  // either. A legacy/malformed shape must never resolve past this point.
  const { answers, legacyReasonCodes } = sanitizeAnswersForEngine(input.answers);
  // Same domain validation `generateWorkoutPrescription` runs internally,
  // checked here too so a genuinely incomplete/invalid questionnaire is
  // always reported as `NEEDS_QUESTIONNAIRE_UPDATE` with real reasonCodes —
  // never as `MISSING_TEMPLATE` just because `selectTemplate` (below) also
  // happens to fail on the same missing dimension. The UI tells these two
  // apart (docs/workout-lifecycle) and must never see the wrong one.
  const inputErrors = [...legacyReasonCodes, ...prescriptionInputErrors(answers)];
  if (inputErrors.length) {
    return { status: 'NEEDS_QUESTIONNAIRE_UPDATE', reasonCodes: [...new Set(inputErrors)].sort() };
  }
  const selection = selectTemplate(answers);
  if (selection.status !== 'SELECTED') {
    return { status: 'MISSING_TEMPLATE', reasonCodes: selection.reasonCodes };
  }
  let template: CanonicalTemplate | null;
  try {
    template = await input.loadTemplate(selection.decision.templateId);
  } catch (error) {
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: reportPrepareLoadFailure('TEMPLATE', error, 'WORKOUT_TEMPLATE_VERSION_MISMATCH'),
    };
  }
  if (!template) {
    return { status: 'MISSING_TEMPLATE', reasonCodes: ['WORKOUT_TEMPLATE_NOT_FOUND'] };
  }
  let limitationDataset: LimitationDatasetSnapshot;
  const needsLimitationCatalog = answers.specialConditions.includes('musculoskeletal_limitation');
  try {
    limitationDataset = await input.loadLimitationDataset(needsLimitationCatalog);
  } catch (error) {
    return {
      status: 'INVALID_CONFIGURATION',
      reasonCodes: reportPrepareLoadFailure('LIMITATION_DATASET', error, 'LIMITATION_CATALOG_LOAD_FAILED'),
    };
  }
  const result = generateWorkoutPrescription(answers, {
    adaptationWeek: input.adaptationWeek,
    template,
    exerciseCatalog: needsLimitationCatalog ? limitationDataset.exercises : undefined,
    limitationDataset,
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
  return {
    status: 'SUCCESS',
    plan: result.plan,
    templateId: selection.decision.templateId,
    usedLocalLimitationCatalog: needsLimitationCatalog && input.usedLocalLimitationCatalog,
    questionnaireFingerprint: questionnaireFingerprint(answers),
    prescriptionVersions: PRESCRIPTION_VERSIONS,
    templateLibraryVersion: TEMPLATE_LIBRARY_VERSION,
    generatedAt: Date.now(),
  };
}

/**
 * Pre-auth compute (Phase 3, Part C) — uses ONLY bundled, versioned local
 * sources (`catalog.ts`'s `getTemplateById`, `localLimitationCatalog.ts`),
 * never Firestore. This is necessary, not just an optimization:
 * `firestore.rules` requires `isSignedIn()` for `workoutTemplates` and
 * `hasVerifiedEmailForPrivateAccess()` for `exercises` — a client with no
 * Firebase user yet cannot read either. Runs the exact same
 * `prepareWorkoutProgram` pipeline as the post-auth path; Firestore remains
 * authoritative for what actually gets PERSISTED (see
 * `persistPreparedWorkoutProgram`).
 */
export async function prepareWorkoutProgramLocally(
  answers: QuestionnaireAnswers,
  adaptationWeek?: number,
): Promise<PrepareWorkoutProgramResult> {
  return prepareWorkoutProgram({
    answers,
    adaptationWeek,
    loadTemplate: (templateId) => Promise.resolve(getTemplateById(templateId) ?? null),
    loadLimitationDataset: () => Promise.resolve(loadLocalLimitationDataset()),
    usedLocalLimitationCatalog: true,
  });
}

export async function generateAndPersistWorkoutProgram(input: {
  uid: string;
  questionnaireId: string;
  questionnaireVersion: number;
  answers: QuestionnaireAnswers;
  source: WorkoutProgramSource;
  adaptationWeek?: number;
}): Promise<GenerateAndPersistResult> {
  let firestoreTemplate: WorkoutTemplateDocument | null = null;
  const prepared = await prepareWorkoutProgram({
    answers: input.answers,
    adaptationWeek: input.adaptationWeek,
    loadTemplate: async (templateId) => {
      firestoreTemplate = await loadWorkoutTemplate(templateId);
      return firestoreTemplate ? fromWorkoutTemplateDocument(firestoreTemplate) : null;
    },
    loadLimitationDataset: loadExerciseCatalogForLimitations,
    usedLocalLimitationCatalog: false,
  });
  if (prepared.status !== 'SUCCESS') return prepared;
  // `prepared.status === 'SUCCESS'` only happens after `loadTemplate`
  // resolved a non-null template, which is the only place `firestoreTemplate`
  // is assigned — always non-null here; the check below is defensive, not
  // expected to ever actually throw.
  if (!firestoreTemplate) throw new Error('WORKOUT_TEMPLATE_NOT_FOUND');
  const program = await saveAndActivateWorkoutProgram({
    uid: input.uid,
    questionnaireId: input.questionnaireId,
    questionnaireVersion: input.questionnaireVersion,
    source: input.source,
    plan: prepared.plan,
    template: firestoreTemplate,
  });
  return { status: 'SUCCESS', plan: program, program };
}

/**
 * Module-level (not per-hook-instance, not per-call-site) in-flight registry
 * keyed by exactly what determines a program's deterministic identity — see
 * `programIdentity()` above. `saveAndActivateWorkoutProgram`'s deterministic
 * `programId` + Firestore transaction already GUARANTEE correctness under
 * concurrency (two overlapping calls converge on the same document —
 * proved in `workoutProgramReconciliation.integration.test.ts`); this
 * registry exists purely to stop concurrent callers from each starting
 * their OWN redundant Firestore transaction in the first place. Phase 3
 * widens this beyond `useWorkoutPrescription`'s reconciliation
 * (`generateAndPersistWorkoutProgramDeduped`) to ALSO cover
 * `persistPreparedWorkoutProgram` (the signup-time bridge) — both go
 * through the exact same map/key, so a signup-time persist racing
 * `AppShell`'s automatic reconciliation (e.g. the app cold-starts into
 * AppShell a moment after signup, before the signup promise chain has
 * settled) share ONE attempt instead of two. `applyProgression`
 * (Progression Engine) keeps calling `generateAndPersistWorkoutProgram`
 * directly — its own eligibility check (`expectedProgramId` match against
 * the freshly-evaluated active program) is already the narrower,
 * already-proven-correct guard for that call site (see
 * `workoutProgression.integration.test.ts`'s concurrent-apply case); this
 * registry only targets the first-program creation race.
 */
const inFlightGenerations = new Map<string, Promise<GenerateAndPersistResult>>();

function generationKey(input: { uid: string; questionnaireId: string; adaptationWeek?: number }): string {
  return `${input.uid}:${input.questionnaireId}:${input.adaptationWeek ?? 'current'}`;
}

/**
 * Runs `attempt()` deduped by `key` — concurrent callers for the same key
 * share ONE in-flight Promise and both observe its real, final result
 * (never a synthetic "still working" placeholder). The registry entry is
 * removed the instant the call settles, success OR failure — a failure is
 * never cached, so the very next call for the same key always starts a
 * genuinely fresh attempt (this is deliberately not a result cache).
 */
function dedupedByKey(
  key: string,
  attempt: () => Promise<GenerateAndPersistResult>,
): Promise<GenerateAndPersistResult> {
  const existing = inFlightGenerations.get(key);
  if (existing) return existing;

  const promise = attempt().finally(() => {
    if (inFlightGenerations.get(key) === promise) inFlightGenerations.delete(key);
  });
  inFlightGenerations.set(key, promise);
  return promise;
}

/**
 * Dedup layer in front of `generateAndPersistWorkoutProgram` — see
 * `dedupedByKey`/`inFlightGenerations`'s doc comments. `useWorkoutPrescription`'s
 * automatic reconciliation AND its manual retry fallback both go through
 * this (not the raw function), so that an auto-reconciliation racing a
 * manual tap — or two mounts of the same hook, e.g. `AppShell` unmounting/
 * remounting mid-transition — collapse into one write instead of two.
 */
export function generateAndPersistWorkoutProgramDeduped(
  input: Parameters<typeof generateAndPersistWorkoutProgram>[0],
): Promise<GenerateAndPersistResult> {
  return dedupedByKey(generationKey(input), () => generateAndPersistWorkoutProgram(input));
}

/**
 * Signup-time bridge for the pre-auth `prepared` result (Phase 3, Part F).
 * `prepared` is NEVER trusted blindly — Firestore remains authoritative
 * after signup:
 *
 *   1. `prepared` must exist and be `SUCCESS` (the process may have died,
 *      or the Analysis screen's compute may itself have failed/timed out).
 *   2. `questionnaireFingerprint` recomputed from the ACTUALLY-PERSISTED
 *      answers must match exactly — any drift (edited an answer, a stale
 *      object from a previous attempt, a different account) invalidates it.
 *   3. Every recorded engine/template-library version must match the
 *      CURRENT app's live constants — protects against a `prepared` value
 *      that survived an app update mid-onboarding.
 *   4. `usedLocalLimitationCatalog` must be `false` — a plan computed
 *      through the Limitation Resolver against the LOCAL catalog is never
 *      persisted directly, regardless of fingerprint/version match. This
 *      keeps the safety-critical case on the exact same Firestore-verified
 *      path as before Phase 3 existed; only the Analysis screen's PREVIEW
 *      benefits from the local computation in that case, not the actual
 *      persisted write.
 *   5. The dataset identity embedded in the plan must match a freshly
 *      loaded and content-hash-verified Firestore limitation dataset.
 *   6. Even once trusted, the REAL Firestore `workoutTemplates/{id}`
 *      document is still loaded and used for the persisted snapshot's
 *      version/hash metadata — `prepared.plan`'s content is reused, but
 *      never its (locally-sourced) template version bookkeeping.
 *
 * Any failure at any step silently falls back to the full, unchanged,
 * authoritative `generateAndPersistWorkoutProgram` — never a partial or
 * degraded result, never an error surfaced just because the fast path
 * didn't apply. The WHOLE function runs through the same
 * `inFlightGenerations` registry `generateAndPersistWorkoutProgramDeduped`
 * uses (Phase 3, Part I) — a concurrent `automatic_reconciliation` attempt
 * for the same (uid, questionnaireId) shares this exact call instead of
 * starting its own.
 */
export async function persistPreparedWorkoutProgram(input: {
  uid: string;
  questionnaireId: string;
  questionnaireVersion: number;
  answers: QuestionnaireAnswers;
  prepared: PrepareWorkoutProgramResult | null;
  source: WorkoutProgramSource;
}): Promise<GenerateAndPersistResult> {
  return dedupedByKey(
    generationKey({ uid: input.uid, questionnaireId: input.questionnaireId }),
    async () => {
      const { prepared } = input;
      if (prepared && prepared.status === 'SUCCESS' && !prepared.usedLocalLimitationCatalog) {
        const currentFingerprint = questionnaireFingerprint(input.answers);
        const versions = prepared.prescriptionVersions;
        const versionsMatch = versions.templateLibrary === PRESCRIPTION_VERSIONS.templateLibrary
          && versions.selectionEngine === PRESCRIPTION_VERSIONS.selectionEngine
          && versions.safetyRules === PRESCRIPTION_VERSIONS.safetyRules
          && versions.modifierRules === PRESCRIPTION_VERSIONS.modifierRules
          && versions.compositionEngine === PRESCRIPTION_VERSIONS.compositionEngine
          && versions.limitationResolver === PRESCRIPTION_VERSIONS.limitationResolver
          && prepared.templateLibraryVersion === TEMPLATE_LIBRARY_VERSION;

        if (currentFingerprint === prepared.questionnaireFingerprint && versionsMatch) {
          try {
            const [firestoreTemplate, firestoreLimitationDataset] = await Promise.all([
              loadWorkoutTemplate(prepared.templateId),
              loadExerciseCatalogForLimitations(false),
            ]);
            const datasetMatches = prepared.plan.limitationDatasetVersion === firestoreLimitationDataset.version
              && prepared.plan.limitationDatasetHash === firestoreLimitationDataset.hash;
            if (firestoreTemplate && datasetMatches) {
              const program = await saveAndActivateWorkoutProgram({
                uid: input.uid,
                questionnaireId: input.questionnaireId,
                questionnaireVersion: input.questionnaireVersion,
                source: input.source,
                plan: prepared.plan,
                template: firestoreTemplate,
              });
              return { status: 'SUCCESS', plan: program, program };
            }
          } catch {
            // Fall through — the authoritative path below re-derives
            // everything from scratch and reports its own precise failure
            // if it also fails.
          }
        }
      }
      return generateAndPersistWorkoutProgram({
        uid: input.uid,
        questionnaireId: input.questionnaireId,
        questionnaireVersion: input.questionnaireVersion,
        answers: input.answers,
        source: input.source,
      });
    },
  );
}
