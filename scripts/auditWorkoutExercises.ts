#!/usr/bin/env -S node --import tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import type { ExerciseSeedInput } from '../src/types/exercise';
import { validateExerciseSeed } from '../src/validators/exerciseValidation';

const WORKOUTS_PATH = join(process.cwd(), 'docs/workouts/AJ_Fit_T001_T090_workouts_reformed_v2_0.json');
const FORBIDDEN_EXACT_NAMES = new Set(['Braços', 'Core', 'Cardio', 'Mobilidade Geral', 'Caminhada leve']);

type WorkoutExercise = { name: string; exercise_id: string; catalog_status?: string };
type WorkoutFile = { workouts: Array<{ id: string; sessions: Array<{ exercises: WorkoutExercise[] }> }> };

export type ExerciseAudit = {
  totalWorkouts: number;
  totalExerciseReferences: number;
  uniqueExercises: number;
  missingExercises: string[];
  invalidReferences: string[];
  duplicateCanonicalExercises: string[];
  schemaErrors: string[];
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function auditWorkoutExercises(workouts: WorkoutFile, exercises: ExerciseSeedInput[]): ExerciseAudit {
  const refs = workouts.workouts.flatMap((workout) =>
    workout.sessions.flatMap((session) => session.exercises.map((exercise) => ({ workoutId: workout.id, ...exercise }))),
  );
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const missingExercises = [...new Set(refs.filter((ref) => !byId.has(ref.exercise_id)).map((ref) => ref.exercise_id))].sort();
  const invalidReferences: string[] = [];

  for (const ref of refs) {
    if (!ref.exercise_id?.trim()) invalidReferences.push(`${ref.workoutId}: exercise_id ausente`);
    if (!ref.name?.trim()) invalidReferences.push(`${ref.workoutId}/${ref.exercise_id}: nome ausente`);
    if (ref.name.includes('/')) invalidReferences.push(`${ref.workoutId}/${ref.exercise_id}: nome contém /`);
    if (FORBIDDEN_EXACT_NAMES.has(ref.name)) invalidReferences.push(`${ref.workoutId}/${ref.exercise_id}: nome proibido "${ref.name}"`);

    const catalogExercise = byId.get(ref.exercise_id);
    if (catalogExercise && normalize(catalogExercise.name.ptBR) !== normalize(ref.name)) {
      invalidReferences.push(`${ref.workoutId}/${ref.exercise_id}: nome diverge do catálogo (${ref.name} != ${catalogExercise.name.ptBR})`);
    }
  }

  for (const exercise of exercises) {
    for (const locale of ['ptBR', 'en', 'es'] as const) {
      if (exercise.name[locale].includes('/')) {
        invalidReferences.push(`CATALOG/${exercise.id}: name.${locale} contém /`);
      }
    }
    if (FORBIDDEN_EXACT_NAMES.has(exercise.name.ptBR)) {
      invalidReferences.push(`CATALOG/${exercise.id}: nome proibido "${exercise.name.ptBR}"`);
    }
  }

  const canonicalByName = new Map<string, Set<string>>();
  for (const exercise of exercises) {
    const key = normalize(exercise.name.ptBR);
    const ids = canonicalByName.get(key) ?? new Set<string>();
    ids.add(exercise.id);
    canonicalByName.set(key, ids);
  }
  const duplicateCanonicalExercises = [...canonicalByName.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([name, ids]) => `${name}: ${[...ids].join(', ')}`)
    .sort();

  return {
    totalWorkouts: workouts.workouts.length,
    totalExerciseReferences: refs.length,
    uniqueExercises: new Set(refs.map((ref) => ref.exercise_id)).size,
    missingExercises,
    invalidReferences: [...new Set(invalidReferences)].sort(),
    duplicateCanonicalExercises,
    schemaErrors: validateExerciseSeed(exercises).errors,
  };
}

async function loadLiveExercises(projectId: string): Promise<{ exercises: ExerciseSeedInput[]; persistenceErrors: string[] }> {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId });
  const snapshot = await getFirestore().collection('exercises').get();
  const persistenceErrors: string[] = [];
  const exercises = snapshot.docs.map((document) => {
    const { metadata, ...data } = document.data();
    if (data.id !== undefined && data.id !== document.id) persistenceErrors.push(`[${document.id}] body.id diverge do document ID`);
    if (data.slug !== document.id) persistenceErrors.push(`[${document.id}] slug diverge do document ID`);
    if (!metadata || typeof metadata.version !== 'number' || !metadata.createdAt || !metadata.updatedAt) {
      persistenceErrors.push(`[${document.id}] metadata obrigatório ausente ou inválido`);
    }
    return { ...data, id: document.id } as ExerciseSeedInput;
  });
  return { exercises, persistenceErrors };
}

async function main() {
  const live = process.argv.includes('--live');
  const workouts = JSON.parse(readFileSync(WORKOUTS_PATH, 'utf8')) as WorkoutFile;
  const liveCatalog = live ? await loadLiveExercises('ajfit-2f321') : undefined;
  const exercises = liveCatalog?.exercises ?? EXERCISES_SEED;
  const audit = auditWorkoutExercises(workouts, exercises);
  audit.schemaErrors.push(...(liveCatalog?.persistenceErrors ?? []));

  console.log(`SOURCE = ${live ? 'FIRESTORE ajfit-2f321' : 'LOCAL SEED'}`);
  console.log(`TOTAL_WORKOUTS = ${audit.totalWorkouts}`);
  console.log(`TOTAL_EXERCISE_REFERENCES = ${audit.totalExerciseReferences}`);
  console.log(`UNIQUE_EXERCISES = ${audit.uniqueExercises}`);
  console.log(`MISSING_EXERCISES = ${audit.missingExercises.length}`);
  console.log(`INVALID_REFERENCES = ${audit.invalidReferences.length}`);
  console.log(`DUPLICATE_CANONICAL_EXERCISES = ${audit.duplicateCanonicalExercises.length}`);
  console.log(`SCHEMA_ERRORS = ${audit.schemaErrors.length}`);

  for (const [label, errors] of [
    ['MISSING', audit.missingExercises],
    ['INVALID', audit.invalidReferences],
    ['DUPLICATE', audit.duplicateCanonicalExercises],
    ['SCHEMA', audit.schemaErrors],
  ] as const) {
    errors.forEach((error) => console.error(`${label}: ${error}`));
  }

  if (audit.missingExercises.length || audit.invalidReferences.length || audit.duplicateCanonicalExercises.length || audit.schemaErrors.length) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('auditWorkoutExercises.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
