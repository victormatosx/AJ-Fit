#!/usr/bin/env -S node --import tsx
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';

import catalogJson from '../docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json';
import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import { CANONICAL_ACTIVITIES } from '../src/workoutPrescription/canonicalActivities';
import { SUPPORTED_TEMPLATE_SCHEMA_VERSIONS } from '../src/workoutPrescription/catalog';
import {
  toWorkoutTemplateDocumentBody,
  type WorkoutTemplateDocumentBody,
} from '../src/workoutPrescription/templateDocument';
import type { CanonicalTemplate } from '../src/workoutPrescription/types';

export const WORKOUT_TEMPLATES_COLLECTION = 'workoutTemplates';

type Catalog = { schema_version: string; library: string; workouts: CanonicalTemplate[] };
type SeedDocument = WorkoutTemplateDocumentBody & { contentHash: string };
export type SeedAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'BLOCKED' | 'ERROR';

const catalog = catalogJson as unknown as Catalog;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(body: WorkoutTemplateDocumentBody): string {
  return createHash('sha256').update(stableJson(body)).digest('hex');
}

export function buildSeedDocuments(source: Catalog = catalog): SeedDocument[] {
  return source.workouts.map((template) => {
    const body = toWorkoutTemplateDocumentBody(template, source.schema_version, source.library);
    return { ...body, contentHash: contentHash(body) };
  });
}

export function validateCanonicalSnapshot(liveExerciseIds?: Set<string>, source: Catalog = catalog): string[] {
  const errors: string[] = [];
  const templates = source.workouts;
  const sessions = templates.flatMap((template) => template.sessions);
  const slots = sessions.flatMap((session) => session.exercises);
  // Cardio/mobility activities (v1.27) are a disjoint, separately-typed
  // catalog — see `canonicalActivities.ts` — valid slot targets even though
  // they never enter `EXERCISES_SEED`/the Firestore `exercises` collection.
  const sourceIds = new Set([
    ...EXERCISES_SEED.map((exercise) => exercise.id),
    ...CANONICAL_ACTIVITIES.map((activity) => activity.id),
  ]);
  if (!SUPPORTED_TEMPLATE_SCHEMA_VERSIONS.some((version) => version === source.schema_version)) {
    errors.push(`UNSUPPORTED_SCHEMA:${source.schema_version}`);
  }
  if (!templates.length) errors.push('EMPTY_TEMPLATE_LIBRARY');
  const ids = new Set(templates.map((template) => template.id));
  if (ids.size !== templates.length) errors.push('DUPLICATE_TEMPLATE_ID');
  for (const template of templates) {
    if (!/^T\d{3}$/.test(template.id) || template.id === 'T000') errors.push(`INVALID_TEMPLATE_ID:${template.id}`);
    if (!template.sessions.length) errors.push(`NO_SESSIONS:${template.id}`);
    for (const session of template.sessions) {
      if (!session.exercises.length || !session.display_name?.trim()) errors.push(`INVALID_SESSION:${template.id}`);
    }
  }
  for (const slot of slots) {
    if (!sourceIds.has(slot.exercise_id)) errors.push(`INVALID_SOURCE_EXERCISE:${slot.exercise_id}`);
    if (liveExerciseIds && !liveExerciseIds.has(slot.exercise_id)) errors.push(`INVALID_LIVE_EXERCISE:${slot.exercise_id}`);
    if (slot.sets !== undefined
      && (typeof slot.sets !== 'number' || !Number.isInteger(slot.sets) || slot.sets < 1 || slot.sets > 10)) {
      errors.push(`INVALID_EXERCISE_SETS:${slot.exercise_id}`);
    }
    if (slot.cycles !== undefined
      && (typeof slot.cycles !== 'number' || !Number.isInteger(slot.cycles) || slot.cycles < 1 || slot.cycles > 100)) {
      errors.push(`INVALID_EXERCISE_CYCLES:${slot.exercise_id}`);
    }
  }
  return [...new Set(errors)].sort();
}

function resolveDefaultProjectId(): string {
  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(repoRoot, '.firebaserc'), 'utf8')) as {
    projects?: Record<string, string>;
  };
  const projectId = config.projects?.production;
  if (!projectId) throw new Error('.firebaserc não define projects.production.');
  return projectId;
}

function parseArgs(argv: string[]) {
  const confirm = argv.includes('--confirm');
  const projectIndex = argv.indexOf('--project');
  return { confirm, projectId: projectIndex >= 0 ? argv[projectIndex + 1] : resolveDefaultProjectId() };
}

export async function planSeed(db: Firestore, documents = buildSeedDocuments()) {
  const [templateSnapshot, exerciseSnapshot] = await Promise.all([
    db.collection(WORKOUT_TEMPLATES_COLLECTION).get(),
    db.collection('exercises').get(),
  ]);
  const liveExerciseIds = new Set(exerciseSnapshot.docs.map((doc) => doc.id));
  const validationErrors = validateCanonicalSnapshot(liveExerciseIds);
  const existing = new Map(templateSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const rows = documents.map((document) => {
    const current = existing.get(document.id);
    const action: SeedAction = !current
      ? 'CREATE'
      : current.contentHash === document.contentHash
        && current.sourceVersion === document.sourceVersion
        && current.version === document.version
        ? 'UNCHANGED'
        : 'UPDATE';
    return { id: document.id, action, document, current };
  });
  const expectedIds = new Set<string>(documents.map((document) => document.id));
  const extras = templateSnapshot.docs.map((doc) => doc.id).filter((id) => !expectedIds.has(id)).sort();
  return { rows, extras, validationErrors, liveExerciseCount: exerciseSnapshot.size };
}

async function verifyReadBack(db: Firestore, expected: SeedDocument[]) {
  const snapshot = await db.collection(WORKOUT_TEMPLATES_COLLECTION).get();
  const expectedById = new Map<string, SeedDocument>(expected.map((item) => [item.id, item]));
  const extras = snapshot.docs.filter((doc) => !expectedById.has(doc.id)).map((doc) => doc.id);
  const mismatches = snapshot.docs
    .filter((doc) => expectedById.has(doc.id) && doc.data().contentHash !== expectedById.get(doc.id)?.contentHash)
    .map((doc) => doc.id);
  const sessions = snapshot.docs.reduce((sum, doc) => sum + (Array.isArray(doc.data().sessions) ? doc.data().sessions.length : 0), 0);
  const slots = snapshot.docs.reduce((sum, doc) => sum + (Array.isArray(doc.data().sessions)
    ? doc.data().sessions.reduce((inner: number, session: { exercises?: unknown[] }) => inner + (session.exercises?.length ?? 0), 0)
    : 0), 0);
  const expectedSessions = expected.reduce((sum, doc) => sum + doc.sessions.length, 0);
  const expectedSlots = expected.reduce((sum, doc) => sum + doc.sessions.reduce((inner, session) => inner + session.exercises.length, 0), 0);
  if (snapshot.size !== expected.length || sessions !== expectedSessions
    || slots !== expectedSlots || extras.length || mismatches.length) {
    throw new Error(`READ_BACK_FAILED count=${snapshot.size} sessions=${sessions} slots=${slots} extras=${extras.join(',')} mismatches=${mismatches.join(',')}`);
  }
  return { templates: snapshot.size, sessions, slots, extras: extras.length, mismatches: mismatches.length };
}

async function main() {
  const { confirm, projectId } = parseArgs(process.argv.slice(2));
  const documents = buildSeedDocuments();
  const offlineErrors = validateCanonicalSnapshot();
  if (offlineErrors.length) throw new Error(`CANONICAL_VALIDATION_FAILED\n${offlineErrors.join('\n')}`);
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const plan = await planSeed(db, documents);
  console.log(`Projeto: ${projectId}`);
  console.log(`Modo: ${confirm ? 'WRITE EXPLÍCITO' : 'DRY RUN (padrão)'}`);
  console.log(`Fonte: ${documents.length} templates / ${documents.reduce((sum, doc) => sum + doc.sessions.length, 0)} sessões / ${documents.reduce((sum, doc) => sum + doc.sessions.reduce((inner, session) => inner + session.exercises.length, 0), 0)} slots`);
  console.log(`Catálogo live: ${plan.liveExerciseCount} exercícios`);
  for (const row of plan.rows) console.log(`${row.action.padEnd(9)} ${row.id}`);
  for (const id of plan.extras) console.log(`BLOCKED   EXTRA:${id}`);
  for (const error of plan.validationErrors) console.log(`ERROR     ${error}`);
  const counts = plan.rows.reduce<Record<SeedAction, number>>((acc, row) => {
    acc[row.action] += 1;
    return acc;
  }, { CREATE: 0, UPDATE: 0, UNCHANGED: 0, BLOCKED: plan.extras.length, ERROR: plan.validationErrors.length });
  console.log('Resumo:', counts);
  if (plan.validationErrors.length) process.exitCode = 1;
  if (!confirm || process.exitCode) return;

  for (let index = 0; index < plan.rows.length; index += 400) {
    const changed = plan.rows.slice(index, index + 400).filter((row) => row.action !== 'UNCHANGED');
    if (!changed.length) continue;
    const batch = db.batch();
    for (const row of changed) {
      const ref = db.collection(WORKOUT_TEMPLATES_COLLECTION).doc(row.id);
      batch.set(ref, {
        ...row.document,
        createdAt: row.current?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log('Read-back:', await verifyReadBack(db, documents));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
