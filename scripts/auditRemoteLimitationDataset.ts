#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { EXERCISES_SEED } from '../src/data/exercisesSeedData';
import { LIMITATION_REGION_IDS } from '../src/types/exercise';
import { WORKOUT_TEMPLATES } from '../src/workoutPrescription/catalog';
import {
  CANONICAL_LIMITATION_DATASET_HASH,
  CANONICAL_LIMITATION_DATASET_VERSION,
  CANONICAL_LIMITATION_PROFILES,
  LIMITATION_DATASET_ACTIVE_DOCUMENT,
  LIMITATION_DATASET_STATE_COLLECTION,
  diffLimitationProfiles,
  limitationDatasetDiffCounts,
} from '../src/workoutPrescription/limitationDataset';
import {
  resolveExerciseLimitations,
  validateLimitationProfile,
  type LimitationCatalogExercise,
} from '../src/workoutPrescription/limitationResolver';
import { sha256LimitationProfiles } from './limitationDatasetPublication';

const ROOT = process.cwd();
const ARTIFACT = resolve(ROOT, 'docs/workout-modifiers/remote-limitation-dataset-audit.json');

function projectId(): string {
  const config = JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')) as {
    projects?: { production?: string };
  };
  if (!config.projects?.production) throw new Error('projects.production ausente em .firebaserc');
  return config.projects.production;
}

async function main(): Promise<void> {
  const targetProject = projectId();
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: targetProject });
  const db = getFirestore();
  const [exerciseSnapshot, activeSnapshot] = await Promise.all([
    db.collection('exercises').get(),
    db.collection(LIMITATION_DATASET_STATE_COLLECTION).doc(LIMITATION_DATASET_ACTIVE_DOCUMENT).get(),
  ]);
  const remoteExercises = exerciseSnapshot.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  })) as LimitationCatalogExercise[];
  const remoteProfiles = remoteExercises
    .filter((exercise) => exercise.limitationProfile != null)
    .map((exercise) => ({ exerciseId: exercise.id, limitationProfile: exercise.limitationProfile }));
  const diff = diffLimitationProfiles({
    exerciseIds: EXERCISES_SEED.map((exercise) => exercise.id),
    local: CANONICAL_LIMITATION_PROFILES,
    remote: remoteProfiles,
  });
  const diffCounts = limitationDatasetDiffCounts(diff);
  const catalog = new Map(remoteExercises.map((exercise) => [exercise.id, exercise]));
  const reachableExerciseIds = [...new Set(WORKOUT_TEMPLATES.flatMap((template) =>
    template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exercise_id))))].sort();
  const invalidPairs: Array<{ exerciseId: string; region: string; reasonCodes: string[] }> = [];
  for (const exerciseId of reachableExerciseIds) {
    for (const region of LIMITATION_REGION_IDS) {
      const result = resolveExerciseLimitations({
        exerciseId,
        regions: [region],
        catalog,
        isExecutable: () => true,
      });
      if (result.status !== 'RESOLVED') {
        invalidPairs.push({ exerciseId, region, reasonCodes: result.reasonCodes });
      }
    }
  }
  const plank = resolveExerciseLimitations({
    exerciseId: 'plank',
    regions: ['knee'],
    catalog,
    isExecutable: () => true,
  });
  const deadBugValidation = validateLimitationProfile('dead-bug', catalog.get('dead-bug')?.limitationProfile);
  const active = activeSnapshot.data();
  const remoteHash = sha256LimitationProfiles(remoteProfiles, remoteExercises);
  const report = {
    generatedAt: new Date().toISOString(),
    projectId: targetProject,
    canonicalIdentity: {
      limitationDatasetVersion: CANONICAL_LIMITATION_DATASET_VERSION,
      limitationDatasetHash: CANONICAL_LIMITATION_DATASET_HASH,
    },
    activeIdentity: activeSnapshot.exists ? {
      limitationDatasetVersion: active?.datasetVersion ?? null,
      limitationDatasetHash: active?.limitationDatasetHash ?? null,
    } : null,
    exerciseCount: { expected: EXERCISES_SEED.length, remote: remoteExercises.length },
    profileCount: { expected: CANONICAL_LIMITATION_PROFILES.length, remote: remoteProfiles.length },
    regionCount: LIMITATION_REGION_IDS.length,
    remoteHash,
    diffCounts,
    remoteDiff: diff.filter((cell) => cell.kind !== 'EXACT_MATCH').length,
    individualResolver: {
      total: reachableExerciseIds.length * LIMITATION_REGION_IDS.length,
      valid: reachableExerciseIds.length * LIMITATION_REGION_IDS.length - invalidPairs.length,
      invalid: invalidPairs.length,
      invalidPairs,
    },
    plankKnee: plank.status === 'RESOLVED' ? {
      status: plank.status,
      finalExerciseId: plank.exercise.id,
    } : { status: plank.status, finalExerciseId: null, reasonCodes: plank.reasonCodes },
    deadBugKneeStatus: deadBugValidation.valid
      ? deadBugValidation.profile.regions.knee.status
      : deadBugValidation.reasonCode,
  };
  writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, artifact: ARTIFACT }, null, 2));
  const valid = remoteExercises.length === EXERCISES_SEED.length
    && remoteProfiles.length === CANONICAL_LIMITATION_PROFILES.length
    && report.remoteDiff === 0
    && remoteHash === CANONICAL_LIMITATION_DATASET_HASH
    && active?.datasetVersion === CANONICAL_LIMITATION_DATASET_VERSION
    && active?.limitationDatasetHash === CANONICAL_LIMITATION_DATASET_HASH
    && invalidPairs.length === 0
    && plank.status === 'RESOLVED'
    && plank.exercise.id === 'dead-bug'
    && deadBugValidation.valid
    && deadBugValidation.profile.regions.knee.status === 'not_applicable';
  if (!valid) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
